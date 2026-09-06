import { singleFlight } from "./singleFlight";
import { readLastGood, writeLastGood } from "./lastGoodStore";

/** Honesty flags — scoring fields on T must stay unchanged. */
export type CacheMeta = {
  stale: boolean;
  fromCache: boolean;
  servedAgeMs: number;
  rebuilding: boolean;
  degradedReason: string | null;
};

export type LastGoodSnap<T> = { value: T; at: number };

function freshMeta(ageMs: number): CacheMeta {
  return {
    stale: false,
    fromCache: false,
    servedAgeMs: ageMs,
    rebuilding: false,
    degradedReason: null,
  };
}

function staleMeta(
  ageMs: number,
  rebuilding: boolean,
  label: string,
  extra?: string,
): CacheMeta {
  const ageSec = Math.max(0, Math.round(ageMs / 1000));
  const reason =
    extra ??
    `Serving last-good ${label} (${ageSec}s old)${rebuilding ? " — rebuild running" : ""}.`;
  return {
    stale: true,
    fromCache: true,
    servedAgeMs: ageMs,
    rebuilding,
    degradedReason: reason,
  };
}

/** Serialize background first-paint rebuilds so 6 panels don't share one IRONSIGHT/ADS-B stampede. */
const REBUILD_PRIORITY: Record<string, number> = {
  buildTheaterWatch: 0,
  buildIsraelStrikeTells: 1,
  getDecisionFootprint: 2,
  getMarketSurprise: 3,
  buildFroCatalyst: 4,
};

type QueuedRebuild = { key: string; pri: number; run: () => Promise<unknown> };
const rebuildQueue: QueuedRebuild[] = [];
const queuedKeys = new Set<string>();
let draining = false;

async function drainRebuildQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (rebuildQueue.length) {
      rebuildQueue.sort((a, b) => a.pri - b.pri);
      const next = rebuildQueue.shift();
      if (!next) break;
      try {
        await next.run();
      } catch (err) {
        console.warn(`[tradehole] queued rebuild ${next.key} failed:`, err);
      } finally {
        queuedKeys.delete(next.key);
      }
    }
  } finally {
    draining = false;
    if (rebuildQueue.length) void drainRebuildQueue();
  }
}

function enqueueRebuild(flightKey: string, run: () => Promise<unknown>): void {
  const key = flightKey.replace(/:force$/, "");
  if (queuedKeys.has(key)) return;
  queuedKeys.add(key);
  rebuildQueue.push({
    key,
    pri: REBUILD_PRIORITY[key] ?? 10,
    run,
  });
  void drainRebuildQueue();
}

export function resetLastGoodQueueForTests(): void {
  rebuildQueue.length = 0;
  queuedKeys.clear();
  draining = false;
}

/**
 * If last-good exists (memory or disk), return it immediately (labeled stale when
 * past TTL) and rebuild in the background. With `empty`, never block the HTTP
 * handler — return a rebuilding stub so first paint cannot hang past AbortSignal.
 */
export async function serveLastGood<T extends object>(opts: {
  flightKey: string;
  force?: boolean;
  freshTtlMs: number;
  label: string;
  persistKey?: string;
  get: () => LastGoodSnap<T> | null;
  set?: (snap: LastGoodSnap<T>) => void;
  build: () => Promise<T>;
  empty?: () => T;
}): Promise<T & CacheMeta> {
  const force = opts.force === true;

  const hydrate = (): LastGoodSnap<T> | null => {
    const mem = opts.get();
    if (mem) return mem;
    if (!opts.persistKey) return null;
    const disk = readLastGood<T>(opts.persistKey);
    if (disk) opts.set?.(disk);
    return disk;
  };

  const runBuild = () =>
    singleFlight(opts.flightKey, async () => {
      const value = await opts.build();
      const at = Date.now();
      if (opts.persistKey) writeLastGood(opts.persistKey, value, at);
      return value;
    });

  const snap = hydrate();
  const ageMs = snap ? Date.now() - snap.at : 0;
  const isFresh = Boolean(snap && ageMs <= opts.freshTtlMs);

  if (!force && snap && isFresh) {
    return { ...snap.value, ...freshMeta(ageMs) };
  }

  if (!force && snap) {
    enqueueRebuild(opts.flightKey, () =>
      runBuild().catch((err) => {
        console.warn(`[tradehole] ${opts.label} background rebuild failed:`, err);
      }),
    );
    return { ...snap.value, ...staleMeta(ageMs, true, opts.label) };
  }

  // Cold: no memory and no disk last-good.
  if (!force && opts.empty) {
    enqueueRebuild(opts.flightKey, () =>
      runBuild().catch((err) => {
        console.warn(`[tradehole] ${opts.label} first rebuild failed:`, err);
      }),
    );
    return {
      ...opts.empty(),
      ...staleMeta(
        0,
        true,
        opts.label,
        `Rebuilding ${opts.label} — no last-good yet (first paint after launch).`,
      ),
    };
  }

  try {
    const value = await runBuild();
    return { ...value, ...freshMeta(0) };
  } catch (err) {
    const fallback = hydrate();
    if (fallback) {
      return {
        ...fallback.value,
        ...staleMeta(
          Date.now() - fallback.at,
          false,
          opts.label,
          `Rebuild failed (${String(err).slice(0, 100)}) — serving last-good ${opts.label}.`,
        ),
      };
    }
    throw err;
  }
}
