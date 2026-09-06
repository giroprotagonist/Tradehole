/**
 * Shared adsb.lol client — one global queue, hard gaps, 429 backoff.
 *
 * Levant AER-01 (priority "levant") always runs ahead of theater tiles.
 * Theater callers rotate a small subset per cycle (Gulf + corridor pinned)
 * so we never hammer mil + 9+ geos on every refresh.
 */

export type AdsbAc = {
  hex?: string;
  flight?: string;
  t?: string;
  desc?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | string;
  alt_geom?: number | string;
  gs?: number;
  track?: number;
  true_heading?: number;
  dbFlags?: number;
};

export type AdsbPriority =
  | "levant"
  | "gulf"
  | "follow"
  | "theater"
  | "e6b"
  | "other";

export type AdsbFetchResult = {
  ok: boolean;
  status: number;
  ac: AdsbAc[];
  error?: string;
  fromCache?: boolean;
  rateLimited?: boolean;
};

const PRIORITY_RANK: Record<AdsbPriority, number> = {
  levant: 0,
  gulf: 1,
  follow: 2,
  e6b: 3,
  theater: 4,
  other: 5,
};

/** Hard gap between any two adsb.lol HTTP calls (ms). */
const BOX_GAP_MS = 3200;
/** Extra floor after a successful response before next dequeue. */
const POST_OK_GAP_MS = 2400;
const ADSB_TIMEOUT_MS = 14_000;
const BACKOFF_BASE_MS = 8_000;
const BACKOFF_MAX_MS = 120_000;
const MIL_CACHE_TTL_MS = 90_000;
const MIL_URL = "https://api.adsb.lol/v2/mil";

type QueueJob = {
  id: string;
  url: string;
  priority: AdsbPriority;
  attempts: number;
  resolve: (r: AdsbFetchResult) => void;
};

let queue: QueueJob[] = [];
let pumping = false;
let nextAllowedAt = 0;
let backoffUntil = 0;
let backoffStreak = 0;

let milCache: { at: number; ac: AdsbAc[]; status: number } | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfterMs(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const asInt = Number(raw);
  if (Number.isFinite(asInt) && asInt >= 0) {
    // Seconds (usual) — clamp 1s–180s
    return Math.min(180_000, Math.max(1_000, asInt * 1000));
  }
  const when = Date.parse(raw);
  if (Number.isFinite(when)) {
    return Math.min(180_000, Math.max(1_000, when - Date.now()));
  }
  return null;
}

function noteRateLimit(res: Response): void {
  backoffStreak += 1;
  const retryAfter = parseRetryAfterMs(res);
  const exp = Math.min(
    BACKOFF_MAX_MS,
    BACKOFF_BASE_MS * 2 ** Math.min(backoffStreak - 1, 4),
  );
  const wait = retryAfter ?? exp;
  backoffUntil = Math.max(backoffUntil, Date.now() + wait);
  nextAllowedAt = Math.max(nextAllowedAt, backoffUntil);
}

function noteSuccess(): void {
  backoffStreak = 0;
  nextAllowedAt = Math.max(nextAllowedAt, Date.now() + POST_OK_GAP_MS);
}

