/**
 * Hex watchlist: enroll mil/tanker/AWACS seen anywhere in the wide theater
 * footprint (Med → Gulf → Horn → Iran, ~10°E–80°E · 5°S–45°N), then keep
 * pinging them globally while they still transmit. AER-01 scoring stays
 * Levant-box only; Gulf mass_stack stays Gulf-box only.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchAdsbLol, type AdsbAc } from "../adsbLol";
import { classifyAerialKind, isCivOrVipAirframe, isFollowWorthyMil } from "./aerialClassify";

export type FollowKind = "tanker" | "awacs" | "mil";

export type AerialWatch = {
  hex: string;
  callsign: string;
  kind: FollowKind;
  acType: string;
  desc?: string;
  enrolledAt: string;
  lastSeenAt: string;
  lastLookupAt: number;
  lat: number;
  lon: number;
  origin: "levant" | "theater";
  missStreak: number;
  /** Last-good kinematics — kept while DARK so the board still has heading. */
  trackDeg: number | null;
  gsKt: number | null;
  altFt: number | null;
};

/** Med / Levant / Red Sea / Horn / Arabia / Gulf / Iran — enroll footprint. */
export const WIDE_THEATER_FOOTPRINT = {
  latMin: -5,
  latMax: 45,
  lonMin: 10,
  lonMax: 80,
};

export const WATCH_MAX = 80;
/** Drop after this long with no live ping (still hex-lookup until then). */
export const FOLLOW_SILENT_TTL_MS = 90 * 60 * 1000;
/** Desk/map sticky window for tankers/AWACS (EMCON / 429) — display only. */
export const TANKER_STICKY_TTL_MS = 30 * 60 * 1000;
/** Desk/map sticky window for other enrolled mil. */
export const MIL_STICKY_TTL_MS = 20 * 60 * 1000;
const LOOKUP_GAP_MS = 45_000;
/** Hex pings per IST cycle — follow priority, never jumps Levant boxes. */
export const HEX_LOOKUPS_PER_CYCLE = 8;
const STORE_NAME = "aerial-follow.json";

const watchByHex = new Map<string, AerialWatch>();
let hydrated = false;

export function normalizeHex(raw: string | undefined | null): string {
  return (raw ?? "").replace("~", "").trim().toLowerCase();
}

export function hasPos(a: Pick<AdsbAc, "lat" | "lon">): boolean {
  return (
    a.lat != null &&
    a.lon != null &&
    Number.isFinite(a.lat) &&
    Number.isFinite(a.lon)
  );
}

export function stickyDisplayTtlMs(kind: FollowKind): number {
  return kind === "tanker" || kind === "awacs"
    ? TANKER_STICKY_TTL_MS
    : MIL_STICKY_TTL_MS;
}

export function kinematicsFromAc(a: AdsbAc): {
  trackDeg: number | null;
  gsKt: number | null;
  altFt: number | null;
} {
  const trackRaw =
    a.track != null && Number.isFinite(a.track)
      ? a.track
      : a.true_heading != null && Number.isFinite(a.true_heading)
        ? a.true_heading
        : null;
  const gsKt = a.gs != null && Number.isFinite(a.gs) ? a.gs : null;
  const altRaw = a.alt_baro ?? a.alt_geom;
  let altFt: number | null = null;
  if (typeof altRaw === "number" && Number.isFinite(altRaw)) altFt = altRaw;
  else if (typeof altRaw === "string" && !/ground/i.test(altRaw)) {
    const n = Number(altRaw);
    altFt = Number.isFinite(n) ? n : null;
  }
  return { trackDeg: trackRaw, gsKt, altFt };
}

export function looksLanded(a: AdsbAc): boolean {
  const altRaw = a.alt_baro ?? a.alt_geom;
  if (typeof altRaw === "string" && /ground/i.test(altRaw)) return true;
  const alt =
    typeof altRaw === "number"
      ? altRaw
      : typeof altRaw === "string"
        ? Number(altRaw)
        : NaN;
  const gs = a.gs != null && Number.isFinite(a.gs) ? a.gs : null;
  if (Number.isFinite(alt) && alt <= 200 && (gs == null || gs < 50)) {
    return true;
  }
  if (gs != null && gs < 30 && Number.isFinite(alt) && alt < 1500) {
    return true;
  }
  return false;
}

