/**
 * OpenSky Network anonymous ADS-B failover — used only when adsb.lol
 * 429/fails for Levant AER-01 and/or Gulf theater boxes.
 *
 * Anonymous credits (~400/day); bbox cost scales with area. Do not poll on
 * the hot path — callers invoke only after primary failure. Min gap + 429
 * backoff prevent hammers. Label tracks `opensky` (never claim adsb.lol).
 *
 * Docs: https://openskynetwork.github.io/opensky-api/rest.html
 */

import type { AdsbAc } from "./adsbLol";

export type OpenSkyFetchResult = {
  ok: boolean;
  status: number;
  ac: AdsbAc[];
  error?: string;
  rateLimited?: boolean;
  source: "opensky";
};

const OPENSKY_BASE = "https://opensky-network.org/api/states/all";
const TIMEOUT_MS = 16_000;
/** Hard floor between any two OpenSky HTTP calls. */
const GAP_MS = 12_000;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 15 * 60_000;

let nextAllowedAt = 0;
let backoffUntil = 0;
let backoffStreak = 0;

export type OpenSkyBbox = {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
};

/** Combined Levant + Med approach + Israel core (AER-01 failover). */
export const OPENSKY_LEVANT_BBOX: OpenSkyBbox = {
  lamin: 29.4,
  lomin: 28.0,
  lamax: 36.5,
  lomax: 37.5,
};

/** Persian Gulf / Hormuz (theater mass_stack failover). */
export const OPENSKY_GULF_BBOX: OpenSkyBbox = {
  lamin: 23.0,
  lomin: 47.5,
  lamax: 31.0,
  lomax: 61.5,
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function noteRateLimit(retryAfterSec?: number | null): void {
  backoffStreak += 1;
  const exp = Math.min(
    BACKOFF_MAX_MS,
    BACKOFF_BASE_MS * 2 ** Math.min(backoffStreak - 1, 3),
  );
  const wait =
    retryAfterSec != null && Number.isFinite(retryAfterSec)
      ? Math.min(BACKOFF_MAX_MS, Math.max(5_000, retryAfterSec * 1000))
      : exp;
  backoffUntil = Math.max(backoffUntil, Date.now() + wait);
  nextAllowedAt = Math.max(nextAllowedAt, backoffUntil);
}

function noteSuccess(): void {
  backoffStreak = 0;
  nextAllowedAt = Math.max(nextAllowedAt, Date.now() + GAP_MS);
}

export function openSkyBackingOff(): boolean {
  return Date.now() < backoffUntil;
}

export function openSkyBackoffRemainingMs(): number {
  return Math.max(0, backoffUntil - Date.now());
}

/**
 * OpenSky has no aircraft-type / mil dbFlags. Callsign heuristics only —
 * never invent tanker/AWACS from civvie traffic.
 */
export function openSkyLooksMilCallsign(callsign: string): boolean {
  const cs = callsign.trim().toUpperCase();
  if (!cs) return false;
  return /^(RCH|REACH|BLUE\d|SHELL|TEXACO|ESSO|NATO|AWACS|NAVY|CNVRY|DUKE|FORTE|SENTRY|MAGIC|NATO\d)/.test(
    cs,
  );
}

function mpsToKt(mps: number | null): number | undefined {
  if (mps == null || !Number.isFinite(mps)) return undefined;
  return mps * 1.94384;
}

function metersToFt(m: number | null): number | undefined {
  if (m == null || !Number.isFinite(m)) return undefined;
  return m * 3.28084;
}

/**
 * OpenSky state vector indices:
 * 0 icao24, 1 callsign, 2 origin_country, 3 time_position, 4 last_contact,
 * 5 lon, 6 lat, 7 baro_alt_m, 8 on_ground, 9 velocity_mps, 10 true_track,
 * 11 vertical_rate, 12 sensors, 13 geo_alt_m, 14 squawk, 15 spi, 16 pos_source
 */
export function openSkyStateToAdsbAc(row: unknown[]): AdsbAc | null {
  if (!Array.isArray(row) || row.length < 8) return null;
  const hex = String(row[0] ?? "")
    .trim()
    .toLowerCase();
  if (!hex) return null;
  const lat = typeof row[6] === "number" ? row[6] : Number(row[6]);
  const lon = typeof row[5] === "number" ? row[5] : Number(row[5]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const callsign = String(row[1] ?? "").trim();
  const onGround = row[8] === true;
  const baroM =
    typeof row[7] === "number"
      ? row[7]
      : row[7] != null
        ? Number(row[7])
        : null;
  const geoM =
    typeof row[13] === "number"
      ? row[13]
      : row[13] != null
        ? Number(row[13])
        : null;
  const vel =
    typeof row[9] === "number"
      ? row[9]
      : row[9] != null
        ? Number(row[9])
        : null;
  const track =
    typeof row[10] === "number"
      ? row[10]
      : row[10] != null
        ? Number(row[10])
        : null;

  const milish = openSkyLooksMilCallsign(callsign);
  return {
    hex,
    flight: callsign || undefined,
    lat,
    lon,
    alt_baro: onGround ? "ground" : metersToFt(baroM ?? geoM),
    alt_geom: metersToFt(geoM ?? null),
    gs: mpsToKt(vel),
    track: track != null && Number.isFinite(track) ? track : undefined,
    true_heading: track != null && Number.isFinite(track) ? track : undefined,
    // Soft mil flag only for callsign heuristics — OpenSky has no type catalog.
    dbFlags: milish ? 1 : 0,
    t: undefined,
    desc: milish ? "opensky mil-callsign heuristic" : "opensky (type unknown)",
  };
}

/**
 * Single bbox GET. Respects shared gap/backoff. Returns empty on soft skip
 * (still backing off) so callers fall through to last-good without 429 spam.
 */
async function fetchOpenSkyUrl(
  url: string,
  id: string,
  opts?: { force?: boolean },
): Promise<OpenSkyFetchResult> {
  const now = Date.now();
  if (!opts?.force && now < backoffUntil) {
    return {
      ok: false,
      status: 429,
      ac: [],
      error: `opensky backoff ${Math.round((backoffUntil - now) / 1000)}s (${id})`,
      rateLimited: true,
      source: "opensky",
    };
  }

  const wait = Math.max(0, nextAllowedAt - Date.now());
  if (wait > 0) await sleep(wait);

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Tradehole/0.2 (opensky-failover)",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 429 || res.status === 420) {
      const retryRaw = res.headers.get("x-rate-limit-retry-after-seconds");
      const retrySec = retryRaw != null ? Number(retryRaw) : null;
      noteRateLimit(Number.isFinite(retrySec) ? retrySec : null);
      return {
        ok: false,
        status: res.status,
        ac: [],
        error: `HTTP ${res.status}`,
        rateLimited: true,
        source: "opensky",
      };
    }

    if (!res.ok) {
      nextAllowedAt = Math.max(nextAllowedAt, Date.now() + GAP_MS);
      return {
        ok: false,
        status: res.status,
        ac: [],
        error: `HTTP ${res.status}`,
        source: "opensky",
      };
    }

    const json = (await res.json()) as { states?: unknown[][] | null };
    const states = Array.isArray(json.states) ? json.states : [];
    const ac: AdsbAc[] = [];
    const seen = new Set<string>();
    for (const row of states) {
      const a = openSkyStateToAdsbAc(row);
      if (!a?.hex || seen.has(a.hex)) continue;
      seen.add(a.hex);
      ac.push(a);
    }
    noteSuccess();
    return { ok: true, status: res.status, ac, source: "opensky" };
  } catch (err) {
    nextAllowedAt = Math.max(nextAllowedAt, Date.now() + GAP_MS);
    return {
      ok: false,
      status: 0,
      ac: [],
      error: String(err).slice(0, 80),
      source: "opensky",
    };
  }
}