function sortQueue(): void {
  queue.sort(
    (a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      a.id.localeCompare(b.id),
  );
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length > 0) {
      sortQueue();
      const now = Date.now();
      const wait = Math.max(0, nextAllowedAt - now, backoffUntil - now);
      if (wait > 0) await sleep(wait);

      const job = queue.shift();
      if (!job) break;

      // Shared mil cache — Levant + theater + E-6B share one fetch.
      if (job.url === MIL_URL && milCache && Date.now() - milCache.at < MIL_CACHE_TTL_MS) {
        job.resolve({
          ok: milCache.status >= 200 && milCache.status < 300,
          status: milCache.status,
          ac: milCache.ac,
          fromCache: true,
        });
        continue;
      }

      try {
        const res = await fetch(job.url, {
          headers: {
            Accept: "application/json",
            "User-Agent": "Tradehole/0.2 (adsb-shared)",
          },
          signal: AbortSignal.timeout(ADSB_TIMEOUT_MS),
        });

        if (res.status === 420 || res.status === 429) {
          noteRateLimit(res);
          // Re-queue once with lower urgency if attempts remain; else fail.
          if (job.attempts < 1) {
            queue.push({ ...job, attempts: job.attempts + 1 });
            continue;
          }
          job.resolve({
            ok: false,
            status: res.status,
            ac: [],
            error: `HTTP ${res.status}`,
            rateLimited: true,
          });
          continue;
        }

        if (!res.ok) {
          nextAllowedAt = Math.max(nextAllowedAt, Date.now() + BOX_GAP_MS);
          job.resolve({
            ok: false,
            status: res.status,
            ac: [],
            error: `HTTP ${res.status}`,
          });
          continue;
        }

        const json = (await res.json()) as { ac?: AdsbAc[] };
        const ac = json.ac ?? [];
        noteSuccess();
        if (job.url === MIL_URL) {
          milCache = { at: Date.now(), ac, status: res.status };
        }
        job.resolve({ ok: true, status: res.status, ac });
      } catch (err) {
        nextAllowedAt = Math.max(nextAllowedAt, Date.now() + BOX_GAP_MS);
        job.resolve({
          ok: false,
          status: 0,
          ac: [],
          error: String(err).slice(0, 80),
        });
      }

      // Enforce gap even after errors so we don't stampede.
      nextAllowedAt = Math.max(nextAllowedAt, Date.now() + BOX_GAP_MS);
    }
  } finally {
    pumping = false;
    if (queue.length > 0) void pump();
  }
}

/**
 * Enqueue a single adsb.lol GET. Levant priority jumps the queue.
 * Never fires parallel HTTP — one in flight globally.
 */
export function fetchAdsbLol(
  url: string,
  opts?: { id?: string; priority?: AdsbPriority },
): Promise<AdsbFetchResult> {
  const id = opts?.id ?? url;
  const priority = opts?.priority ?? "other";
  return new Promise<AdsbFetchResult>((resolve) => {
    const existing = queue.find((j) => j.url === url);
    if (existing) {
      const prev = existing.resolve;
      existing.resolve = (r) => {
        prev(r);
        resolve(r);
      };
      if (PRIORITY_RANK[priority] < PRIORITY_RANK[existing.priority]) {
        existing.priority = priority;
        existing.id = id;
      }
      return;
    }
    queue.push({ id, url, priority, attempts: 0, resolve });
    void pump();
  });
}

/** Convenience: mil endpoint with shared cache. */
export function fetchAdsbMil(
  priority: AdsbPriority = "other",
): Promise<AdsbFetchResult> {
  return fetchAdsbLol(MIL_URL, { id: "mil", priority });
}

/** Whether the shared client is currently in 429 backoff. */
export function adsbLolBackingOff(): boolean {
  return Date.now() < backoffUntil;
}

export function adsbLolBackoffRemainingMs(): number {
  return Math.max(0, backoffUntil - Date.now());
}

/** Invalidate mil cache (tests / force refresh). */
export function clearAdsbMilCache(): void {
  milCache = null;
}

/**
 * Round-robin picker for wide-theater geo boxes.
 * Always keeps Gulf + `alwaysPoll` corridor tiles; rotates `perCycle` others.
 */
export function rotateTheaterBoxes<
  T extends { countsForGulfRegime: boolean; alwaysPoll?: boolean },
>(
  boxes: T[],
  state: { idx: number },
  perCycle = 2,
): { selected: T[]; nextIdx: number } {
  const pinned: T[] = [];
  const pinnedSet = new Set<T>();
  for (const b of boxes) {
    if (!b.countsForGulfRegime && !b.alwaysPoll) continue;
    if (pinnedSet.has(b)) continue;
    pinnedSet.add(b);
    pinned.push(b);
  }
  const others = boxes.filter((b) => !pinnedSet.has(b));
  if (others.length === 0) return { selected: pinned, nextIdx: state.idx };
  const n = Math.min(perCycle, others.length);
  const selectedOthers: T[] = [];
  for (let i = 0; i < n; i += 1) {
    selectedOthers.push(others[(state.idx + i) % others.length]!);
  }
  const nextIdx = (state.idx + n) % others.length;
  return { selected: [...pinned, ...selectedOthers], nextIdx };
}