export function inWideTheaterFootprint(a: Pick<AdsbAc, "lat" | "lon">): boolean {
  if (!hasPos(a)) return false;
  return (
    a.lat! >= WIDE_THEATER_FOOTPRINT.latMin &&
    a.lat! <= WIDE_THEATER_FOOTPRINT.latMax &&
    a.lon! >= WIDE_THEATER_FOOTPRINT.lonMin &&
    a.lon! <= WIDE_THEATER_FOOTPRINT.lonMax
  );
}

/** AER-01 scoring boxes — theater must not re-stamp these as gulf_adsb. */
export function inLevantStrikeBox(a: Pick<AdsbAc, "lat" | "lon">): boolean {
  if (!hasPos(a)) return false;
  const lat = a.lat!;
  const lon = a.lon!;
  const levant = lat >= 29.5 && lat <= 36.5 && lon >= 31 && lon <= 37.5;
  const med = lat >= 31.5 && lat <= 36.5 && lon >= 28 && lon <= 35.5;
  const israel = lat >= 29.4 && lat <= 33.4 && lon >= 34.2 && lon <= 35.9;
  return levant || med || israel;
}

export function shouldEnroll(a: AdsbAc): boolean {
  if (!hasPos(a) || looksLanded(a)) return false;
  const cs = (a.flight ?? "").trim();
  const type = a.t ?? "";
  const desc = a.desc ?? "";
  if (isFollowWorthyMil(type, desc, cs)) return true;
  if (isCivOrVipAirframe(type)) return false;
  const flags = a.dbFlags ?? 0;
  if (!(flags & 1) && !(flags & 2)) return false;
  // Untyped mil flag: only inside core ME/Gulf/Horn, not Italy/Balkans/Aegean VIP.
  return (
    a.lon! >= 28 &&
    a.lon! <= 62.5 &&
    a.lat! >= 12 &&
    a.lat! <= 37.5
  );
}

function kindOf(a: AdsbAc): FollowKind {
  return classifyAerialKind(
    a.t ?? "",
    a.desc ?? "",
    (a.flight ?? "").trim(),
    "mil",
  );
}

/** Coarse desk label — not a go-gate. */
export function followRegionHint(lat: number, lon: number): string {
  if (lon >= 28 && lon <= 38.5 && lat >= 29 && lat <= 37.5) {
    return "Levant/E-Med";
  }
  if (lon >= 38.5 && lon <= 49 && lat >= 29 && lat <= 37.5) {
    return "Iraq/Jazira";
  }
  if (lon >= 47 && lon <= 62.5 && lat >= 16.5 && lat <= 34.5) {
    return "Gulf/Hormuz";
  }
  if (lon >= 32 && lon <= 58 && lat >= -4 && lat <= 31) {
    return "Red Sea/Horn";
  }
  if (lon >= 24 && lon < 32 && lat >= 29 && lat <= 34) return "Egypt/west";
  if (lon >= 26 && lon <= 45 && lat > 37.5 && lat <= 43) return "Turkey/Black Sea";
  if (lon >= 10 && lon < 28 && lat >= 30 && lat <= 46) return "Central Med/EU";
  if (lon >= -15 && lon < 10 && lat >= 35 && lat <= 60) return "W Europe";
  if (lon >= -130 && lon <= -60 && lat >= 20 && lat <= 55) return "CONUS";
  if (lon >= 60 && lon <= 80 && lat >= 20 && lat <= 40) return "Iran plateau/Pakistan";
  return `${lat.toFixed(1)}N ${lon.toFixed(1)}E`;
}

function dataDir(): string {
  if (process.env.TRADEHOLE_DATA_DIR) return process.env.TRADEHOLE_DATA_DIR;
  return path.join(os.homedir(), "Library", "Application Support", "Tradehole");
}

function storePath(): string {
  return path.join(dataDir(), STORE_NAME);
}

function persistWatchlist(): void {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(
      storePath(),
      JSON.stringify(
        { at: Date.now(), watches: [...watchByHex.values()] },
        null,
        2,
      ),
      "utf8",
    );
  } catch (err) {
    console.warn("[tradehole] aerial follow persist failed:", err);
  }
}