/**
 * Single bbox GET. Respects shared gap/backoff. Returns empty on soft skip
 * (still backing off) so callers fall through to last-good without 429 spam.
 */
export async function fetchOpenSkyBbox(
  bbox: OpenSkyBbox,
  opts?: { id?: string; force?: boolean },
): Promise<OpenSkyFetchResult> {
  const id = opts?.id ?? "opensky";
  const url = `${OPENSKY_BASE}?lamin=${bbox.lamin}&lomin=${bbox.lomin}&lamax=${bbox.lamax}&lomax=${bbox.lomax}`;
  return fetchOpenSkyUrl(url, id, opts);
}

/**
 * Worldwide lookup by ICAO24 — follow watchlist hexes that left the bbox.
 * Caps to 10 addresses per call. Same gap/backoff as bbox.
 */
export async function fetchOpenSkyIcaos(
  hexes: string[],
  opts?: { id?: string; force?: boolean },
): Promise<OpenSkyFetchResult> {
  const icaos = [
    ...new Set(
      hexes
        .map((h) => h.replace("~", "").trim().toLowerCase())
        .filter((h) => /^[0-9a-f]{6}$/.test(h)),
    ),
  ].slice(0, 10);
  if (icaos.length === 0) {
    return { ok: true, status: 200, ac: [], source: "opensky" };
  }
  const q = icaos.map((h) => `icao24=${encodeURIComponent(h)}`).join("&");
  return fetchOpenSkyUrl(
    `${OPENSKY_BASE}?${q}`,
    opts?.id ?? "opensky-icao",
    opts,
  );
}