export function hydrateAerialFollowFromDisk(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const json = JSON.parse(fs.readFileSync(storePath(), "utf8")) as {
      watches?: AerialWatch[];
    };
    const now = Date.now();
    for (const w of json.watches ?? []) {
      const hex = normalizeHex(w.hex);
      if (!hex || !Number.isFinite(w.lat) || !Number.isFinite(w.lon)) continue;
      const seen = Date.parse(w.lastSeenAt) || 0;
      if (now - seen > FOLLOW_SILENT_TTL_MS) continue;
      watchByHex.set(hex, {
        hex,
        callsign: String(w.callsign ?? "—"),
        kind: w.kind === "tanker" || w.kind === "awacs" ? w.kind : "mil",
        acType: String(w.acType ?? "?"),
        desc: w.desc ? String(w.desc) : undefined,
        enrolledAt: w.enrolledAt || w.lastSeenAt,
        lastSeenAt: w.lastSeenAt,
        lastLookupAt: Number(w.lastLookupAt) || 0,
        lat: w.lat,
        lon: w.lon,
        origin: w.origin === "theater" ? "theater" : "levant",
        missStreak: Number(w.missStreak) || 0,
        trackDeg:
          w.trackDeg != null && Number.isFinite(w.trackDeg) ? w.trackDeg : null,
        gsKt: w.gsKt != null && Number.isFinite(w.gsKt) ? w.gsKt : null,
        altFt: w.altFt != null && Number.isFinite(w.altFt) ? w.altFt : null,
      });
    }
  } catch {
    /* missing */
  }
  pruneUnworthyWatches();
}

export function getAerialWatchlist(): AerialWatch[] {
  hydrateAerialFollowFromDisk();
  return [...watchByHex.values()];
}

export function isWatchedHex(hex: string): boolean {
  hydrateAerialFollowFromDisk();
  return watchByHex.has(normalizeHex(hex));
}

export function dropWatch(hex: string): void {
  const h = normalizeHex(hex);
  if (watchByHex.delete(h)) persistWatchlist();
}

function pruneUnworthyWatches(): void {
  let dirty = false;
  for (const [hex, w] of [...watchByHex.entries()]) {
    const fake: AdsbAc = {
      hex,
      flight: w.callsign,
      t: w.acType,
      desc: w.desc,
      lat: w.lat,
      lon: w.lon,
      gs: 200,
      alt_baro: 10_000,
      dbFlags: 1,
    };
    if (shouldEnroll(fake)) continue;
    watchByHex.delete(hex);
    dirty = true;
  }
  if (dirty) persistWatchlist();
}

function trimWatchlist(): void {
  if (watchByHex.size <= WATCH_MAX) return;
  const byAge = (a: AerialWatch, b: AerialWatch) =>
    Date.parse(a.lastSeenAt) - Date.parse(b.lastSeenAt);
  const mil = [...watchByHex.values()]
    .filter((w) => w.kind === "mil")
    .sort(byAge);
  while (watchByHex.size > WATCH_MAX && mil.length) {
    const oldest = mil.shift();
    if (oldest) watchByHex.delete(oldest.hex);
  }
  if (watchByHex.size <= WATCH_MAX) return;
  const vip = [...watchByHex.values()]
    .filter((w) => w.kind === "tanker" || w.kind === "awacs")
    .sort(byAge);
  while (watchByHex.size > WATCH_MAX && vip.length) {
    const oldest = vip.shift();
    if (oldest) watchByHex.delete(oldest.hex);
  }
}

export function seedWatchFromTracks(
  tracks: Array<{
    hex: string;
    callsign: string;
    kind: FollowKind | string;
    acType: string;
    desc?: string;
    lat: number;
    lon: number;
    lastSeenAt?: string;
    gsKt?: number | null;
    altFt?: number | null;
    trackDeg?: number | null;
  }>,
  nowIso: string,
): void {
  hydrateAerialFollowFromDisk();
  if (watchByHex.size > 0) return;
  let dirty = false;
  for (const t of tracks) {
    const hex = normalizeHex(t.hex);
    if (!hex || !Number.isFinite(t.lat) || !Number.isFinite(t.lon)) continue;
    if (watchByHex.has(hex)) continue;
    const alt = t.altFt;
    const gs = t.gsKt;
    if (alt != null && alt < 500 && (gs == null || gs < 50)) continue;
    if (isCivOrVipAirframe(t.acType) && t.kind !== "tanker" && t.kind !== "awacs") {
      continue;
    }
    if (
      t.kind !== "tanker" &&
      t.kind !== "awacs" &&
      !isFollowWorthyMil(t.acType, t.desc ?? "", t.callsign)
    ) {
      continue;
    }
    const kind: FollowKind =
      t.kind === "tanker" || t.kind === "awacs" ? t.kind : "mil";
    watchByHex.set(hex, {
      hex,
      callsign: t.callsign || "—",
      kind,
      acType: t.acType || "?",
      desc: t.desc,
      enrolledAt: t.lastSeenAt || nowIso,
      lastSeenAt: t.lastSeenAt || nowIso,
      lastLookupAt: 0,
      lat: t.lat,
      lon: t.lon,
      origin: "levant",
      missStreak: 0,
      trackDeg: t.trackDeg ?? null,
      gsKt: t.gsKt ?? null,
      altFt: t.altFt ?? null,
    });
    dirty = true;
  }
  if (dirty) {
    trimWatchlist();
    persistWatchlist();
  }
}

export function enrollWatch(
  ac: AdsbAc[],
  nowIso: string,
  origin: "levant" | "theater" = "theater",
): void {
  hydrateAerialFollowFromDisk();
  pruneUnworthyWatches();
  let dirty = false;
  for (const a of ac) {
    if (!shouldEnroll(a)) continue;
    const hex = normalizeHex(a.hex);
    if (!hex || !hasPos(a)) continue;
    const prev = watchByHex.get(hex);
    const kin = kinematicsFromAc(a);
    watchByHex.set(hex, {
      hex,
      callsign: (a.flight ?? "").trim() || prev?.callsign || "—",
      kind: kindOf(a),
      acType: a.t || a.desc || prev?.acType || "?",
      desc: a.desc || prev?.desc,
      enrolledAt: prev?.enrolledAt ?? nowIso,
      lastSeenAt: nowIso,
      lastLookupAt: prev?.lastLookupAt ?? 0,
      lat: a.lat!,
      lon: a.lon!,
      origin: prev?.origin ?? origin,
      missStreak: 0,
      trackDeg: kin.trackDeg ?? prev?.trackDeg ?? null,
      gsKt: kin.gsKt ?? prev?.gsKt ?? null,
      altFt: kin.altFt ?? prev?.altFt ?? null,
    });
    dirty = true;
  }
  if (dirty) {
    trimWatchlist();
    persistWatchlist();
  }
}

/** Levant/Med/Israel scoring boxes — also used as origin tag. */
export function enrollLevantWatch(ac: AdsbAc[], nowIso: string): void {
  enrollWatch(ac, nowIso, "levant");
}

/** Any mil/tanker/AWACS currently inside the wide theater footprint. */
export function enrollWideTheaterWatch(ac: AdsbAc[], nowIso: string): void {
  enrollWatch(
    ac.filter((a) => inWideTheaterFootprint(a)),
    nowIso,
    "theater",
  );
}

export function touchWatchFromAc(a: AdsbAc, nowIso: string): void {
  const hex = normalizeHex(a.hex);
  const prev = watchByHex.get(hex);
  if (!prev || !hasPos(a)) return;
  const kin = kinematicsFromAc(a);
  watchByHex.set(hex, {
    ...prev,
    callsign: (a.flight ?? "").trim() || prev.callsign,
    kind: kindOf(a),
    acType: a.t || a.desc || prev.acType,
    desc: a.desc || prev.desc,
    lastSeenAt: nowIso,
    lat: a.lat!,
    lon: a.lon!,
    missStreak: 0,
    trackDeg: kin.trackDeg ?? prev.trackDeg,
    gsKt: kin.gsKt ?? prev.gsKt,
    altFt: kin.altFt ?? prev.altFt,
  });
}

export type WatchLastGood = AerialWatch & {
  ageSec: number;
  stale: true;
};

/**
 * Display-only last-known for enrolled hexes missing from this cycle's dump.
 * Does not score AER-01 / Gulf mass_stack.
 */
export function collectWatchlistLastGood(
  liveHexes: Set<string>,
  now = Date.now(),
): WatchLastGood[] {
  hydrateAerialFollowFromDisk();
  const out: WatchLastGood[] = [];
  for (const w of watchByHex.values()) {
    if (liveHexes.has(w.hex)) continue;
    const seen = Date.parse(w.lastSeenAt) || 0;
    const ageMs = Math.max(0, now - seen);
    if (ageMs > stickyDisplayTtlMs(w.kind)) continue;
    if (!Number.isFinite(w.lat) || !Number.isFinite(w.lon)) continue;
    out.push({
      ...w,
      ageSec: Math.max(0, Math.round(ageMs / 1000)),
      stale: true,
    });
  }
  out.sort((a, b) => {
    const rank = (k: FollowKind) =>
      k === "tanker" ? 0 : k === "awacs" ? 1 : 2;
    return rank(a.kind) - rank(b.kind) || a.ageSec - b.ageSec;
  });
  return out;
}

/** Split a dump of aircraft into in-box vs watched-outbound. */
export function partitionWatchHits(args: {
  acs: AdsbAc[];
  inBox: (a: AdsbAc) => boolean;
  watchHexes?: Set<string>;
}): { inBox: AdsbAc[]; followed: AdsbAc[]; foundHexes: Set<string> } {
  hydrateAerialFollowFromDisk();
  const watch =
    args.watchHexes ?? new Set([...watchByHex.keys()]);
  const seen = new Set<string>();
  const inBox: AdsbAc[] = [];
  const followed: AdsbAc[] = [];
  const foundHexes = new Set<string>();
  for (const a of args.acs) {
    const hex = normalizeHex(a.hex);
    if (!hex || seen.has(hex) || !hasPos(a)) continue;
    seen.add(hex);
    foundHexes.add(hex);
    if (args.inBox(a)) {
      inBox.push(a);
      continue;
    }
    if (watch.has(hex) && !looksLanded(a)) followed.push(a);
  }
  return { inBox, followed, foundHexes };
}

export function noteWatchMisses(foundHexes: Set<string>, nowIso: string): string[] {
  hydrateAerialFollowFromDisk();
  const now = Date.parse(nowIso) || Date.now();
  const dropped: string[] = [];
  for (const [hex, w] of [...watchByHex.entries()]) {
    if (foundHexes.has(hex)) continue;
    const age = now - (Date.parse(w.lastSeenAt) || 0);
    const next: AerialWatch = { ...w, missStreak: w.missStreak + 1 };
    if (age > FOLLOW_SILENT_TTL_MS) {
      watchByHex.delete(hex);
      dropped.push(hex);
      continue;
    }
    watchByHex.set(hex, next);
  }
  if (dropped.length) persistWatchlist();
  else persistWatchlist();
  return dropped;
}

export function dropLandedWatches(acs: AdsbAc[]): string[] {
  const dropped: string[] = [];
  for (const a of acs) {
    const hex = normalizeHex(a.hex);
    if (!hex || !watchByHex.has(hex)) continue;
    if (!looksLanded(a)) continue;
    watchByHex.delete(hex);
    dropped.push(hex);
  }
  if (dropped.length) persistWatchlist();
  return dropped;
}

export function pickFollowLookups(missingHexes: string[], now = Date.now()): string[] {
  hydrateAerialFollowFromDisk();
  const rows = missingHexes
    .map((h) => watchByHex.get(normalizeHex(h)))
    .filter((w): w is AerialWatch => !!w)
    .filter((w) => now - w.lastLookupAt >= LOOKUP_GAP_MS)
    .sort((a, b) => {
      const rank = (k: FollowKind) => (k === "tanker" || k === "awacs" ? 0 : 1);
      return rank(a.kind) - rank(b.kind) || a.lastLookupAt - b.lastLookupAt;
    });
  const picked = rows.slice(0, HEX_LOOKUPS_PER_CYCLE);
  for (const w of picked) {
    watchByHex.set(w.hex, { ...w, lastLookupAt: now });
  }
  return picked.map((w) => w.hex);
}

export async function fetchAdsbHex(hex: string): Promise<AdsbAc[]> {
  const h = normalizeHex(hex);
  if (!h) return [];
  const result = await fetchAdsbLol(`https://api.adsb.lol/v2/hex/${h}`, {
    id: `hex:${h}`,
    priority: "follow",
  });
  if (!result.ok) return [];
  return result.ac ?? [];
}

/** High-value missing hexes (tankers/AWACS) for OpenSky icao24 failover. */
export function missingHighValueHexes(foundHexes: Set<string>): string[] {
  hydrateAerialFollowFromDisk();
  return [...watchByHex.values()]
    .filter((w) => (w.kind === "tanker" || w.kind === "awacs") && !foundHexes.has(w.hex))
    .map((w) => w.hex);
}

export function missingWatchHexes(foundHexes: Set<string>): string[] {
  hydrateAerialFollowFromDisk();
  return [...watchByHex.keys()].filter((h) => !foundHexes.has(h));
}

/** Test helper — not used in production paths. */
export function resetAerialFollowForTests(): void {
  watchByHex.clear();
  hydrated = true;
}
