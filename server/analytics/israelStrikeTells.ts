/**
 * Israel Strike Pre-Launch Tells (DeepSeek AER/NAV/ELEC/DIP/POL composite)
 * ----------------------------------------------------------------------
 * Free/OSINT only. Optional AISStream.io (AISSTREAM_API_KEY) for Cyprus
 * NAV-01 + Hormuz/Bab plot boxes. MarineTraffic stays deep-link + manual
 * count — no CF/paywall bypass. Honest gaps for FR24 API, GPSJam, GreyNoise,
 * Mode-5.
 *
 * Composite 0–100 + scenario bands. Does NOT auto-trade — alert + FRO
 * HOLD/watch guidance only.
 *
 * EXEC-01 Shekel = lagging confirmation (often spikes ON/AFTER kinetic or
 * when markets price it). Do not wait on Shekel for pre-launch High-go.
 * Decision Footprint 91+ imminent still may require Shekel/oil/NOTAM/aerial
 * elsewhere — leave DF as-is; this module does not gate High-go on FX.
 */
import { fetchNasaFirmsTheater } from "../firmsNasa";
import { getStockQuote } from "../market";
import type { IntelAlarmState } from "../intelAlarm";
import {
  SHEKEL_SPIKE_HARD,
  SHEKEL_SPIKE_FLOOR,
  SHEKEL_THRESHOLD,
  SHEKEL_ROC_FLOOR,
  SHEKEL_ROC_PCT,
} from "../intelAlarm";
import {
  getIsraelStrikeManual,
  type IsraelStrikeManualState,
  type Nav01Posture,
} from "../israelStrikeManual";
import {
  getCyprusAisSnapshot,
  type CyprusAisSnapshot,
} from "../aisstreamCyprus";
import {
  classifyGoLanguageItems,
  formatGoLanguageHit,
} from "./goLanguage";
import {
  classifyFirmsSpike,
  classifyIranBlackoutItems,
  type SoftElevatedArm,
} from "./softElevatedArms";
import { classifyStrategicPressure } from "./strategicPressure";
import { isAerialTanker, isAwacs, classifyAerialKind, isCivOrVipAirframe } from "./aerialClassify";
import {
  collectWatchlistLastGood,
  dropLandedWatches,
  enrollLevantWatch,
  enrollWideTheaterWatch,
  fetchAdsbHex,
  followRegionHint,
  hydrateAerialFollowFromDisk,
  isWatchedHex,
  looksLanded,
  missingHighValueHexes,
  missingWatchHexes,
  noteWatchMisses,
  normalizeHex,
  seedWatchFromTracks,
  pickFollowLookups,
  stickyDisplayTtlMs,
  touchWatchFromAc,
} from "./aerialFollow";
import {
  applyAerialLifecycle,
  type Aer01Churn,
  type AerialDarkReason,
  type AerialDisplayState,
  type AerialEvent,
} from "./aerialEvents";
import {
  adsbLolBackingOff,
  fetchAdsbLol,
  fetchAdsbMil,
  type AdsbAc,
} from "../adsbLol";
import {
  fetchOpenSkyBbox,
  fetchOpenSkyIcaos,
  OPENSKY_LEVANT_BBOX,
  openSkyLooksMilCallsign,
} from "../opensky";
import {
  EXTRA_NOTAM_RSS_QUERIES_LEVANT,
  fetchAwcMeSigmetItems,
  fetchEurocontrolAviationRss,
  mergeAviationNews,
} from "../aviationText";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  archiveAisVessels,
  archiveFirmsPoints,
  archiveLevantAerial,
  archiveMapZones,
  queryDayAerialPeak,
} from "../osintArchive";
import { serveLastGood } from "../lastGoodServe";
import { clearLastGood, readLastGood, writeLastGood } from "../lastGoodStore";
import { fetchIfIronsightUp, probeIronsight } from "../ironsightHealth";

const IRONSIGHT_URL = process.env.IRONSIGHT_URL ?? "http://localhost:3170";

/** Israel / Levant ADS-B box (approx) — AER-01 High-go scoring ONLY. */
const LEVANT_BBOX = {
  latMin: 29.5,
  latMax: 36.5,
  lonMin: 31.0,
  lonMax: 37.5,
};

/** Eastern Med approaches (Cyprus / west of Israel) — AER-01. */
const MED_APPROACH_BBOX = {
  latMin: 31.5,
  latMax: 36.5,
  lonMin: 28.0,
  lonMax: 35.5,
};

/** Israel proper (tighter Hatzerim/Nevatim / LLBG proxy) — AER-01. */
const ISRAEL_CORE_BBOX = {
  latMin: 29.4,
  latMax: 33.4,
  lonMin: 34.2,
  lonMax: 35.9,
};

export type AerialFeedStatus = "ok" | "failed" | "dark" | "degraded";

export type AerialTrackKind = "tanker" | "awacs" | "mil";

export type AerialTrack = {
  hex: string;
  callsign: string;
  kind: AerialTrackKind;
  acType: string;
  /** Raw ADS-B description when present (e.g. "Embraer Legacy 600"). */
  desc?: string;
  lat: number;
  lon: number;
  /** True track degrees (0–360), null if unknown. */
  trackDeg: number | null;
  /** Ground speed knots. */
  gsKt: number | null;
  altFt: number | null;
  /** Coarse vector hint for the desk. */
  bearingHint: "westbound" | "eastbound" | "northbound" | "southbound" | "orbit/unknown";
  /** Recent trail (oldest → newest), for map polylines. */
  trail: Array<{ lat: number; lon: number; at: string }>;
  /** Honest feed label — adsb.lol primary, opensky failover. */
  source?: "adsb.lol" | "opensky";
  /** Inside Levant/Med/Israel AER-01 boxes (scored). */
  inBox?: boolean;
  /** Enrolled in-theater, now tracked outside the scoring boxes. */
  followed?: boolean;
  /** Coarse region while FOLLOWED (Egypt, Gulf, CONUS, …). */
  followRegion?: string;
  enrolledAt?: string;
  /** Desk lifecycle badge — display only. */
  displayState?: AerialDisplayState;
  darkReason?: AerialDarkReason;
  stateDetail?: string;
};

/** Sticky last-good aerial when adsb.lol drops a hex (tankers 30m / mil 20m). */
export type AerialLastGoodTrack = AerialTrack & {
  ageSec: number;
  lastSeenAt: string;
  stale: true;
};

export type FirmsMapPoint = {
  id: string;
  lat: number;
  lon: number;
  box: "hormuz" | "bab" | "israel" | "gaza" | "golan" | "other";
  frp: number | null;
  acqDate: string | null;
  label: string;
};

/** Zone / point overlays for Levant map (NOTAM, AIS box, DIP, ADS-B boxes). */
export type LevantMapZoneKind =
  | "notam"
  | "adsb_box"
  | "cyprus_ais"
  | "dip_border"
  | "nav_watch";

export type LevantMapZone = {
  id: string;
  kind: LevantMapZoneKind;
  label: string;
  status: "quiet" | "warm" | "hot" | "unknown" | "info" | "failed";
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  titles?: string[];
};

export type LevantMapPoint = {
  id: string;
  kind: "ais_vessel";
  label: string;
  category: string;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
};

export type LevantMapOverlays = {
  zones: LevantMapZone[];
  points: LevantMapPoint[];
  notamStatus: "quiet" | "warm" | "hot";
  notamTitles: string[];
  /** NASA FIRMS detections with lat/lon only — empty when feed has counts but no coords. */
  firmsPoints: FirmsMapPoint[];
  firmsNote: string;
};

/** Heuristic FIR/airspace boxes for RSS NOTAM titles (no official geometry). */
const NOTAM_GEO_ZONES: Array<{
  id: string;
  label: string;
  match: RegExp;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}> = [
  {
    id: "notam-cyprus",
    label: "Cyprus / Nicosia FIR",
    match: /Cyprus|Nicosia|Larnaca|Paphos|Ercan|\bLCA\b/i,
    latMin: 34.3,
    latMax: 36.0,
    lonMin: 32.0,
    lonMax: 34.8,
  },
  {
    id: "notam-llbg",
    label: "Israel / LLBG FIR",
    match: /LLBG|Ben\s*Gurion|Israel|Tel\s*Aviv|\bTLV\b|Negev|Hatzerim|IDF\s+air/i,
    latMin: 29.5,
    latMax: 33.5,
    lonMin: 34.2,
    lonMax: 35.9,
  },
  {
    id: "notam-lebanon",
    label: "Lebanon FIR",
    match: /Lebanon|Beirut|\bOLBA\b/i,
    latMin: 33.0,
    latMax: 34.7,
    lonMin: 35.0,
    lonMax: 36.6,
  },
  {
    id: "notam-egypt",
    label: "Egypt / Sinai FIR",
    match: /Egypt|Cairo|\bHECA\b|Sinai/i,
    latMin: 29.5,
    latMax: 31.8,
    lonMin: 29.5,
    lonMax: 34.0,
  },
  {
    id: "notam-emed",
    label: "Eastern Med airspace",
    match: /Eastern\s+Med|E-?Med|Mediterranean|Eurocontrol|holding|reroute|NOTAM|TFR|airspace/i,
    latMin: 32.0,
    latMax: 36.0,
    lonMin: 29.0,
    lonMax: 35.5,
  },
];

const ADSB_BOX_DEFS: Array<{
  id: string;
  label: string;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}> = [
  {
    id: "adsb-levant",
    label: "ADS-B Levant (AER-01)",
    ...LEVANT_BBOX,
  },
  {
    id: "adsb-med",
    label: "ADS-B Med approach (AER-01)",
    ...MED_APPROACH_BBOX,
  },
  {
    id: "adsb-israel",
    label: "ADS-B Israel core (AER-01)",
    ...ISRAEL_CORE_BBOX,
  },
];
// Wider theater ADS-B boxes (Iraq / Syria-Jazira / Saudi / Iran / Red Sea /
// Bab / Somali / Arabian / Gulf) live in theaterWatch THEATER_ADSB_BOXES —
// plot + Gulf regime only; never AER-01.

function buildLevantMapOverlays(args: {
  notamTitles: string[];
  notamStatus: "quiet" | "warm" | "hot";
  aerialBoxesOk: string[];
  aerialBoxesFailed: string[];
  /** Live tracks per Levant/Med/Israel box (empty ≠ not watching). */
  aerialBoxTrackCounts?: Record<string, number>;
  cyprusAis: CyprusAisSnapshot;
  dip01Status: IsraelStrikeTellStatus;
  dip01Evidence: string[];
  nav01Status: IsraelStrikeTellStatus;
  firmsPoints: FirmsMapPoint[];
  firmsNote: string;
}): LevantMapOverlays {
  const zones: LevantMapZone[] = [];
  const points: LevantMapPoint[] = [];
  const trackCounts = args.aerialBoxTrackCounts ?? {};

  // ADS-B sample boxes (always — shows where we look, even at 0 tracks).
  for (const box of ADSB_BOX_DEFS) {
    const key = box.id.replace("adsb-", "");
    const ok = args.aerialBoxesOk.includes(key);
    const failed = args.aerialBoxesFailed.some(
      (f) => f === key || f.startsWith(`${key}:`),
    );
    const live =
      trackCounts[box.id] ?? trackCounts[key] ?? trackCounts[`adsb-${key}`] ?? 0;
    const short =
      key === "levant"
        ? "Levant"
        : key === "med"
          ? "Med"
          : key === "israel"
            ? "Israel"
            : key;
    zones.push({
      id: box.id,
      kind: "adsb_box",
      label: `ADS-B ${short} · watching · ${live}`,
      status: failed ? "failed" : ok ? "info" : "unknown",
      latMin: box.latMin,
      latMax: box.latMax,
      lonMin: box.lonMin,
      lonMax: box.lonMax,
      titles: [`${box.label} · watching · ${live} live · AER-01`],
    });
  }

  // Cyprus AIS watch box + vessels.
  const ais = args.cyprusAis;
  const aisStatus: LevantMapZone["status"] =
    !ais.enabled || ais.status === "disabled"
      ? "unknown"
      : ais.status === "live" && ais.navyLikeCount >= 2
        ? "hot"
        : ais.status === "live" && ais.navyLikeCount >= 1
          ? "warm"
          : ais.status === "live"
            ? "info"
            : ais.status === "empty" || ais.status === "stale"
              ? "unknown"
              : "failed";
  zones.push({
    id: "cyprus-ais",
    kind: "cyprus_ais",
    label: !ais.enabled
      ? "Cyprus AIS · KEY UNSET"
      : ais.status === "live"
        ? `Cyprus AIS · LIVE · navy-like ${ais.navyLikeCount}`
        : ais.status === "empty" || ais.status === "stale"
          ? `Cyprus AIS · ${ais.status.toUpperCase()} (auto · not quiet)`
          : ais.status === "error"
            ? `Cyprus AIS · ERROR`
            : `Cyprus AIS · ${ais.status}`,
    status: aisStatus,
    latMin: ais.bbox.latMin,
    latMax: ais.bbox.latMax,
    lonMin: ais.bbox.lonMin,
    lonMax: ais.bbox.lonMax,
    titles: ais.enabled
      ? [
          `AISStream ${ais.status} · ${ais.totalInBox} in box · navy-like ${ais.navyLikeCount}`,
          ais.note.slice(0, 160),
        ]
      : ["AISSTREAM_API_KEY unset — auto feed unavailable"],
  });

  for (const v of ais.vessels.slice(0, 16)) {
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon)) continue;
    points.push({
      id: `ais-${v.mmsi}`,
      kind: "ais_vessel",
      label: v.name || v.mmsi,
      category: v.category,
      lat: v.lat,
      lon: v.lon,
      sog: v.sog,
      cog: v.cog,
    });
  }

  // NOTAM / AER-02 zones — geo-tagged from RSS titles (approximate FIRs).
  if (args.notamStatus !== "quiet" && args.notamTitles.length > 0) {
    const matched = new Set<string>();
    for (const title of args.notamTitles) {
      let hit = false;
      for (const geo of NOTAM_GEO_ZONES) {
        if (!geo.match.test(title)) continue;
        hit = true;
        matched.add(geo.id);
        const existing = zones.find((z) => z.id === geo.id);
        if (existing) {
          existing.titles = [...(existing.titles ?? []), title].slice(0, 4);
          if (
            args.notamStatus === "hot" ||
            (args.notamStatus === "warm" && existing.status !== "hot")
          ) {
            existing.status = args.notamStatus;
          }
        } else {
          zones.push({
            id: geo.id,
            kind: "notam",
            label: `NOTAM · ${geo.label}`,
            status: args.notamStatus,
            latMin: geo.latMin,
            latMax: geo.latMax,
            lonMin: geo.lonMin,
            lonMax: geo.lonMax,
            titles: [title],
          });
        }
      }
      if (!hit && !matched.has("notam-emed")) {
        const emed = NOTAM_GEO_ZONES.find((g) => g.id === "notam-emed")!;
        matched.add(emed.id);
        zones.push({
          id: emed.id,
          kind: "notam",
          label: `NOTAM · ${emed.label}`,
          status: args.notamStatus,
          latMin: emed.latMin,
          latMax: emed.latMax,
          lonMin: emed.lonMin,
          lonMax: emed.lonMax,
          titles: [title],
        });
      } else if (!hit) {
        const z = zones.find((x) => x.id === "notam-emed");
        if (z) z.titles = [...(z.titles ?? []), title].slice(0, 4);
      }
    }
  }

  // DIP-01 Lebanon / Blue Line + Golan strip when warm/hot.
  if (args.dip01Status === "warm" || args.dip01Status === "hot") {
    zones.push({
      id: "dip-lebanon-border",
      kind: "dip_border",
      label: "DIP-01 · Lebanon / Blue Line watch",
      status: args.dip01Status === "hot" ? "hot" : "warm",
      latMin: 33.05,
      latMax: 33.55,
      lonMin: 35.1,
      lonMax: 35.85,
      titles: args.dip01Evidence.slice(0, 3),
    });
    zones.push({
      id: "dip-golan",
      kind: "dip_border",
      label: "DIP-01 · Golan / Quneitra watch",
      status: args.dip01Status === "hot" ? "hot" : "warm",
      latMin: 32.7,
      latMax: 33.45,
      lonMin: 35.55,
      lonMax: 35.98,
      titles: args.dip01Evidence.slice(0, 3),
    });
  }

  // NAV-01 watch highlight on Cyprus box when lit.
  if (
    args.nav01Status === "warm" ||
    args.nav01Status === "hot" ||
    args.nav01Status === "unknown"
  ) {
    zones.push({
      id: "nav01-cyprus",
      kind: "nav_watch",
      label: `NAV-01 · Cyprus Sa'ar watch (${args.nav01Status})`,
      status:
        args.nav01Status === "hot"
          ? "hot"
          : args.nav01Status === "warm"
            ? "warm"
            : "unknown",
      latMin: ais.bbox.latMin,
      latMax: ais.bbox.latMax,
      lonMin: ais.bbox.lonMin,
      lonMax: ais.bbox.lonMax,
    });
  }

  return {
    zones,
    points,
    notamStatus: args.notamStatus,
    notamTitles: args.notamTitles,
    firmsPoints: args.firmsPoints,
    firmsNote: args.firmsNote,
  };
}

type AerialSnap = {
  tankerCount: number;
  awacsCount: number;
  otherMilCount: number;
  samples: string[];
  tracks: AerialTrack[];
  /** Hexes dropped from live feed but still within sticky TTL. */
  lastGoodTracks: AerialLastGoodTrack[];
  feedOk: boolean;
  feedStatus: AerialFeedStatus;
  error?: string;
  sampledAt: string;
  ageSec: number;
  fromCache: boolean;
  boxesOk: string[];
  boxesFailed: string[];
  /** Primary vs failover label for UI honesty. */
  adsbSource?: "adsb.lol" | "opensky" | "mixed" | "none";
  aerialEvents?: AerialEvent[];
  aer01Churn?: Aer01Churn;
};

function attachAerialLifecycle(snap: AerialSnap, landed: AdsbAc[]): AerialSnap {
  const lc = applyAerialLifecycle({
    tracks: snap.tracks ?? [],
    lastGoodTracks: snap.lastGoodTracks ?? [],
    landed,
    nowIso: snap.sampledAt,
  });
  return {
    ...snap,
    tracks: lc.tracks as AerialTrack[],
    lastGoodTracks: lc.lastGoodTracks as AerialLastGoodTrack[],
    aerialEvents: lc.events,
    aer01Churn: lc.aer01Churn,
  };
}

/** Last completed IST payload — Map copy uses this so the UI never waits on RSS/ADS-B. */
let lastIsraelStrikeTells: IsraelStrikeTells | null = null;
let lastIsraelStrikeTellsAt = 0;

function hydrateIsraelStrikeLastGood(): void {
  if (lastIsraelStrikeTells) return;
  const disk = readLastGood<IsraelStrikeTells>("israel-strike-tells");
  if (!disk) return;
  lastIsraelStrikeTells = disk.value;
  lastIsraelStrikeTellsAt = disk.at;
}

export function getLastIsraelStrikeTells(): {
  tells: IsraelStrikeTells;
  ageMs: number;
} | null {
  hydrateIsraelStrikeLastGood();
  if (!lastIsraelStrikeTells) return null;
  return {
    tells: lastIsraelStrikeTells,
    ageMs: Date.now() - lastIsraelStrikeTellsAt,
  };
}

/** Drop last-good so a manual NAV-01 mark re-scores instead of painting stale tells. */
export function invalidateIsraelStrikeTellsCache(): void {
  lastIsraelStrikeTells = null;
  lastIsraelStrikeTellsAt = 0;
  clearLastGood("israel-strike-tells");
}

/** In-memory last-good aerial sample (survives soft feed failures). */
let aerialLastGood: AerialSnap | null = null;
const AERIAL_CACHE_MAX_AGE_MS = 45 * 60 * 1000;
/** Per-hex sticky positions when adsb.lol drops tankers/AWACS. */
/** Throttle OpenSky icao24 follow lookups (anonymous credits). */
let lastFollowIcaoAt = 0;

/** Session/day peak since process start — awareness only, not a go gate. */
export type AerialSessionPeak = {
  tankers: number;
  awacs: number;
  at: string;
};

let aerialSessionPeak: AerialSessionPeak | null = null;
let aerialSessionPeakHydrated = false;

function hydrateAerialSessionPeakFromArchive(): void {
  if (aerialSessionPeakHydrated) return;
  aerialSessionPeakHydrated = true;
  try {
    const dayPeak = queryDayAerialPeak();
    if (!dayPeak) return;
    if (
      !aerialSessionPeak ||
      dayPeak.tankers > aerialSessionPeak.tankers ||
      (dayPeak.tankers === aerialSessionPeak.tankers &&
        dayPeak.awacs > aerialSessionPeak.awacs)
    ) {
      aerialSessionPeak = {
        tankers: dayPeak.tankers,
        awacs: dayPeak.awacs,
        at: dayPeak.at,
      };
    }
  } catch {
    /* archive optional */
  }
}

function noteAerialSessionPeak(
  tankers: number,
  awacs: number,
  at: string,
): void {
  hydrateAerialSessionPeakFromArchive();
  if (tankers <= 0 && awacs <= 0) return;
  if (
    !aerialSessionPeak ||
    tankers > aerialSessionPeak.tankers ||
    (tankers === aerialSessionPeak.tankers && awacs > aerialSessionPeak.awacs)
  ) {
    aerialSessionPeak = { tankers, awacs, at };
  }
}

export function getAerialSessionPeak(): AerialSessionPeak | null {
  hydrateAerialSessionPeakFromArchive();
  return aerialSessionPeak;
}

function persistLevantAerialArchive(snap: AerialSnap): void {
  try {
    archiveLevantAerial({
      ts: snap.sampledAt,
      tankers: snap.tankerCount,
      awacs: snap.awacsCount,
      otherMil: snap.otherMilCount,
      feedStatus: snap.feedStatus,
      adsbSource: snap.adsbSource ?? null,
      tracks: snap.tracks ?? [],
      lastGoodTracks: snap.lastGoodTracks ?? [],
    });
  } catch (err) {
    console.warn("[tradehole] levant aerial archive failed:", err);
  }
}

type StickyAerial = AerialTrack & { lastSeenAt: string };
const aerialStickyByHex = new Map<string, StickyAerial>();
let aerialStickyHydrated = false;

function aerialStickyDataDir(): string {
  if (process.env.TRADEHOLE_DATA_DIR) return process.env.TRADEHOLE_DATA_DIR;
  return path.join(os.homedir(), "Library", "Application Support", "Tradehole");
}

function aerialStickyStorePath(): string {
  return path.join(aerialStickyDataDir(), "levant-aerial-sticky.json");
}

function hydrateAerialStickyFromDisk(): void {
  if (aerialStickyHydrated) return;
  aerialStickyHydrated = true;
  try {
    const raw = fs.readFileSync(aerialStickyStorePath(), "utf8");
    const json = JSON.parse(raw) as {
      at?: number;
      sampledAt?: string;
      tracks?: Array<StickyAerial>;
      snap?: Partial<AerialSnap> | null;
    };
    const now = Date.now();
    const tracks = Array.isArray(json.tracks) ? json.tracks : [];
    for (const t of tracks) {
      if (!t?.hex || !t.lastSeenAt) continue;
      if (!Number.isFinite(t.lat) || !Number.isFinite(t.lon)) continue;
      const seenAt = Date.parse(t.lastSeenAt) || 0;
      const kind = classifyAerialKind(
        String(t.acType ?? ""),
        String(t.desc ?? ""),
        String(t.callsign ?? ""),
        t.kind === "tanker" || t.kind === "awacs" ? t.kind : "mil",
      );
      if (now - seenAt > stickyDisplayTtlMs(kind)) continue;
      aerialStickyByHex.set(t.hex, {
        hex: t.hex,
        callsign: String(t.callsign ?? "—"),
        kind,
        acType: String(t.acType ?? "?"),
        desc: t.desc ? String(t.desc) : undefined,
        lat: t.lat,
        lon: t.lon,
        trackDeg: t.trackDeg ?? null,
        gsKt: t.gsKt ?? null,
        altFt: t.altFt ?? null,
        bearingHint: t.bearingHint ?? "orbit/unknown",
        trail: Array.isArray(t.trail) ? t.trail.slice(-14) : [],
        source: t.source === "opensky" ? "opensky" : "adsb.lol",
        inBox: t.inBox,
        followed: t.followed,
        followRegion: t.followRegion,
        enrolledAt: t.enrolledAt,
        lastSeenAt: t.lastSeenAt,
      });
    }
    // Restore last-good snap shell when still within cache window.
    if (
      json.snap &&
      json.sampledAt &&
      now - Date.parse(json.sampledAt) <= AERIAL_CACHE_MAX_AGE_MS
    ) {
      const lastGood: AerialLastGoodTrack[] = [...aerialStickyByHex.values()]
        .map((snap) => {
          const ageMs = Math.max(0, now - (Date.parse(snap.lastSeenAt) || 0));
          return {
            hex: snap.hex,
            callsign: snap.callsign,
            kind: classifyAerialKind(
              snap.acType,
              snap.desc ?? "",
              snap.callsign,
              snap.kind,
            ),
            acType: snap.acType,
            desc: snap.desc,
            lat: snap.lat,
            lon: snap.lon,
            trackDeg: snap.trackDeg,
            gsKt: snap.gsKt,
            altFt: snap.altFt,
            bearingHint: snap.bearingHint,
            trail: snap.trail,
            source: snap.source,
            ageSec: Math.max(0, Math.round(ageMs / 1000)),
            lastSeenAt: snap.lastSeenAt,
            stale: true as const,
            inBox: snap.inBox,
            followed: snap.followed,
            followRegion: snap.followRegion,
            enrolledAt: snap.enrolledAt,
          };
        });
      const vip = lastGood.filter((t) => t.kind === "tanker" || t.kind === "awacs");
      const mil = lastGood.filter((t) => t.kind === "mil").slice(0, 40);
      const capped = [...vip, ...mil];
      aerialLastGood = {
        tankerCount: Number(json.snap.tankerCount) || 0,
        awacsCount: Number(json.snap.awacsCount) || 0,
        otherMilCount: Number(json.snap.otherMilCount) || 0,
        samples: Array.isArray(json.snap.samples) ? json.snap.samples : [],
        tracks: [],
        lastGoodTracks: capped,
        feedOk: false,
        feedStatus: "degraded",
        sampledAt: json.sampledAt,
        ageSec: Math.max(
          0,
          Math.round((now - Date.parse(json.sampledAt)) / 1000),
        ),
        fromCache: true,
        boxesOk: Array.isArray(json.snap.boxesOk) ? json.snap.boxesOk : [],
        boxesFailed: Array.isArray(json.snap.boxesFailed)
          ? json.snap.boxesFailed
          : [],
        adsbSource:
          json.snap.adsbSource === "opensky" ||
          json.snap.adsbSource === "mixed" ||
          json.snap.adsbSource === "adsb.lol"
            ? json.snap.adsbSource
            : "none",
        error: "disk sticky last-good (app restart)",
      };
    }
  } catch {
    /* missing / corrupt — start empty */
  }
}

function persistAerialStickyToDisk(snap?: AerialSnap | null): void {
  try {
    const now = Date.now();
    const tracks = [...aerialStickyByHex.values()].filter((t) => {
      const seenAt = Date.parse(t.lastSeenAt) || 0;
      return now - seenAt <= stickyDisplayTtlMs(t.kind);
    });
    fs.mkdirSync(aerialStickyDataDir(), { recursive: true });
    const shell =
      snap ??
      aerialLastGood ??
      (tracks.length > 0
        ? {
            tankerCount: tracks.filter((t) => t.kind === "tanker").length,
            awacsCount: tracks.filter((t) => t.kind === "awacs").length,
            otherMilCount: tracks.filter((t) => t.kind === "mil").length,
            samples: [] as string[],
            boxesOk: [] as string[],
            boxesFailed: [] as string[],
            adsbSource: "none" as const,
            sampledAt: tracks[0]?.lastSeenAt,
          }
        : null);
    fs.writeFileSync(
      aerialStickyStorePath(),
      JSON.stringify(
        {
          at: now,
          sampledAt: shell?.sampledAt ?? new Date(now).toISOString(),
          tracks,
          snap: shell
            ? {
                tankerCount: shell.tankerCount,
                awacsCount: shell.awacsCount,
                otherMilCount: shell.otherMilCount,
                samples: "samples" in shell ? shell.samples : [],
                boxesOk: "boxesOk" in shell ? shell.boxesOk : [],
                boxesFailed: "boxesFailed" in shell ? shell.boxesFailed : [],
                adsbSource: "adsbSource" in shell ? shell.adsbSource : "none",
              }
            : null,
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch (err) {
    console.warn("[tradehole] levant aerial sticky persist failed:", err);
  }
}

/** Per-hex position trail for map (not persisted). */
const aerialTrailByHex = new Map<
  string,
  Array<{ lat: number; lon: number; at: string }>
>();
const AERIAL_TRAIL_MAX_POINTS = 28;
const AERIAL_TRAIL_MAX_AGE_MS = 2 * 60 * 60 * 1000;

function capStickyLastGood(rows: AerialLastGoodTrack[]): AerialLastGoodTrack[] {
  const vip = rows.filter((t) => t.kind === "tanker" || t.kind === "awacs");
  const mil = rows.filter((t) => t.kind === "mil").slice(0, 40);
  return [...vip, ...mil];
}

function lastGoodSampleLine(t: AerialLastGoodTrack): string {
  const tag = "DARK";
  const regionBit = t.followRegion ? ` · ${t.followRegion}` : "";
  const scoredBit = " · not scored";
  return `${tag} ${t.callsign || "—"} · hex ${t.hex} · type ${t.acType || "?"} · class ${t.kind} · @${t.lat.toFixed(3)},${t.lon.toFixed(3)}${t.trackDeg != null ? ` hdg ${Math.round(t.trackDeg)}°` : ""}${t.gsKt != null ? ` ${Math.round(t.gsKt)}kt` : ""}${t.altFt != null ? ` FL${Math.round(t.altFt / 100)}` : ""} · ${t.bearingHint}${regionBit}${scoredBit} · age ${t.ageSec}s · last-good`;
}

function prioritizeAerialSampleLines(lines: string[]): string[] {
  const rank = (s: string) => {
    if (/class tanker/i.test(s)) return 0;
    if (/class awacs/i.test(s)) return 1;
    return 2;
  };
  return [...lines].sort((a, b) => rank(a) - rank(b));
}

export function mergeStickyAerialTracks(
  liveTracks: AerialTrack[],
  sampledAt: string,
  opts: { feedFullyFailed: boolean },
): { live: AerialTrack[]; lastGood: AerialLastGoodTrack[] } {
  hydrateAerialStickyFromDisk();
  const now = Date.parse(sampledAt) || Date.now();
  if (!opts.feedFullyFailed) {
    for (const t of liveTracks) {
      if (isCivOrVipAirframe(t.acType) && t.kind !== "tanker" && t.kind !== "awacs") {
        continue;
      }
      aerialStickyByHex.set(t.hex, { ...t, lastSeenAt: sampledAt });
    }
  } else if (liveTracks.length > 0) {
    for (const t of liveTracks) {
      if (!aerialStickyByHex.has(t.hex)) {
        aerialStickyByHex.set(t.hex, {
          ...t,
          lastSeenAt: t.enrolledAt || sampledAt,
        });
      }
    }
  }

  const liveHexes = new Set(
    opts.feedFullyFailed ? [] : liveTracks.map((t) => t.hex),
  );

  // Watchlist last-known fills sticky holes when a hex was never in this
  // process's sticky map (restart / trim / slice) but is still enrolled.
  for (const w of collectWatchlistLastGood(liveHexes, now)) {
    const prev = aerialStickyByHex.get(w.hex);
    const prevSeen = prev ? Date.parse(prev.lastSeenAt) || 0 : 0;
    const watchSeen = Date.parse(w.lastSeenAt) || 0;
    if (prev && prevSeen >= watchSeen) continue;
    aerialStickyByHex.set(w.hex, {
      hex: w.hex,
      callsign: w.callsign,
      kind: w.kind,
      acType: w.acType,
      desc: w.desc,
      lat: w.lat,
      lon: w.lon,
      trackDeg: w.trackDeg,
      gsKt: w.gsKt,
      altFt: w.altFt,
      bearingHint: bearingHintFromTrack(w.trackDeg),
      trail: prev?.trail ?? [],
      source: prev?.source ?? "adsb.lol",
      inBox: inAnyStrikeBox({ lat: w.lat, lon: w.lon, hex: w.hex }),
      followed: w.origin === "theater" || !inAnyStrikeBox({ lat: w.lat, lon: w.lon, hex: w.hex }),
      followRegion: followRegionHint(w.lat, w.lon),
      enrolledAt: w.enrolledAt,
      lastSeenAt: w.lastSeenAt,
    });
  }

  const lastGood: AerialLastGoodTrack[] = [];
  for (const [hex, snap] of [...aerialStickyByHex.entries()]) {
    const seenAt = Date.parse(snap.lastSeenAt) || 0;
    const ageMs = Math.max(0, now - seenAt);
    if (ageMs > stickyDisplayTtlMs(snap.kind)) {
      aerialStickyByHex.delete(hex);
      continue;
    }
    if (liveHexes.has(hex)) continue;
    if (
      isCivOrVipAirframe(snap.acType) &&
      snap.kind !== "tanker" &&
      snap.kind !== "awacs"
    ) {
      aerialStickyByHex.delete(hex);
      continue;
    }
    const kind = classifyAerialKind(
      snap.acType,
      snap.desc ?? "",
      snap.callsign,
      snap.kind,
    );
    lastGood.push({
      hex: snap.hex,
      callsign: snap.callsign,
      kind,
      acType: snap.acType,
      desc: snap.desc,
      lat: snap.lat,
      lon: snap.lon,
      trackDeg: snap.trackDeg,
      gsKt: snap.gsKt,
      altFt: snap.altFt,
      bearingHint: snap.bearingHint,
      trail: snap.trail,
      source: snap.source,
      inBox: snap.inBox,
      followed: snap.followed,
      followRegion: snap.followRegion,
      enrolledAt: snap.enrolledAt,
      ageSec: Math.max(0, Math.round(ageMs / 1000)),
      lastSeenAt: snap.lastSeenAt,
      stale: true,
    });
    if (kind !== snap.kind) {
      aerialStickyByHex.set(hex, { ...snap, kind });
    }
  }
  persistAerialStickyToDisk(aerialLastGood);
  return {
    live: opts.feedFullyFailed ? [] : liveTracks,
    lastGood: capStickyLastGood(lastGood),
  };
}

/** Test helper — not used in production paths. */
export function resetLevantAerialStickyForTests(): void {
  aerialStickyByHex.clear();
  aerialStickyHydrated = true;
  aerialLastGood = null;
}

type NewsItem = {
  title: string;
  link: string;
  pubDate: string;
  source?: string;
};

function parseAltFt(v: number | string | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "string") {
    if (/ground|on.?ground/i.test(v)) return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return Number.isFinite(v) ? v : null;
}

function bearingHintFromTrack(
  trackDeg: number | null,
): AerialTrack["bearingHint"] {
  if (trackDeg == null || !Number.isFinite(trackDeg)) return "orbit/unknown";
  const t = ((trackDeg % 360) + 360) % 360;
  if (t >= 245 && t <= 295) return "westbound";
  if (t >= 65 && t <= 115) return "eastbound";
  if (t >= 335 || t <= 25) return "northbound";
  if (t >= 155 && t <= 205) return "southbound";
  return "orbit/unknown";
}

function pushAerialTrail(
  hex: string,
  lat: number,
  lon: number,
  atIso: string,
): Array<{ lat: number; lon: number; at: string }> {
  const now = Date.parse(atIso) || Date.now();
  const prev = aerialTrailByHex.get(hex) ?? [];
  const last = prev[prev.length - 1];
  const next =
    last &&
    Math.abs(last.lat - lat) < 0.01 &&
    Math.abs(last.lon - lon) < 0.01
      ? prev
      : [...prev, { lat, lon, at: atIso }];
  const trimmed = next
    .filter((p) => {
      const t = Date.parse(p.at);
      return Number.isFinite(t) && now - t <= AERIAL_TRAIL_MAX_AGE_MS;
    })
    .slice(-AERIAL_TRAIL_MAX_POINTS);
  aerialTrailByHex.set(hex, trimmed);
  return trimmed;
}

export type IsraelStrikeTellStatus =
  | "hot"
  | "warm"
  | "quiet"
  | "unknown"
  | "manual";

export type IsraelStrikeTellId =
  | "AER-01"
  | "AER-02"
  | "AER-03"
  | "NAV-01"
  | "NAV-02"
  | "NAV-03"
  | "ELEC-01"
  | "ELEC-02"
  | "ELEC-03"
  | "DIP-01"
  | "DIP-02"
  | "POL-01"
  | "POL-02"
  | "POL-03"
  | "GO-01"
  | "EXEC-01"
  | "PIKUD-01"
  | "CYBER-01"
  | "FIRMS-01"
  | "STRAT-01"
  | "STRAT-02"
  | "DIP-03";

export type IsraelStrikeScenario =
  | "high_confidence_go"
  | "medium_confidence"
  | "false_flag"
  | "silence_only"
  | "quiet"
  | "unknown";

export type IsraelStrikeTell = {
  id: IsraelStrikeTellId;
  category:
    | "AER"
    | "NAV"
    | "ELEC"
    | "DIP"
    | "POL"
    | "GO"
    | "EXEC"
    | "PIKUD"
    | "CYBER"
    | "FIRMS"
    | "STRAT";
  label: string;
  lookFor: string;
  sourceHint: string;
  /** DeepSeek nominal confidence % (or inverse for POL). */
  nominalConfidence: number;
  /** Points contributed when hot (warm = half). Manual/unknown → 0. */
  weight: number;
  status: IsraelStrikeTellStatus;
  lit: boolean;
  points: number;
  read: string;
  evidence: string[];
  links: Array<{ label: string; href: string }>;
  /** Auto-evaluated from free feeds vs deep-link-only gap. */
  layer: "auto" | "manual";
};

export type IsraelStrikeTells = {
  thesis: string;
  oneLiner: string;
  asOf: string;
  score: number;
  scenario: IsraelStrikeScenario;
  statusLabel: string;
  froGuidance: string;
  autoTrade: false;
  physicalLit: number;
  diplomaticLit: number;
  electronicLit: number;
  politicalLit: number;
  executionLit: number;
  tells: IsraelStrikeTell[];
  gaps: string[];
  nextTriggers: string[];
  rulesSummary: string[];
  inputs: {
    shekelPrice: number | null;
    shekelChangePct: number | null;
    aerialTankersLevant: number | null;
    aerialAwacsLevant: number | null;
    aerialFeedOk: boolean;
    aerialFeedStatus: AerialFeedStatus;
    aerialSampleAgeSec: number | null;
    aerialSampledAt: string | null;
    aerialFromCache: boolean;
    aerialSamples: string[];
    aerialTracks: AerialTrack[];
    /** Sticky last-good when hexes drop from live ADS-B (tankers 30m / mil 20m). */
    aerialLastGoodTracks: AerialLastGoodTrack[];
    mapOverlays?: LevantMapOverlays;
    aerialOtherMil: number | null;
    aerialBoxesOk: string[];
    aerialBoxesFailed: string[];
    aerialError: string | null;
    ironsightOnline: boolean;
    intelAt: string | null;
    nav01Posture: Nav01Posture;
    nav01Note: string;
    nav01UpdatedAt: string | null;
    nav01NavyCount: number | null;
    nav01NavyThreshold: number;
    cyprusAis: CyprusAisSnapshot;
    softArms: SoftElevatedArm[];
    goLanguageStatus: "quiet" | "warm" | "hot";
    goLanguageHits: string[];
    /** In-memory max tankers/AWACS since process start — awareness only. */
    aerialSessionPeak: AerialSessionPeak | null;
    aerialEvents?: AerialEvent[];
    aer01Churn?: Aer01Churn | null;
  };
  manual: IsraelStrikeManualState;
  /** Honesty: last-good / in-flight rebuild. Scoring fields unchanged. */
  stale?: boolean;
  fromCache?: boolean;
  servedAgeMs?: number;
  rebuilding?: boolean;
  degradedReason?: string | null;
};

function parsePubMs(pubDate: string | null | undefined): number | null {
  if (!pubDate?.trim()) return null;
  const t = Date.parse(pubDate);
  return Number.isFinite(t) ? t : null;
}

async function fetchGoogleNewsRss(
  query: string,
  limit = 6,
): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { "User-Agent": "Tradehole/0.2" },
  });
  if (!res.ok) throw new Error(`RSS HTTP ${res.status}`);
  const xml = await res.text();
  const items: NewsItem[] = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  for (const block of blocks.slice(0, limit)) {
    const title =
      block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ??
      block.match(/<title>(.*?)<\/title>/)?.[1] ??
      "";
    const link =
      block.match(/<link>(.*?)<\/link>/)?.[1]?.trim() ??
      block.match(/<link><!\[CDATA\[(.*?)\]\]><\/link>/)?.[1]?.trim() ??
      "";
    const pubDate =
      block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() ?? "";
    if (title) items.push({ title: decodeXml(title), link, pubDate });
  }
  return items;
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function inBbox(
  a: AdsbAc,
  box: { latMin: number; latMax: number; lonMin: number; lonMax: number },
): boolean {
  return (
    a.lat != null &&
    a.lon != null &&
    a.lat >= box.latMin &&
    a.lat <= box.latMax &&
    a.lon >= box.lonMin &&
    a.lon <= box.lonMax
  );
}

function tellPoints(
  status: IsraelStrikeTellStatus,
  weight: number,
): { lit: boolean; points: number } {
  if (status === "hot") return { lit: true, points: weight };
  if (status === "warm") return { lit: true, points: Math.round(weight * 0.5) };
  return { lit: false, points: 0 };
}

function statusLabel(scenario: IsraelStrikeScenario): string {
  switch (scenario) {
    case "high_confidence_go":
      return "High-confidence go (T-2–4h)";
    case "medium_confidence":
      // Soft/warm stacks must not read like a countdown go for paste consumers.
      return "Elevated watch / pre-launch forming — NOT go";
    case "false_flag":
      return "False flag / feint — HOLD";
    case "silence_only":
      return "Silence-only — monitor";
    case "quiet":
      return "Quiet / no stack";
    default:
      return "Unknown — feeds degraded";
  }
}

/**
 * High-go soft-stack caps — AER-01 HOT (≥3 tankers) required; score/tanker floors.
 * Exported for golden tests.
 */
export function applyHighGoGates(opts: {
  scenario: IsraelStrikeScenario;
  aer01Hot: boolean;
  aerialTankerCount: number;
  score: number;
  /** Free ADS-B AWACS in Levant boxes — 0 = incomplete High-go stack. */
  aerialAwacsCount?: number;
}): IsraelStrikeScenario {
  let scenario = opts.scenario;
  // Cap: High-go requires AER-01 HOT (≥3 tankers) — warm/Shekel cannot substitute
  if (scenario === "high_confidence_go" && !opts.aer01Hot) {
    scenario = "medium_confidence";
  }
  // Soft stack safety: score <40 with incomplete aerial → never keep High-go title
  if (
    scenario === "high_confidence_go" &&
    (opts.score < 40 || opts.aerialTankerCount < 3)
  ) {
    scenario = "medium_confidence";
  }
  // Tankers without AWACS = elevated stack, not full High-go title (matches oneLiner).
  if (
    scenario === "high_confidence_go" &&
    opts.aerialAwacsCount != null &&
    opts.aerialAwacsCount < 1
  ) {
    scenario = "medium_confidence";
  }
  return scenario;
}

function froGuidance(scenario: IsraelStrikeScenario): string {
  switch (scenario) {
    case "high_confidence_go":
      return "FRO: HOLD / watch — leading OSINT stack lit (AER HOT + hard peer). Do NOT auto-trade; scenario title alone is not a buy signal. Shekel spike later is lagging confirmation / market panic, not a pre-launch gate.";
    case "medium_confidence":
      return "FRO: elevated watch — NOT go / not T-2–4h. Hold stubs as insurance; await AER-01 HOT (≥3 tankers) + hard peer / LLBG / Hebrew go language. Do not treat scenario title alone as a trade signal — this line is the action.";
    case "false_flag":
      return "FRO: IGNORE cabinet leak alone — treat as 2h delay/feint until aerial/naval leading tells appear (Shekel alone ≠ pre-launch).";
    case "silence_only":
      return "FRO: MONITOR — IDF silence alone can be drill/censorship. Wait ~2h for AER-01 / NAV-01 / LLBG — do not wait on Shekel.";
    case "quiet":
      return "FRO: no Israel-strike pre-launch stack — hold baseline; do not time off POL leaks or lone FX prints.";
    default:
      return "FRO: feeds incomplete — open deep links (adsb.lol / FR24 LLBG / MarineTraffic) manually.";
  }
}

/**
 * AER-01 gate — Levant/Med/Israel boxes ONLY.
 * Somali / Red Sea / Gulf / Arabian tankers must not print Israel High-go
 * (those are theaterWatch wider samples / Gulf mass_stack).
 */
function inAnyStrikeBox(a: AdsbAc): boolean {
  return (
    inBbox(a, LEVANT_BBOX) ||
    inBbox(a, MED_APPROACH_BBOX) ||
    inBbox(a, ISRAEL_CORE_BBOX)
  );
}

async function fetchAdsbJson(
  url: string,
  id: string,
): Promise<{ ok: boolean; status: number; ac: AdsbAc[]; error?: string; rateLimited?: boolean }> {
  const result = await fetchAdsbLol(url, { id, priority: "levant" });
  return {
    ok: result.ok,
    status: result.status,
    ac: result.ac,
    error: result.error,
    rateLimited: result.rateLimited,
  };
}

function classifyAerial(
  merged: AdsbAc[],
  boxesOk: string[],
  boxesFailed: string[],
  nowIso: string,
  opts?: {
    adsbSource?: AerialSnap["adsbSource"];
    /** Hexes inside AER-01 boxes — only these count toward tanker/AWACS score. */
    scoreHexes?: Set<string>;
    followedHexes?: Set<string>;
  },
): AerialSnap {
  const adsbSource = opts?.adsbSource ?? "adsb.lol";
  const trackSource: "adsb.lol" | "opensky" =
    adsbSource === "opensky" ? "opensky" : "adsb.lol";
  const scoreHexes = opts?.scoreHexes;
  const followedHexes = opts?.followedHexes ?? new Set<string>();
  let tankerCount = 0;
  let awacsCount = 0;
  let otherMilCount = 0;
  const samples: string[] = [];
  const tracks: AerialTrack[] = [];
  for (const a of merged) {
    const callsign = (a.flight ?? "").trim();
    const acType = a.t ?? "";
    const desc = a.desc ?? "";
    const flags = a.dbFlags ?? 0;
    const mil =
      !!(flags & 1) ||
      !!(flags & 2) ||
      (trackSource === "opensky" && openSkyLooksMilCallsign(callsign));
    const tanker = isAerialTanker(acType, desc, callsign);
    const awacs = isAwacs(acType, desc, callsign);
    const lat = a.lat;
    const lon = a.lon;
    const hasPos =
      lat != null &&
      lon != null &&
      Number.isFinite(lat) &&
      Number.isFinite(lon);
    const trackRaw =
      a.track != null && Number.isFinite(a.track)
        ? a.track
        : a.true_heading != null && Number.isFinite(a.true_heading)
          ? a.true_heading
          : null;
    const gsKt = a.gs != null && Number.isFinite(a.gs) ? a.gs : null;
    const altFt = parseAltFt(a.alt_baro ?? a.alt_geom);
    const hex =
      normalizeHex(a.hex) || `${callsign || "unk"}-${lat}-${lon}`;
    const hint = bearingHintFromTrack(trackRaw);
    const trail = hasPos ? pushAerialTrail(hex, lat!, lon!, nowIso) : [];
    const followed = followedHexes.has(hex);
    const inBox = scoreHexes ? scoreHexes.has(hex) : !followed;
    const scores = inBox;
    const region = hasPos ? followRegionHint(lat!, lon!) : undefined;
    const tag = followed ? "FOLLOWED" : "LIVE";
    const regionBit = followed && region ? ` · ${region}` : "";
    const scoredBit = followed ? " · not scored" : "";

    if (tanker) {
      if (scores) tankerCount += 1;
      const trackBit =
        trackRaw != null ? ` hdg ${Math.round(trackRaw)}°` : "";
      const gsBit = gsKt != null ? ` ${Math.round(gsKt)}kt` : "";
      const altBit =
        altFt != null ? ` FL${Math.round(altFt / 100)}` : "";
      samples.push(
        `${tag} ${callsign || "—"} · hex ${hex} · type ${acType || "?"} · class tanker · @${lat?.toFixed(3)},${lon?.toFixed(3)}${trackBit}${gsBit}${altBit} · ${hint}${regionBit}${scoredBit} · ${trackSource}`,
      );
      if (hasPos) {
        tracks.push({
          hex,
          callsign: callsign || "—",
          kind: "tanker",
          acType: acType || desc || "?",
          desc: desc || undefined,
          lat: lat!,
          lon: lon!,
          trackDeg: trackRaw,
          gsKt,
          altFt,
          bearingHint: hint,
          trail,
          source: trackSource,
          inBox,
          followed,
          followRegion: followed ? region : undefined,
        });
      }
    } else if (awacs) {
      if (scores) awacsCount += 1;
      samples.push(
        `${tag} ${callsign || "—"} · hex ${hex} · type ${acType || "?"} · class awacs · @${lat?.toFixed(3)},${lon?.toFixed(3)}${trackRaw != null ? ` hdg ${Math.round(trackRaw)}°` : ""}${gsKt != null ? ` ${Math.round(gsKt)}kt` : ""}${altFt != null ? ` FL${Math.round(altFt / 100)}` : ""} · ${hint}${regionBit}${scoredBit} · ${trackSource}`,
      );
      if (hasPos) {
        tracks.push({
          hex,
          callsign: callsign || "—",
          kind: "awacs",
          acType: acType || desc || "?",
          desc: desc || undefined,
          lat: lat!,
          lon: lon!,
          trackDeg: trackRaw,
          gsKt,
          altFt,
          bearingHint: hint,
          trail,
          source: trackSource,
          inBox,
          followed,
          followRegion: followed ? region : undefined,
        });
      }
    } else if (mil) {
      if (scores) otherMilCount += 1;
      if (samples.length < 48) {
        samples.push(
          `${tag} ${callsign || "—"} · hex ${hex} · type ${acType || "?"} · class mil · @${lat?.toFixed(3)},${lon?.toFixed(3)}${trackRaw != null ? ` hdg ${Math.round(trackRaw)}°` : ""}${gsKt != null ? ` ${Math.round(gsKt)}kt` : ""}${altFt != null ? ` FL${Math.round(altFt / 100)}` : ""} · ${hint}${regionBit}${scoredBit} · ${trackSource}`,
        );
      }
      if (hasPos && tracks.filter((t) => t.kind === "mil").length < 40) {
        tracks.push({
          hex,
          callsign: callsign || "—",
          kind: "mil",
          acType: acType || desc || "?",
          desc: desc || undefined,
          lat: lat!,
          lon: lon!,
          trackDeg: trackRaw,
          gsKt,
          altFt,
          bearingHint: hint,
          trail,
          source: trackSource,
          inBox,
          followed,
          followRegion: followed ? region : undefined,
        });
      }
    }
  }

  const feedStatus: AerialFeedStatus =
    tankerCount === 0 && awacsCount === 0 ? "dark" : "ok";

  const vipTracks = tracks.filter((t) => t.kind === "tanker" || t.kind === "awacs");
  const milTracks = tracks.filter((t) => t.kind === "mil").slice(0, 48);
  const mergedSticky = mergeStickyAerialTracks([...vipTracks, ...milTracks], nowIso, {
    feedFullyFailed: false,
  });

  const darkSamples = mergedSticky.lastGood.map(lastGoodSampleLine);
  const combinedSamples = prioritizeAerialSampleLines([
    ...samples,
    ...darkSamples,
  ]).slice(0, 48);

  return {
    tankerCount,
    awacsCount,
    otherMilCount,
    samples: combinedSamples,
    tracks: mergedSticky.live,
    lastGoodTracks: mergedSticky.lastGood,
    feedOk: true,
    feedStatus,
    sampledAt: nowIso,
    ageSec: 0,
    fromCache: false,
    boxesOk,
    boxesFailed,
    adsbSource,
  };
}

function staleFromCache(error: string): AerialSnap {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  if (
    aerialLastGood &&
    now - Date.parse(aerialLastGood.sampledAt) <= AERIAL_CACHE_MAX_AGE_MS
  ) {
    const ageSec = Math.max(
      0,
      Math.round((now - Date.parse(aerialLastGood.sampledAt)) / 1000),
    );
    const seedTracks = aerialLastGood.tracks ?? [];
    const mergedSticky = mergeStickyAerialTracks(seedTracks, nowIso, {
      feedFullyFailed: true,
    });
    // Prefer sticky ages; fall back to whole-snap age when sticky empty.
    const lastGood =
      mergedSticky.lastGood.length > 0
        ? mergedSticky.lastGood
        : seedTracks.map((t) => ({
            ...t,
            ageSec,
            lastSeenAt: aerialLastGood!.sampledAt,
            stale: true as const,
          }));
    const darkSamples = lastGood.map(lastGoodSampleLine);
    return {
      ...aerialLastGood,
      tracks: [],
      lastGoodTracks: lastGood,
      samples: prioritizeAerialSampleLines([
        ...(aerialLastGood.samples ?? []).filter(
          (s) => !/^\s*DARK /i.test(s),
        ),
        ...darkSamples,
      ]).slice(0, 48),
      feedOk: false,
      // Cache hit under 429/outage = degraded (not total blackout).
      feedStatus: "degraded",
      fromCache: true,
      ageSec,
      error: `${error} · showing last-good (${ageSec}s ago)`,
      sampledAt: aerialLastGood.sampledAt,
    };
  }
  const emptySticky = mergeStickyAerialTracks([], nowIso, {
    feedFullyFailed: true,
  });
  return {
    tankerCount: 0,
    awacsCount: 0,
    otherMilCount: 0,
    samples: emptySticky.lastGood.map(lastGoodSampleLine),
    tracks: [],
    lastGoodTracks: emptySticky.lastGood,
    feedOk: false,
    feedStatus: "failed",
    error,
    sampledAt: nowIso,
    ageSec: 0,
    fromCache: false,
    boxesOk: [],
    boxesFailed: ["mil", "levant", "med", "israel"],
  };
}

function ingestAc(byHex: Map<string, AdsbAc>, list: AdsbAc[]): void {
  for (const a of list) {
    const hex = normalizeHex(a.hex);
    if (!hex) continue;
    byHex.set(hex, a);
  }
}

async function lookupMissingFollows(byHex: Map<string, AdsbAc>): Promise<void> {
  const found = new Set(byHex.keys());
  const missing = missingWatchHexes(found);
  if (!adsbLolBackingOff()) {
    for (const hex of pickFollowLookups(missing)) {
      const acs = await fetchAdsbHex(hex);
      ingestAc(byHex, acs);
    }
  }
  const high = missingHighValueHexes(new Set(byHex.keys()));
  if (high.length === 0) return;
  if (Date.now() - lastFollowIcaoAt < 180_000) return;
  lastFollowIcaoAt = Date.now();
  const os = await fetchOpenSkyIcaos(high, { id: "follow-icao" });
  if (os.ok) ingestAc(byHex, os.ac);
}

function splitScoredAndFollowed(
  byHex: Map<string, AdsbAc>,
  nowIso: string,
): {
  inBox: AdsbAc[];
  followed: AdsbAc[];
  landed: AdsbAc[];
  scoreHexes: Set<string>;
  followedHexes: Set<string>;
} {
  const inBox: AdsbAc[] = [];
  const followed: AdsbAc[] = [];
  const scoreHexes = new Set<string>();
  const followedHexes = new Set<string>();
  const found = new Set<string>();
  const landed: AdsbAc[] = [];
  for (const [hex, a] of byHex) {
    found.add(hex);
    if (looksLanded(a)) {
      landed.push(a);
      continue;
    }
    if (inAnyStrikeBox(a)) {
      inBox.push(a);
      scoreHexes.add(hex);
    } else if (isWatchedHex(hex)) {
      followed.push(a);
      followedHexes.add(hex);
      touchWatchFromAc(a, nowIso);
    }
  }
  enrollLevantWatch(inBox, nowIso);
  enrollWideTheaterWatch([...byHex.values()], nowIso);
  dropLandedWatches(landed);
  noteWatchMisses(found, nowIso);
  return { inBox, followed, landed, scoreHexes, followedHexes };
}

/**
 * AER-01 aerial sample — sequential Levant/Med/Israel boxes only (avoids
 * adsb.lol 420 from Promise.all). Wider theater (Red Sea/Horn/Gulf/Arabian)
 * is sampled in theaterWatch — never merges into AER-01 tankerCount.
 * Watchlist hexes enrolled in those boxes are followed globally while
 * transmitting (plot + paste); they do not score AER-01.
 * Independent of IRONSIGHT. On total adsb.lol failure / 429, one OpenSky
 * bbox failover (anonymous, rate-limited) — callsign-typed only.
 */
async function fetchLevantAerial(opts?: {
  force?: boolean;
}): Promise<AerialSnap> {
  hydrateAerialStickyFromDisk();
  hydrateAerialFollowFromDisk();
  seedWatchFromTracks(
    [...aerialStickyByHex.values()].map((t) => ({
      hex: t.hex,
      callsign: t.callsign,
      kind: t.kind,
      acType: t.acType,
      desc: t.desc,
      lat: t.lat,
      lon: t.lon,
      lastSeenAt: t.lastSeenAt,
      gsKt: t.gsKt,
      altFt: t.altFt,
      trackDeg: t.trackDeg,
    })),
    new Date().toISOString(),
  );
  const force = opts?.force === true;
  // Fresh-enough cache hit (skip hammering adsb.lol on 90s UI poll)
  if (
    !force &&
    aerialLastGood &&
    Date.now() - Date.parse(aerialLastGood.sampledAt) < 45_000
  ) {
    const ageSec = Math.max(
      0,
      Math.round(
        (Date.now() - Date.parse(aerialLastGood.sampledAt)) / 1000,
      ),
    );
    return {
      ...aerialLastGood,
      ageSec,
      fromCache: true,
      tracks: aerialLastGood.tracks ?? [],
      lastGoodTracks: aerialLastGood.lastGoodTracks ?? [],
    };
  }

  // Hard 429 backoff — serve last-good aggressively (no new Levant spam).
  // Still allow a single OpenSky failover attempt when last-good is empty/stale.
  if (!force && adsbLolBackingOff() && aerialLastGood) {
    const age = Date.now() - Date.parse(aerialLastGood.sampledAt);
    if (age <= AERIAL_CACHE_MAX_AGE_MS) {
      return staleFromCache("adsb.lol rate-limit backoff");
    }
  }

  // Shared mil (priority levant) + Levant/Med/Israel geos — one global queue.
  const endpoints: Array<{ id: string; url: string | null }> = [
    { id: "mil", url: null },
    { id: "levant", url: "https://api.adsb.lol/v2/lat/32.8/lon/34.8/dist/450" },
    { id: "med", url: "https://api.adsb.lol/v2/lat/34.5/lon/33.0/dist/420" },
    { id: "israel", url: "https://api.adsb.lol/v2/lat/31.5/lon/34.8/dist/280" },
  ];

  const boxesOk: string[] = [];
  const boxesFailed: string[] = [];
  const byHex = new Map<string, AdsbAc>();
  let hitRateLimit = false;

  for (const ep of endpoints) {
    const result =
      ep.id === "mil"
        ? await fetchAdsbMil("levant")
        : await fetchAdsbJson(ep.url!, ep.id);
    if (!result.ok) {
      if (result.rateLimited) hitRateLimit = true;
      boxesFailed.push(`${ep.id}:${result.error ?? result.status}`);
      // On 429 mid-cycle, stop remaining Levant geos — preserve quota for retry.
      if (result.rateLimited) break;
      continue;
    }
    boxesOk.push(ep.id);
    ingestAc(byHex, result.ac);
  }

  const nowIso = new Date().toISOString();
  // Enroll in-box first so this cycle's hex lookups cover prior watch only.
  enrollLevantWatch(
    [...byHex.values()].filter((a) => inAnyStrikeBox(a)),
    nowIso,
  );
  enrollWideTheaterWatch([...byHex.values()], nowIso);

  if (boxesOk.length === 0) {
    // OpenSky anonymous bbox failover — once, not hammered.
    const os = await fetchOpenSkyBbox(OPENSKY_LEVANT_BBOX, {
      id: "levant-failover",
    });
    if (os.ok) ingestAc(byHex, os.ac);
    await lookupMissingFollows(byHex);
    const split = splitScoredAndFollowed(byHex, nowIso);
    const osMerged = [...split.inBox, ...split.followed];
    if (osMerged.length > 0) {
      const snap = classifyAerial(
        osMerged,
        os.ok ? ["opensky-levant"] : [],
        boxesFailed,
        nowIso,
        {
          adsbSource: "opensky",
          scoreHexes: split.scoreHexes,
          followedHexes: split.followedHexes,
        },
      );
      snap.feedStatus =
        snap.feedStatus === "ok" || snap.feedStatus === "dark"
          ? "degraded"
          : snap.feedStatus;
      snap.error = `adsb.lol failed (${boxesFailed.join("; ") || "timeout"}) · OpenSky failover (${split.inBox.length} in-box · ${split.followed.length} followed)`;
      const snapLc = attachAerialLifecycle(snap, split.landed);
      aerialLastGood = { ...snapLc, fromCache: false, ageSec: 0 };
      noteAerialSessionPeak(snapLc.tankerCount, snapLc.awacsCount, snapLc.sampledAt);
      persistAerialStickyToDisk(aerialLastGood);
      persistLevantAerialArchive(snapLc);
      return snapLc;
    }
    return staleFromCache(
      hitRateLimit || adsbLolBackingOff()
        ? `adsb.lol rate-limited (${boxesFailed.join("; ") || "429"})${os.error ? ` · opensky ${os.error}` : ""}`
        : `adsb.lol all boxes failed (${boxesFailed.join("; ") || "timeout"})${os.error ? ` · opensky ${os.error}` : ""}`,
    );
  }

  if (!hitRateLimit) await lookupMissingFollows(byHex);
  const split = splitScoredAndFollowed(byHex, nowIso);
  const snap = classifyAerial(
    [...split.inBox, ...split.followed],
    boxesOk,
    boxesFailed,
    nowIso,
    {
      adsbSource: "adsb.lol",
      scoreHexes: split.scoreHexes,
      followedHexes: split.followedHexes,
    },
  );
  // Partial box failure under rate limit still updates last-good but marks degraded.
  if (hitRateLimit || boxesFailed.length > 0) {
    snap.feedStatus =
      snap.feedStatus === "ok" || snap.feedStatus === "dark"
        ? "degraded"
        : snap.feedStatus;
    snap.error = `partial: ${boxesFailed.join("; ")}`;
  }
  const snapLc = attachAerialLifecycle(snap, split.landed);
  aerialLastGood = { ...snapLc, fromCache: false, ageSec: 0 };
  noteAerialSessionPeak(snapLc.tankerCount, snapLc.awacsCount, snapLc.sampledAt);
  persistAerialStickyToDisk(aerialLastGood);
  persistLevantAerialArchive(snapLc);
  return snapLc;
}

async function fetchShekelSnap(intel?: IntelAlarmState | null): Promise<{
  price: number | null;
  changePct: number | null;
  spiked: boolean;
  firm: boolean;
  read: string;
  source: string;
}> {
  if (intel?.shekelAlarm) {
    const s = intel.shekelAlarm;
    return {
      price: s.price,
      changePct: s.changePct,
      spiked: s.spiked,
      firm: s.regime === "firm" || s.spiked,
      read: s.read,
      source: "intelAlarm.shekelAlarm",
    };
  }
  try {
    let q = await getStockQuote("ILS=X").catch(() => null);
    if (!q?.price) q = await getStockQuote("USDILS=X").catch(() => null);
    const price = q?.price ?? null;
    const changePct = q?.changePercent ?? null;
    const spiked =
      price != null &&
      (price >= SHEKEL_SPIKE_HARD ||
        (price >= SHEKEL_ROC_FLOOR && (changePct ?? 0) >= SHEKEL_ROC_PCT));
    const firm =
      spiked ||
      (price != null &&
        (price >= 3.35 || (changePct != null && changePct >= 0.8)));
    return {
      price,
      changePct,
      spiked,
      firm,
      read: spiked
        ? `SHEKEL SPIKE — USD/ILS ${price?.toFixed(4) ?? "—"} (≥${SHEKEL_SPIKE_HARD} band ~${SHEKEL_SPIKE_FLOOR}–${SHEKEL_THRESHOLD})`
        : `USD/ILS ${price?.toFixed(4) ?? "—"} · d/d ${changePct?.toFixed(2) ?? "—"}%`,
      source: "yahoo-finance2 ILS=X",
    };
  } catch (err) {
    return {
      price: null,
      changePct: null,
      spiked: false,
      firm: false,
      read: `Shekel quote failed: ${String(err).slice(0, 80)}`,
      source: "yahoo-finance2",
    };
  }
}

type IronsightBundle = {
  /** Host reachable (root health and/or any panel including ships) — same bar as StatusBar/Theater. */
  online: boolean;
  tgOk: boolean;
  alertsOk: boolean;
  newsOk: boolean;
  shipsOk: boolean;
  tgPosts: Array<{
    text: string;
    channel: string;
    date?: string;
    url?: string;
  }>;
  alerts: Array<{ title: string; source?: string }>;
  news: Array<{ title: string; link?: string; pubDate?: string }>;
};

function firmsLatLon(row: Record<string, unknown>): { lat: number; lon: number } | null {
  const nested =
    (row.location as Record<string, unknown> | undefined) ??
    (row.geometry as Record<string, unknown> | undefined) ??
    (row.coord as Record<string, unknown> | undefined) ??
    {};
  const coords = nested.coordinates;
  const lat = Number(
    row.lat ??
      row.latitude ??
      row.Latitude ??
      nested.lat ??
      nested.latitude ??
      (Array.isArray(coords) ? coords[1] : undefined),
  );
  const lon = Number(
    row.lon ??
      row.longitude ??
      row.Longitude ??
      row.lng ??
      nested.lon ??
      nested.lng ??
      nested.longitude ??
      (Array.isArray(coords) ? coords[0] : undefined),
  );
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
}

async function fetchFirmsDetections(): Promise<{
  hormuz: number | null;
  bab: number | null;
  israel: number | null;
  points: FirmsMapPoint[];
  firmsNote: string;
}> {
  const emptyNote = "FIRMS: no coords";
  try {
    const res = await fetchIfIronsightUp(
      `/api/fires?conflict=${encodeURIComponent("iran-israel")}`,
      8_000,
    );
    if (!res?.ok) {
      const nasa = await fetchNasaFirmsTheater();
      if (nasa.points.length > 0) {
        const hormuz = nasa.points.filter((p) => p.box === "hormuz").length;
        const bab = nasa.points.filter((p) => p.box === "bab").length;
        const israel = nasa.points.filter((p) => p.box === "israel").length;
        return {
          hormuz,
          bab,
          israel,
          points: nasa.points,
          firmsNote: `${nasa.note} (IRONSIGHT unavailable)`,
        };
      }
      return {
        hormuz: null,
        bab: null,
        israel: null,
        points: [],
        firmsNote: "FIRMS: feed unavailable",
      };
    }
    const raw = (await res.json()) as unknown;
    const list = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as { fires?: unknown }).fires)
        ? ((raw as { fires: unknown[] }).fires as unknown[])
        : Array.isArray((raw as { detections?: unknown }).detections)
          ? ((raw as { detections: unknown[] }).detections as unknown[])
          : [];
    let hormuz = 0;
    let bab = 0;
    let israel = 0;
    const points: FirmsMapPoint[] = [];
    let withCoords = 0;
    for (let i = 0; i < list.length; i += 1) {
      const row = list[i] as Record<string, unknown>;
      const pos = firmsLatLon(row);
      if (!pos) continue;
      const { lat, lon } = pos;
      withCoords += 1;
      let box: FirmsMapPoint["box"] = "other";
      // Hormuz / Strait box
      if (lat >= 24 && lat <= 28.5 && lon >= 55 && lon <= 58.5) {
        hormuz += 1;
        box = "hormuz";
      } else if (lat >= 11 && lat <= 15 && lon >= 41 && lon <= 45) {
        bab += 1;
        box = "bab";
      } else if (lat >= 31.2 && lat <= 31.65 && lon >= 34.2 && lon <= 34.58) {
        israel += 1;
        box = "gaza";
      } else if (lat >= 32.7 && lat <= 33.45 && lon >= 35.55 && lon <= 35.98) {
        israel += 1;
        box = "golan";
      } else if (lat >= 29.5 && lat <= 34.5 && lon >= 34 && lon <= 36.5) {
        israel += 1;
        box = "israel";
      }
      if (points.length < 48) {
        const frp = typeof row.frp === "number" ? row.frp : null;
        const acqDate =
          row.acq_date != null
            ? String(row.acq_date)
            : row.acqDate != null
              ? String(row.acqDate)
              : row.date != null
                ? String(row.date)
                : null;
        points.push({
          id: `firms-${i}-${lat.toFixed(3)}-${lon.toFixed(3)}`,
          lat,
          lon,
          box,
          frp,
          acqDate,
          label: `FIRMS ${box}${frp != null ? ` · FRP ${frp.toFixed(1)}` : ""}`,
        });
      }
    }
    if (withCoords === 0) {
      const nasa = await fetchNasaFirmsTheater();
      if (nasa.points.length > 0) {
        const nh = nasa.points.filter((p) => p.box === "hormuz").length;
        const nb = nasa.points.filter((p) => p.box === "bab").length;
        const ni = nasa.points.filter((p) => p.box === "israel").length;
        return {
          hormuz: nh,
          bab: nb,
          israel: ni,
          points: nasa.points,
          firmsNote: `${nasa.note}${list.length > 0 ? ` · IRONSIGHT ${list.length} rows lacked coords` : ""}`,
        };
      }
    }
    const firmsNote =
      withCoords === 0
        ? list.length > 0
          ? `FIRMS: no coords (${list.length} raw rows)`
          : emptyNote
        : `FIRMS: ${withCoords} with coords`;
    return { hormuz, bab, israel, points, firmsNote };
  } catch {
    const nasa = await fetchNasaFirmsTheater().catch(() => ({
      points: [] as FirmsMapPoint[],
      note: "FIRMS NASA: fetch failed",
    }));
    if (nasa.points.length > 0) {
      return {
        hormuz: nasa.points.filter((p) => p.box === "hormuz").length,
        bab: nasa.points.filter((p) => p.box === "bab").length,
        israel: nasa.points.filter((p) => p.box === "israel").length,
        points: nasa.points,
        firmsNote: nasa.note,
      };
    }
    return {
      hormuz: null,
      bab: null,
      israel: null,
      points: [],
      firmsNote: "FIRMS: feed unavailable",
    };
  }
}

async function fetchIronsightBundle(): Promise<IronsightBundle> {
  const empty: IronsightBundle = {
    online: false,
    tgOk: false,
    alertsOk: false,
    newsOk: false,
    shipsOk: false,
    tgPosts: [],
    alerts: [],
    news: [],
  };
  try {
    const conflict = encodeURIComponent("iran-israel");
    // Prefer denser sample from IDF / RocketAlert / Alertisrael for GO-01 / PIKUD.
    const goChannels = encodeURIComponent(
      "IDFofficial,RocketAlert,Alertisrael,TimesofIsrael,AbuAliExpress",
    );
    // Fail-fast when StatusBar already shows IRONSIGHT down — do not wait 8–12s × panels.
    const up = await probeIronsight();
    if (!up) return empty;
    const [healthRes, tgRes, tgGoRes, alertsRes, newsRes, shipsRes] =
      await Promise.all([
        fetch(IRONSIGHT_URL.replace(/\/$/, ""), {
          signal: AbortSignal.timeout(2_500),
        }).catch(() => null),
        fetchIfIronsightUp(
          `/api/telegram?conflict=${conflict}&limit=6`,
          10_000,
        ),
        fetchIfIronsightUp(
          `/api/telegram?conflict=${conflict}&limit=10&channels=${goChannels}`,
          12_000,
        ),
        fetchIfIronsightUp(`/api/alerts?conflict=${conflict}`, 8_000),
        // News panel can be ~0.5–1MB — short timeouts caused empty samples
        // and (previously) false "IRONSIGHT offline" via probe poisoning.
        fetchIfIronsightUp(`/api/news?conflict=${conflict}`, 18_000),
        fetchIfIronsightUp(`/api/ships?conflict=${conflict}`, 8_000),
      ]);
    const healthOk = !!healthRes?.ok;
    const tgOk = !!tgRes?.ok || !!tgGoRes?.ok;
    const alertsOk = !!alertsRes?.ok;
    const newsOk = !!newsRes?.ok;
    const shipsOk = !!shipsRes?.ok;
    // Online if StatusBar-equivalent health OR any panel Theater uses (ships/news/tg/alerts).
    const online = healthOk || tgOk || alertsOk || newsOk || shipsOk;
    const tgPosts: IronsightBundle["tgPosts"] = [];
    const seen = new Set<string>();
    const pushPosts = async (res: Response | null) => {
      if (!res?.ok) return;
      const json = (await res.json()) as {
        posts?: Array<Record<string, unknown>>;
      };
      for (const p of json.posts ?? []) {
        const text = String(p.text ?? p.body ?? p.title ?? "").slice(0, 480);
        const channel = String(p.channel ?? p.channelLabel ?? p.source ?? "");
        const key = `${channel}|${text.slice(0, 80)}`;
        if (!text || seen.has(key)) continue;
        seen.add(key);
        tgPosts.push({
          text,
          channel,
          date:
            p.date != null
              ? String(p.date)
              : p.pubDate != null
                ? String(p.pubDate)
                : undefined,
          url: String(p.url ?? p.link ?? "").trim() || undefined,
        });
      }
    };
    // GO/PIKUD channels first so sample prioritizes IDF / RocketAlert.
    await pushPosts(tgGoRes);
    await pushPosts(tgRes);
    const alerts: IronsightBundle["alerts"] = [];
    if (alertsRes?.ok) {
      const json = (await alertsRes.json()) as unknown;
      const rows = Array.isArray(json)
        ? json
        : ((json as { alerts?: unknown[] }).alerts ??
          (json as { items?: unknown[] }).items ??
          []);
      for (const row of rows as Array<Record<string, unknown>>) {
        alerts.push({
          title: String(row.title ?? row.text ?? "").slice(0, 180),
          source: row.source != null ? String(row.source) : undefined,
        });
      }
    }
    const news: IronsightBundle["news"] = [];
    if (newsRes?.ok) {
      const json = (await newsRes.json()) as unknown;
      const rows = Array.isArray(json)
        ? json
        : ((json as { news?: unknown[] }).news ?? []);
      for (const row of rows as Array<Record<string, unknown>>) {
        news.push({
          title: String(row.title ?? "").slice(0, 240),
          link: String(row.link ?? row.url ?? "").trim() || undefined,
          pubDate:
            row.pubDate != null
              ? String(row.pubDate)
              : row.date != null
                ? String(row.date)
                : undefined,
        });
      }
    }
    return { online, tgOk, alertsOk, newsOk, shipsOk, tgPosts, alerts, news };
  } catch {
    return empty;
  }
}

function isDaytimeIsrael(now = new Date()): boolean {
  // Approximate Israel local (UTC+2/+3) as UTC+3 fixed — good enough for silence heuristic.
  const hour = (now.getUTCHours() + 3) % 24;
  return hour >= 7 && hour <= 20;
}

function emptyIsraelStrikeTells(): IsraelStrikeTells {
  const asOf = new Date().toISOString();
  return {
    thesis:
      "Israel strike pre-launch tells mapped to free OSINT. Rebuilding after launch — last-good missing.",
    oneLiner: "Rebuilding Israel strike tells — first paint after launch.",
    asOf,
    score: 0,
    scenario: "unknown",
    statusLabel: "Unknown — feeds degraded",
    froGuidance: "Watch — last-good missing after launch; rebuild running.",
    autoTrade: false,
    physicalLit: 0,
    diplomaticLit: 0,
    electronicLit: 0,
    politicalLit: 0,
    executionLit: 0,
    tells: [],
    gaps: ["First paint after launch — serving rebuilding stub until IST last-good lands."],
    nextTriggers: [],
    rulesSummary: [],
    inputs: {
      shekelPrice: null,
      shekelChangePct: null,
      aerialTankersLevant: null,
      aerialAwacsLevant: null,
      aerialFeedOk: false,
      aerialFeedStatus: "degraded",
      aerialSampleAgeSec: null,
      aerialSampledAt: null,
      aerialFromCache: false,
      aerialSamples: [],
      aerialTracks: [],
      aerialLastGoodTracks: [],
      aerialOtherMil: null,
      aerialBoxesOk: [],
      aerialBoxesFailed: [],
      aerialError: "rebuilding after launch",
      ironsightOnline: false,
      intelAt: null,
      nav01Posture: "not_set",
      nav01Note: "",
      nav01UpdatedAt: null,
      nav01NavyCount: null,
      nav01NavyThreshold: 1,
      cyprusAis: getCyprusAisSnapshot(),
      softArms: [],
      goLanguageStatus: "quiet",
      goLanguageHits: [],
      aerialSessionPeak: null,
    },
    manual: getIsraelStrikeManual(),
  };
}

export async function buildIsraelStrikeTells(opts?: {
  intel?: IntelAlarmState | null;
  forceAerial?: boolean;
  force?: boolean;
}): Promise<IsraelStrikeTells> {
  const force = opts?.force === true || opts?.forceAerial === true;
  hydrateIsraelStrikeLastGood();
  return serveLastGood({
    flightKey: force ? "buildIsraelStrikeTells:force" : "buildIsraelStrikeTells",
    force,
    freshTtlMs: 20_000,
    label: "israel-strike-tells",
    persistKey: "israel-strike-tells",
    get: () =>
      lastIsraelStrikeTells
        ? { value: lastIsraelStrikeTells, at: lastIsraelStrikeTellsAt }
        : null,
    set: (snap) => {
      lastIsraelStrikeTells = snap.value;
      lastIsraelStrikeTellsAt = snap.at;
    },
    build: () => rebuildIsraelStrikeTells(opts),
    empty: emptyIsraelStrikeTells,
  });
}

async function rebuildIsraelStrikeTells(opts?: {
  intel?: IntelAlarmState | null;
  forceAerial?: boolean;
}): Promise<IsraelStrikeTells> {
  const nowMs = Date.now();
  const intel = opts?.intel ?? null;
  const manual = getIsraelStrikeManual();

  const [
    aerial,
    shekel,
    ironsight,
    notamItems,
    cabinetItems,
    embassyItems,
    lebanonItems,
    goLangItems,
    blackoutItems,
    firmsCounts,
    stratItems,
  ] = await Promise.all([
    fetchLevantAerial({ force: opts?.forceAerial === true }),
    fetchShekelSnap(intel),
    fetchIronsightBundle(),
    Promise.all([
      fetchGoogleNewsRss(
        'NOTAM OR TFR OR "flight restriction" OR "airspace closed" OR reroute (Cyprus OR "Eastern Med" OR Israel OR LLBG OR Nicosia OR "Tel Aviv")',
        8,
      ).catch(() => [] as NewsItem[]),
      fetchGoogleNewsRss(
        'NOTAM OR TFR OR "temporary flight restriction" (Bahrain OR "Persian Gulf" OR Hormuz OR CENTCOM OR "Fifth Fleet")',
        6,
      ).catch(() => [] as NewsItem[]),
      fetchGoogleNewsRss(
        '("Eurocontrol" OR "Nicosia FIR" OR "Tel Aviv FIR") (NOTAM OR closed OR restriction OR holding)',
        6,
      ).catch(() => [] as NewsItem[]),
      ...EXTRA_NOTAM_RSS_QUERIES_LEVANT.map((q) =>
        fetchGoogleNewsRss(q, 5).catch(() => [] as NewsItem[]),
      ),
      fetchEurocontrolAviationRss(8).catch(() => [] as NewsItem[]),
      fetchAwcMeSigmetItems(8).catch(() => [] as NewsItem[]),
    ]).then((batches) =>
      mergeAviationNews(batches, 24).map((i) => ({
        title: i.title,
        link: i.link,
        pubDate: i.pubDate,
        source: i.source,
      })),
    ),
    fetchGoogleNewsRss(
      '(Netanyahu OR "security cabinet" OR "Security Cabinet") (Iran) (convene OR convenes OR convened OR meeting OR leak OR "Channel 13" OR Kan)',
      8,
    ).catch(() => [] as NewsItem[]),
    fetchGoogleNewsRss(
      '("embassy advisory" OR "embassy alert" OR "ordered departure" OR drawdown OR "security alert") (Beirut OR Baghdad OR Tel Aviv OR Israel OR Lebanon)',
      6,
    ).catch(() => [] as NewsItem[]),
    fetchGoogleNewsRss(
      'IDF (Lebanon OR Lebanese OR Syria OR Hezbollah) (incursion OR raid OR border OR "ground forces" OR redeploy OR troops)',
      8,
    ).catch(() => [] as NewsItem[]),
    fetchGoogleNewsRss(
      '("Home Front Command" OR shelters OR "preemptive strike" OR "pre-emptive" OR "open shelters" OR פיקוד העורף OR מכה מקדימה) (Israel OR IDF OR Iran)',
      10,
    ).catch(() => [] as NewsItem[]),
    fetchGoogleNewsRss(
      '(Iran OR Iranian OR Tehran) (internet blackout OR "internet shutdown" OR "cuts internet" OR "internet outage" OR "national internet")',
      8,
    ).catch(() => [] as NewsItem[]),
    fetchFirmsDetections().catch(() => ({
      hormuz: null as number | null,
      bab: null as number | null,
      israel: null as number | null,
      points: [] as FirmsMapPoint[],
      firmsNote: "FIRMS: no coords",
    })),
    Promise.all([
      fetchGoogleNewsRss(
        'Mossad (fired OR firing OR dismiss OR "Iran Division" OR "Intelligence Directorate" OR shakeup) (Iran)',
        8,
      ).catch(() => [] as NewsItem[]),
      fetchGoogleNewsRss(
        '(Mossad OR Israel) (regime change OR destabilize OR Ahmadinejad OR Kurdish) Iran',
        6,
      ).catch(() => [] as NewsItem[]),
      fetchGoogleNewsRss(
        'Iran (offensive doctrine OR Naqdi OR "enemy territory" OR "protracted confrontation") IRGC',
        8,
      ).catch(() => [] as NewsItem[]),
      fetchGoogleNewsRss(
        '(IDF OR Israel) (stunned OR shocked OR surprised) (Iran) (recover OR rebuild OR missile)',
        8,
      ).catch(() => [] as NewsItem[]),
      fetchGoogleNewsRss(
        '(Trump OR "Secret Service" OR "Air Force One") (Iran OR Israel) (missile OR threat OR skeptical)',
        6,
      ).catch(() => [] as NewsItem[]),
      // POL-03 Hormuz MOU / Sunday deadline arm DISABLED (PAST Aug 2026) — no RSS.
    ]).then((batches) => batches.flat()),
  ]);

  const linksCommon = {
    adsbLol: {
      label: "adsb.lol mil",
      href: "https://api.adsb.lol/v2/mil",
    },
    adsbExchangeIl: {
      label: "ADS-B Exchange · Israel",
      href: "https://globe.adsbexchange.com/?lat=32.0&lon=34.8&zoom=7",
    },
    fr24Llbg: {
      label: "FR24 · LLBG (manual)",
      href: "https://www.flightradar24.com/32.01,34.89/8",
    },
    mtCyprus: {
      label: "MT · Cyprus",
      href: "https://www.marinetraffic.com/en/ais/home/centerx:33.4/centery:34.9/zoom:8",
    },
    mtLarnaca: {
      label: "MT · Larnaca",
      href: "https://www.marinetraffic.com/en/ais/home/centerx:33.63/centery:34.92/zoom:10",
    },
    mtFamagusta: {
      label: "MT · Famagusta",
      href: "https://www.marinetraffic.com/en/ais/home/centerx:33.95/centery:35.12/zoom:10",
    },
    mtSaar: {
      label: "MT · Sa'ar search",
      href: "https://www.marinetraffic.com/en/ais/index/search/all?keyword=Saar",
    },
    /** Tight boxes — eyeball navy/military; do not claim scrape. */
    mtCyprusNavyFilter: {
      label: "MT · Cyprus zoom (eyeball navy)",
      href: "https://www.marinetraffic.com/en/ais/home/centerx:33.7/centery:34.95/zoom:9",
    },
    vesselFinderCyprus: {
      label: "VesselFinder · Cyprus",
      href: "https://www.vesselfinder.com/?latitude=34.9&longitude=33.5&zoom=8",
    },
    myShipCyprus: {
      label: "MyShipTracking · Cyprus",
      href: "https://www.myshiptracking.com/map?center=34.9,33.5&zoom=8",
    },
    cutAis: {
      label: "CUT-AIS · Cyprus (uni map)",
      href: "https://ais.cut.ac.cy/",
    },
    localizaTodo: {
      label: "LocalizaTodo · AIS+ADS-B (no signup)",
      href: "https://localizatodo.com/web.html",
    },
    mtHaifa: {
      label: "MarineTraffic · Haifa",
      href: "https://www.marinetraffic.com/en/ais/home/centerx:35.0/centery:32.82/zoom:11",
    },
    rocketAlert: {
      label: "RocketAlert TG",
      href: "https://t.me/RocketAlert",
    },
    idfTg: { label: "IDF official TG", href: "https://t.me/idfofficial" },
    ironsight: { label: "IRONSIGHT", href: IRONSIGHT_URL },
    yahooIls: {
      label: "Yahoo ILS=X",
      href: "https://finance.yahoo.com/quote/ILS=X",
    },
  };

  // —— AER-01 tanker cluster (partial: Levant/Med free ADS-B, not Hatzerim-exact) ——
  // Doctrine: WARM = ≥1 tanker (typically 1–2); HOT = ≥3 tankers.
  // AWACS alone boosts read/awareness but must NOT warm AER-01.
  // FOLLOWED outbound tankers are live plot/paste only — never score High-go.
  const followedLive = (aerial.tracks ?? []).filter((t) => t.followed);
  const followedTankerN = followedLive.filter((t) => t.kind === "tanker").length;
  const followedAwacsN = followedLive.filter((t) => t.kind === "awacs").length;
  const followBit =
    followedLive.length > 0
      ? ` · ${followedLive.length} FOLLOWED outbound (${followedTankerN}t/${followedAwacsN}a — still transmitting, not scored)`
      : "";
  const churnBit =
    aerial.aer01Churn?.summary &&
    (aerial.aer01Churn.live +
      aerial.aer01Churn.dark +
      aerial.aer01Churn.landed +
      aerial.aer01Churn.followed >
      0 ||
      /→/.test(aerial.aer01Churn.summary))
      ? ` · tanker churn: ${aerial.aer01Churn.summary}`
      : "";
  const aer01Status: IsraelStrikeTellStatus = !aerial.feedOk
    ? "unknown"
    : aerial.tankerCount >= 3
      ? "hot"
      : aerial.tankerCount >= 1
        ? "warm"
        : "quiet";
  const aer01Pts = tellPoints(aer01Status, 28);
  const aerialAgeLabel =
    aerial.ageSec > 0
      ? `${aerial.ageSec}s ago`
      : aerial.fromCache
        ? "cached"
        : "live";
  const aer01: IsraelStrikeTell = {
    id: "AER-01",
    category: "AER",
    label: "Tanker cluster (Levant/Med ADS-B proxy)",
    lookFor:
      "≥3 KC/tanker tracks in Israel/Levant/E-Med boxes westward — DeepSeek wants Hatzerim/Nevatim KC cluster (FR24); we approximate with free adsb.lol (+ OpenSky failover). Red Sea/Somali/Gulf tankers do NOT count. WARM needs ≥1 tanker; AWACS alone does not warm. Hexes enrolled in-box stay FOLLOWED globally while transmitting; outbound does not score.",
    sourceHint:
      "adsb.lol mil + Levant/Med/Israel boxes sequential; watchlist hex / OpenSky icao24 follow outside boxes; OpenSky bbox failover on 429/fail (callsign-typed only; AER-01 only)",
    nominalConfidence: 85,
    weight: 28,
    status: aer01Status,
    ...aer01Pts,
    read: (!aerial.feedOk
      ? aerial.feedStatus === "degraded" || aerial.fromCache
        ? `FEED DEGRADED — ${aerial.error ?? "adsb.lol rate-limited"}. Last-good: ${aerial.tankerCount} tankers / ${aerial.awacsCount} AWACS (${aerialAgeLabel}). Open FR24 LLBG / adsb.lol manually.`
        : `FEED FAILED — ${aerial.error ?? "adsb.lol unreachable"}. ${aerial.fromCache ? `Last-good: ${aerial.tankerCount} tankers / ${aerial.awacsCount} AWACS (${aerialAgeLabel}).` : ""} Open FR24 LLBG / adsb.lol manually.`
      : aerial.feedStatus === "degraded"
        ? `FEED DEGRADED · ${aerial.tankerCount} tanker(s) + ${aerial.awacsCount} AWACS (${aerialAgeLabel}) · src=${aerial.adsbSource ?? "adsb.lol"} · ${aerial.error ?? "partial boxes"}.`
      : aerial.feedStatus === "dark" && aer01Status === "quiet"
        ? `FEED DARK — 0 tankers / 0 AWACS in Levant+Med+Israel boxes (${aerial.otherMilCount} other mil · ${aerialAgeLabel} · src=${aerial.adsbSource ?? "adsb.lol"}). Quiet OR mil dark — blank sky ≠ all-clear. Boxes ok: ${aerial.boxesOk.join(",") || "—"}.`
        : aer01Status === "hot"
          ? `FEED OK · ${aerial.tankerCount} tanker(s) + ${aerial.awacsCount} AWACS (${aerialAgeLabel} · src=${aerial.adsbSource ?? "adsb.lol"}) — AER-01 cluster lit. Exact Hatzerim KC + westward vector still FR24 manual.`
          : aer01Status === "warm"
            ? `FEED OK · ${aerial.tankerCount} tanker(s) + ${aerial.awacsCount} AWACS (${aerialAgeLabel} · src=${aerial.adsbSource ?? "adsb.lol"}) — elevated, not full cluster (≥3 tankers).`
            : aerial.awacsCount >= 1
              ? `FEED OK · 0 tankers / ${aerial.awacsCount} AWACS (${aerialAgeLabel} · src=${aerial.adsbSource ?? "adsb.lol"}) — AWACS alone does not warm AER-01 (need ≥1 tanker for WARM, ≥3 for HOT).`
              : `FEED OK · 0 tankers (${aerial.otherMilCount} other mil · ${aerialAgeLabel} · src=${aerial.adsbSource ?? "adsb.lol"}). Quiet on free ADS-B.`) +
      followBit +
      churnBit,
    evidence: [
      `feed=${aerial.feedStatus.toUpperCase()} · src=${aerial.adsbSource ?? "adsb.lol"} · boxes=${aerial.boxesOk.join("+") || "none"} · age=${aerialAgeLabel}`,
      ...aerial.samples,
    ],
    links: [
      linksCommon.adsbLol,
      linksCommon.adsbExchangeIl,
      linksCommon.fr24Llbg,
      {
        label: "OpenSky Network API",
        href: "https://opensky-network.org/api/states/all",
      },
    ],
    layer: "auto",
  };

  // —— AER-02 civilian reroute / NOTAM ——
  const notamRe =
    /NOTAM|TFR|flight\s+restriction|airspace|reroute|holding\s+pattern|closed|Eurocontrol|Nicosia|LLBG|Cyprus|Eastern\s+Med|SIGMET|notice\s+to\s+airmen|prohibited\s+area/i;
  const notamReject =
    /rocket\s+launch|space\s+launch|Pakistan|completely available|weather\s+delay|convective|thunderstorm|turbulence\s+only/i;
  const notamHits = notamItems.filter(
    (i) => notamRe.test(i.title) && !notamReject.test(i.title),
  );
  const freshNotam = notamHits.filter((i) => {
    const ms = parsePubMs(i.pubDate);
    return ms == null || nowMs - ms <= 18 * 60 * 60 * 1000;
  });
  const aer02Status: IsraelStrikeTellStatus =
    freshNotam.length >= 2 ? "hot" : freshNotam.length === 1 ? "warm" : "quiet";
  const aer02Pts = tellPoints(aer02Status, 12);
  const aer02: IsraelStrikeTell = {
    id: "AER-02",
    category: "AER",
    label: "Civilian reroute / Med NOTAM",
    lookFor:
      "Sudden holding/reroutes over E-Med/Cyprus or NATO/Eurocontrol emergency NOTAM (DeepSeek AER-02).",
    sourceHint:
      "Google News RSS + EUROCONTROL RSS + AWC intl SIGMET (ME filter) — approx FIR boxes only; not official NOTAM geometry / not live FR24",
    nominalConfidence: 60,
    weight: 12,
    status: aer02Status,
    ...aer02Pts,
    read:
      aer02Status === "hot"
        ? `${freshNotam.length} fresh Med/Israel NOTAM/reroute hits — AER-02-ish sky seal (map zones auto-lit).`
        : aer02Status === "warm"
          ? `1 Med/Israel NOTAM/reroute hit — map zone auto-lit; watch Eurocontrol/FR24 backup.`
          : "No fresh Cyprus/Israel NOTAM/reroute chatter in free RSS (auto).",
    evidence: freshNotam.map((i) => i.title).slice(0, 5),
    links: [
      {
        label: "Google · Med NOTAM",
        href: `https://news.google.com/search?q=${encodeURIComponent("NOTAM Cyprus OR Israel OR Eastern Med flight restriction")}&hl=en-US&gl=US&ceid=US:en`,
      },
      {
        label: "EUROCONTROL news",
        href: "https://www.eurocontrol.int/",
      },
      {
        label: "AWC · intl SIGMET",
        href: "https://aviationweather.gov/data/isigmet/",
      },
      linksCommon.fr24Llbg,
    ],
    layer: "auto",
  };

  // —— AER-03 Mode-5 ghost sweep — impossible free ——
  const aer03: IsraelStrikeTell = {
    id: "AER-03",
    category: "AER",
    label: "F-35/F-15 Mode-5 ghost sweep",
    lookFor:
      "Multiple fighter-grade Mode-5 IFF squawks over Negev/Med then go dark — not available on free ADS-B.",
    sourceHint: "Impossible free — Mode-5 IFF not on adsb.lol",
    nominalConfidence: 80,
    weight: 0,
    status: "manual",
    lit: false,
    points: 0,
    read: "Layer-3 gap: Mode-5 / mil IFF not readable on free ADS-B. If fighters appear briefly then vanish on FR24/ADSBx, mark manually — do not invent.",
    evidence: [],
    links: [linksCommon.fr24Llbg, linksCommon.adsbExchangeIl],
    layer: "manual",
  };

  // —— NAV-01 Cyprus Sa'ar loiter (AISStream optional + manual posture/count) ——
  const cyprusAis = getCyprusAisSnapshot();
  const navPostureRaw = manual.nav01.posture;
  const navUpdatedMs = Date.parse(manual.nav01.updatedAt ?? "");
  /** ais_dark_suspected older than 24h is not a live peer — operator must re-mark. */
  const navPostureStale =
    navPostureRaw === "ais_dark_suspected" &&
    Number.isFinite(navUpdatedMs) &&
    Date.now() - navUpdatedMs > 24 * 3600_000;
  const navPosture = navPostureStale ? "not_set" : navPostureRaw;
  const navyCount = manual.nav01.navyCount;
  const navyThreshold = manual.nav01.navyThreshold;
  const manualCountLit =
    navyCount != null && navyCount >= navyThreshold;
  const aisNavyLit = cyprusAis.enabled && cyprusAis.navyLikeCount >= 1;
  const aisHot = cyprusAis.enabled && cyprusAis.navyLikeCount >= 2;

  let nav01Status: IsraelStrikeTellStatus = "manual";
  let nav01Weight = 0;
  if (navPosture === "loitering_cyprus" || aisHot || (manualCountLit && (navyCount ?? 0) >= 2)) {
    nav01Status = "hot";
    nav01Weight = 22;
  } else if (
    navPosture === "ais_dark_suspected" ||
    aisNavyLit ||
    manualCountLit
  ) {
    nav01Status = "warm";
    nav01Weight = 10;
  } else if (navPosture === "quiet" && !aisNavyLit && !manualCountLit) {
    nav01Status = "quiet";
    nav01Weight = 0;
  } else if (cyprusAis.enabled && cyprusAis.status === "live" && cyprusAis.navyLikeCount === 0) {
    nav01Status = "quiet";
    nav01Weight = 0;
  } else if (
    cyprusAis.enabled &&
    (cyprusAis.status === "empty" || cyprusAis.status === "stale") &&
    navPosture === "not_set"
  ) {
    // Empty/stale AIS is unknown — never quiet confirmation without manual navy.
    nav01Status = "unknown";
    nav01Weight = 0;
  } else if (cyprusAis.enabled && (cyprusAis.status === "error" || cyprusAis.status === "connecting")) {
    nav01Status = navPosture === "not_set" ? "unknown" : nav01Status;
  }

  // Explicit quiet posture wins over empty AIS unless user counted navy or AIS sees navy-like
  if (navPosture === "quiet" && !manualCountLit && !aisNavyLit) {
    nav01Status = "quiet";
    nav01Weight = 0;
  }
  // Explicit loitering always hot
  if (navPosture === "loitering_cyprus") {
    nav01Status = "hot";
    nav01Weight = 22;
  }

  const nav01Pts = tellPoints(nav01Status, nav01Weight);
  const aisReadBits: string[] = [];
  if (!cyprusAis.enabled) {
    aisReadBits.push("AISStream KEY UNSET (set AISSTREAM_API_KEY)");
  } else if (cyprusAis.status === "connecting") {
    const age =
      cyprusAis.statusAgeSec != null && cyprusAis.statusAgeSec > 0
        ? ` ${cyprusAis.statusAgeSec}s`
        : "";
    aisReadBits.push(
      `AISStream connecting${age} / waiting for first ping…`,
    );
  } else if (cyprusAis.status === "error") {
    const age =
      cyprusAis.statusAgeSec != null && cyprusAis.statusAgeSec > 0
        ? ` · ${cyprusAis.statusAgeSec}s`
        : "";
    aisReadBits.push(
      `AISStream ERROR: ${cyprusAis.error ?? "unknown"}${age} (auto-reconnect)`,
    );
  } else if (cyprusAis.status === "empty" || cyprusAis.status === "stale") {
    aisReadBits.push(
      `AISStream ${cyprusAis.status.toUpperCase()} · ${cyprusAis.totalInBox} in box — auto feed, not quiet confirmation`,
    );
  } else {
    aisReadBits.push(
      `AISStream LIVE (auto) · ${cyprusAis.totalInBox} in box · navy-like ${cyprusAis.navyLikeCount} (mil ${cyprusAis.militaryCount} · name-hit ${cyprusAis.interestCount}) · tanker ${cyprusAis.tankerCount}`,
    );
  }
  if (navyCount != null) {
    aisReadBits.push(`manual navy count ${navyCount} (threshold ${navyThreshold})`);
  }

  const nav01AutoFilled =
    cyprusAis.enabled &&
    cyprusAis.status === "live" &&
    (cyprusAis.navyLikeCount >= 1 || cyprusAis.totalInBox > 0);

  const nav01: IsraelStrikeTell = {
    id: "NAV-01",
    category: "NAV",
    label: "Cyprus medevac / Sa'ar loiter",
    lookFor:
      "Israeli Sa'ar / heavy-lift helo ship loiters >24h within 50nm of Larnaca/Famagusta.",
    sourceHint: cyprusAis.enabled
      ? "AISStream.io free key (Cyprus bbox, auto) + optional manual posture — not MarineTraffic scrape"
      : "AISSTREAM_API_KEY unset — deep links backup + manual navy count / posture",
    nominalConfidence: cyprusAis.enabled ? 70 : 75,
    weight: nav01Weight,
    status: nav01Status,
    ...nav01Pts,
    read:
      navPosture === "loitering_cyprus"
        ? `NAV-01 LIT — manual Cyprus loiter marked${manual.nav01.note ? `: ${manual.nav01.note}` : ""}. ${aisReadBits.join(" · ")}. High-go peer to AER-01.`
        : nav01Pts.lit
          ? `NAV-01 ${nav01Status} — ${aisReadBits.join(" · ")}${manual.nav01.note ? ` · ${manual.nav01.note}` : ""}.`
          : navPosture === "ais_dark_suspected"
            ? `NAV-01 warm — AIS dark suspected off Cyprus${manual.nav01.note ? `: ${manual.nav01.note}` : ""}. ${aisReadBits.join(" · ")}.`
            : navPosture === "quiet"
              ? `NAV-01 quiet — manual mark: no Sa'ar/corvette loiter. ${aisReadBits.join(" · ")}.`
              : nav01Status === "unknown"
                ? !cyprusAis.enabled
                  ? `NAV-01 unknown — AISStream KEY UNSET. ${aisReadBits.join(" · ")}. Deep links are backup.`
                  : `NAV-01 unknown — AISStream empty/stale is NOT quiet confirmation. ${aisReadBits.join(" · ")}. Deep links backup if needed.`
                : nav01AutoFilled
                  ? `NAV-01 quiet on auto AISStream (navy-like 0). ${aisReadBits.join(" · ")}. Warships often AIS-dark — posture mark optional.`
                  : cyprusAis.enabled
                    ? `NAV-01 — AISStream ${cyprusAis.status}; waiting for navy-like or posture mark. ${aisReadBits.join(" · ")}.`
                    : `NAV-01 — set AISSTREAM_API_KEY for auto navy-like count, or use deep-link backup. ${aisReadBits.join(" · ")}.`,
    evidence: [
      `posture=${navPostureRaw}${navPostureStale ? " (stale>24h → ignored for peer)" : ""}`,
      `aisstream=${cyprusAis.status} navyLike=${cyprusAis.navyLikeCount} total=${cyprusAis.totalInBox}`,
      ...(navyCount != null
        ? [`manualNavy=${navyCount}/${navyThreshold}`]
        : []),
      ...(manual.nav01.note ? [manual.nav01.note] : []),
      ...(manual.nav01.updatedAt
        ? [`updated ${manual.nav01.updatedAt}`]
        : []),
      ...(navPostureStale
        ? ["ais_dark_suspected expired — re-mark Loitering / navy count or clear"]
        : []),
      ...cyprusAis.vessels
        .slice(0, 8)
        .map(
          (v) =>
            `${v.category} ${v.name} (${v.shipTypeLabel}) @ ${v.lat.toFixed(2)},${v.lon.toFixed(2)}`,
        ),
    ],
    links: [
      linksCommon.mtCyprusNavyFilter,
      linksCommon.mtLarnaca,
      linksCommon.mtFamagusta,
      linksCommon.mtSaar,
      linksCommon.vesselFinderCyprus,
      linksCommon.myShipCyprus,
      linksCommon.cutAis,
      linksCommon.localizaTodo,
    ],
    layer:
      navPosture !== "not_set" ||
      manualCountLit ||
      (cyprusAis.enabled &&
        (cyprusAis.status === "live" ||
          cyprusAis.status === "empty" ||
          cyprusAis.status === "connecting"))
        ? "auto"
        : "manual",
  };
  const nav02: IsraelStrikeTell = {
    id: "NAV-02",
    category: "NAV",
    label: "USNS logistics sprint halt",
    lookFor:
      "USNS T-AOE/T-AKE stops Gulf sprint, AIS off, or parks E-Med >12h.",
    sourceHint: "MarineTraffic / IRONSIGHT ship stamps — deep-link",
    nominalConfidence: 70,
    weight: 0,
    status: "manual",
    lit: false,
    points: 0,
    read: "Manual gap: check MarineTraffic USNS + IRONSIGHT naval stamps. Do not invent AIS positions.",
    evidence: [],
    links: [
      linksCommon.mtCyprus,
      {
        label: "MarineTraffic · USNS search",
        href: "https://www.marinetraffic.com/en/ais/index/search/all?keyword=USNS",
      },
      linksCommon.ironsight,
    ],
    layer: "manual",
  };
  const nav03: IsraelStrikeTell = {
    id: "NAV-03",
    category: "NAV",
    label: "Haifa port naval surge",
    lookFor:
      "Unusual naval aux / ammo-fuel barge activity at Haifa, night departures ≤12h.",
    sourceHint: "MarineTraffic Haifa — deep-link only",
    nominalConfidence: 65,
    weight: 0,
    status: "manual",
    lit: false,
    points: 0,
    read: "Manual gap: MarineTraffic Haifa zoom. Pairs with AER-03 in DeepSeek medium-go — both unpaid.",
    evidence: [],
    links: [linksCommon.mtHaifa],
    layer: "manual",
  };

  // —— ELEC-01 IDF radio silence (weak) ——
  const idfChannelRe = /idf|idfofficial|kan.?news|n12|walla|timesofisrael|abuali/i;
  const opsRe =
    /siren|interceptor|intercept|drone|UAV|Hezbollah|Lebanon|Gaza|strike|operation|IDF\s+(struck|attacked|eliminat)|rocket|Pikud|Home\s*Front|צה.?ל/i;
  const idfPosts = ironsight.tgPosts.filter(
    (p) => idfChannelRe.test(p.channel) || /IDF|צה.?ל|IDFofficial/i.test(p.text + p.channel),
  );
  const recentOps = [...idfPosts, ...ironsight.news.map((n) => ({ text: n.title, channel: "news", date: undefined }))]
    .filter((p) => opsRe.test(p.text))
    .slice(0, 8);
  const daytime = isDaytimeIsrael();
  let elec01Status: IsraelStrikeTellStatus = "unknown";
  if (!ironsight.online && idfPosts.length === 0) {
    elec01Status = "unknown";
  } else if (daytime && recentOps.length === 0 && idfPosts.length <= 1) {
    elec01Status = "warm"; // silence is weak — never hot alone
  } else if (recentOps.length >= 2) {
    elec01Status = "quiet"; // chatter present → not silence
  } else {
    elec01Status = daytime ? "quiet" : "quiet";
  }
  const elec01Pts = tellPoints(elec01Status, 10);
  const elec01OfflineRead = !ironsight.online
    ? "IRONSIGHT offline / no IDF TG sample — silence unknown. Backup: t.me/idfofficial."
    : !ironsight.tgOk
      ? "IRONSIGHT up (health/ships) but telegram panel empty/failed — no IDF TG sample; silence unknown. Backup: t.me/idfofficial."
      : idfPosts.length === 0
        ? "IRONSIGHT up — telegram sample has no IDFofficial posts this cycle; silence unknown (auto sample, not offline)."
        : "IRONSIGHT IDF sample present — not treating as radio silence.";
  const elec01: IsraelStrikeTell = {
    id: "ELEC-01",
    category: "ELEC",
    label: "IDF radio silence (weak heuristic)",
    lookFor:
      "Zero Iranian/IDF operational posts >6h daytime — DeepSeek ELEC-01. Silence ≠ go.",
    sourceHint: "IRONSIGHT telegram + news keyword sample (no GramJS)",
    nominalConfidence: 70,
    weight: 10,
    status: elec01Status,
    ...elec01Pts,
    read:
      elec01Status === "warm"
        ? `Daytime Israel + sparse IDF/ops chatter in IRONSIGHT sample — weak silence watch. Wait for AER-01 / NAV-01 / LLBG; alone = monitor only (do not wait on Shekel).`
        : elec01Status === "unknown"
          ? elec01OfflineRead
          : `Ops chatter present (${recentOps.length}) or night window — not treating as radio silence.`,
    evidence: recentOps.map((p) => `[${p.channel}] ${p.text}`).slice(0, 5),
    links: [linksCommon.idfTg, linksCommon.ironsight],
    layer: "auto",
  };

  const elec02: IsraelStrikeTell = {
    id: "ELEC-02",
    category: "ELEC",
    label: "GPS jamming spike (GPSJam)",
    lookFor: "E-Med/Cyprus GPSJam score <1.5 → >3.5 within 1h.",
    sourceHint: "GPSJam.org — no free API wired; deep-link only",
    nominalConfidence: 60,
    weight: 0,
    status: "manual",
    lit: false,
    points: 0,
    read: "Manual gap: open GPSJam Eastern Med. Tradehole does not scrape GPSJam.",
    evidence: [],
    links: [{ label: "GPSJam", href: "https://gpsjam.org/" }],
    layer: "manual",
  };
  const elec03: IsraelStrikeTell = {
    id: "ELEC-03",
    category: "ELEC",
    label: "Cyber recon pings (GreyNoise/Shodan)",
    lookFor: "Israeli-origin probes vs Iranian SCADA/energy ≤24h.",
    sourceHint: "GreyNoise / Shodan — no free feed",
    nominalConfidence: 50,
    weight: 0,
    status: "manual",
    lit: false,
    points: 0,
    read: "Manual gap: no GreyNoise/Shodan integration. Ignore unless you have a private feed.",
    evidence: [],
    links: [{ label: "GreyNoise visualizer", href: "https://viz.greynoise.io/" }],
    layer: "manual",
  };

  // —— DIP-01 Lebanon/Syria/Golan border (prefer clearing/incursion verbs — not evergreen Hezbollah) ——
  // Bare "raid"/"incursion" without geo matches West Bank / Gaza noise — require Levant north geo.
  // Gaza ground chatter is TheaterWatch / kinetic pins only — never DIP-01 High-go fuel.
  const dip01GeoRe =
    /Leban(on|ese)|Syria|Blue\s+Line|northern\s+front|southern\s+Lebanon|Litani|Shebaa|Golan|Quneitra|Hermon/i;
  const borderClearRe =
    /(?:incursion|raid|kill.?box|clear(?:ing)?\s+(?:the\s+)?border|ground\s+forces?|redeploy|troops?|entered|massing).{0,60}(?:Leban|Syria|Blue\s+Line|northern\s+front|Litani|Golan|Quneitra|Hermon)|(?:Leban|Syria|Blue\s+Line|northern\s+front|Litani|Golan|Quneitra|Hermon).{0,60}(?:incursion|raid|kill.?box|clear(?:ing)?|ground\s+forces?|redeploy|troops?|entered|massing)|entered\s+(?:southern\s+)?Lebanon/i;
  /** Evergreen West Bank / Gaza Strip / weapons-cache / UNRWA noise — never DIP-01 HOT fuel. */
  const dip01NoiseRe =
    /West\s+Bank|UNRWA|East\s+Jerusalem|Jenin|Nablus|Ramallah|Gaza|Rafah|Khan\s+Younis|weapons?\s+cache|arms?\s+cache|Hezbollah.{0,50}(?:cache|arsenal|stockpile|discover)|settler\s+violence/i;
  const borderPool = [
    ...lebanonItems.map((i) => i.title),
    ...ironsight.news.map((n) => n.title),
    ...ironsight.tgPosts.map((p) => p.text),
  ];
  const borderHits = borderPool.filter(
    (t) =>
      borderClearRe.test(t) &&
      dip01GeoRe.test(t) &&
      !dip01NoiseRe.test(t),
  );
  const softBorder = [
    ...lebanonItems.map((i) => i.title),
    ...ironsight.news.map((n) => n.title),
  ].filter(
    (t) =>
      /Leban(on|ese).{0,40}(IDF|Israel)|IDF.{0,40}Leban|Blue\s+Line|northern\s+front|Golan|Quneitra/i.test(
        t,
      ) &&
      !borderClearRe.test(t) &&
      !dip01NoiseRe.test(t),
  );
  const dip01Status: IsraelStrikeTellStatus =
    borderHits.length >= 2
      ? "hot"
      : borderHits.length >= 1
        ? "warm"
        : softBorder.length >= 3
          ? "warm"
          : "quiet";
  const dip01Pts = tellPoints(dip01Status, 12);
  const dip01: IsraelStrikeTell = {
    id: "DIP-01",
    category: "DIP",
    label: "Lebanon / Syria / Golan border clearing",
    lookFor:
      "IDF 'routine' incursions / border massing ≤24h (Lebanon, Syria, Golan) — kill-box clear before strike. Gaza ≠ DIP-01.",
    sourceHint: "Google News + IRONSIGHT TG (bintjbeil / OSINT)",
    nominalConfidence: 65,
    weight: 12,
    status: dip01Status,
    ...dip01Pts,
    read:
      dip01Status === "hot"
        ? `${borderHits.length} Lebanon/Syria/Golan clearing/incursion hits — DIP-01 kill-box posture.`
        : dip01Status === "warm"
          ? `Northern-border clearing or soft massing chatter (clear ${borderHits.length} / soft ${softBorder.length}) — watch vs evergreen Hezbollah / West Bank / Gaza noise.`
          : "No clear Lebanon/Syria/Golan border-clearing spike (West Bank / Gaza / weapons-cache / evergreen Hezbollah ignored).",
    evidence: [...borderHits, ...softBorder].slice(0, 6),
    links: [
      {
        label: "Google · IDF Lebanon",
        href: `https://news.google.com/search?q=${encodeURIComponent("IDF Lebanon border OR incursion Hezbollah")}&hl=en-US&gl=US&ceid=US:en`,
      },
      {
        label: "Google · Golan",
        href: `https://news.google.com/search?q=${encodeURIComponent("Golan Heights IDF OR Syria Quneitra")}&hl=en-US&gl=US&ceid=US:en`,
      },
      { label: "Bint Jbeil TG", href: "https://t.me/bintjbeilnews" },
      linksCommon.ironsight,
    ],
    layer: "auto",
  };

  // —— DIP-02 embassy drawdown ——
  const embRe =
    /embassy\s+(advisory|alert)|ordered\s+departure|drawdown|security\s+alert|evacuate|authorized\s+departure/i;
  const embHits = embassyItems.filter((i) => {
    if (!embRe.test(i.title)) return false;
    const ms = parsePubMs(i.pubDate);
    return ms == null || nowMs - ms <= 36 * 60 * 60 * 1000;
  });
  const dip02Status: IsraelStrikeTellStatus =
    embHits.length >= 1 ? "hot" : "quiet";
  const dip02Pts = tellPoints(dip02Status, 10);
  const dip02: IsraelStrikeTell = {
    id: "DIP-02",
    category: "DIP",
    label: "US embassy drawdown / advisory",
    lookFor: "Beirut/Baghdad (or Israel) embassy alert / staff reduction.",
    sourceHint: "Google News RSS embassy advisories",
    nominalConfidence: 55,
    weight: 10,
    status: dip02Status,
    ...dip02Pts,
    read:
      dip02Status === "hot"
        ? `Embassy/drawdown hit: ${embHits[0]?.title ?? "—"}`
        : "No fresh embassy drawdown / advisory in free RSS.",
    evidence: embHits.map((i) => i.title).slice(0, 4),
    links: [
      {
        label: "Google · embassy alert",
        href: `https://news.google.com/search?q=${encodeURIComponent("embassy advisory OR drawdown Beirut OR Baghdad")}&hl=en-US&gl=US&ceid=US:en`,
      },
      {
        label: "travel.state.gov",
        href: "https://travel.state.gov/",
      },
    ],
    layer: "auto",
  };

  // —— POL-01 cabinet leak (negative filter) ——
  const cabinetRe =
    /security\s+cabinet|cabinet\s+(meeting|convene)|convenes?\s+.{0,40}cabinet|Netanyahu.{0,40}(Iran|strike|cabinet)/i;
  const polHits = cabinetItems.filter((i) => {
    if (!cabinetRe.test(i.title)) return false;
    const ms = parsePubMs(i.pubDate);
    return ms == null || nowMs - ms <= 24 * 60 * 60 * 1000;
  });
  const pol01Lit = polHits.length >= 1;
  // points applied after we know physical stack
  const pol01Base: Omit<IsraelStrikeTell, "points" | "lit" | "status" | "read"> & {
    status?: IsraelStrikeTellStatus;
  } = {
    id: "POL-01",
    category: "POL",
    label: "Security cabinet leak (negative filter)",
    lookFor:
      "Kan/Ch.13 'Netanyahu convenes security cabinet for Iran' — WITHOUT physical tells = feint.",
    sourceHint: "Google News Kan / Channel 13 / cabinet",
    nominalConfidence: -40,
    weight: -25,
    evidence: polHits.map((i) => i.title).slice(0, 5),
    links: [
      {
        label: "Google · security cabinet Iran",
        href: `https://news.google.com/search?q=${encodeURIComponent("Netanyahu security cabinet Iran")}&hl=en-US&gl=US&ceid=US:en`,
      },
    ],
    layer: "auto",
  };

  // —— EXEC-01 Shekel (lagging confirmation — often ON/AFTER kinetic) ——
  const leadingPhysicalLit = aer01.lit || aer02.lit || nav01.lit;
  const exec01Status: IsraelStrikeTellStatus = shekel.spiked
    ? "hot"
    : shekel.firm
      ? "warm"
      : shekel.price == null
        ? "unknown"
        : "quiet";
  const exec01Pts = tellPoints(exec01Status, 22);
  const shekelAlone =
    exec01Pts.lit && !aer01.lit && !nav01.lit;
  const shekelConfirmsLeaders =
    exec01Pts.lit && (aer01.lit || nav01.lit);
  const exec01Read = (() => {
    const fx =
      shekel.price != null
        ? `USD/ILS ${shekel.price.toFixed(4)}${
            shekel.changePct != null
              ? ` (${shekel.changePct >= 0 ? "+" : ""}${shekel.changePct.toFixed(2)}%)`
              : ""
          }`
        : shekel.read;
    if (shekelAlone && shekel.spiked) {
      return `LAGGING / MARKET PANIC — ${fx} spiked with quiet AER-01/NAV-01. Often prints ON/AFTER attack pricing — not "caught early". Do not treat as pre-launch High-go.`;
    }
    if (shekelAlone && shekel.firm) {
      return `LAGGING FX firm — ${fx} with quiet aerial/NAV. Watch AER-01 / NAV-01 / LLBG / Hebrew go language first; FX often lags surprise kinetic.`;
    }
    if (shekelConfirmsLeaders && shekel.spiked) {
      return `LAGGING CONFIRMATION — ${fx} spiked AFTER AER/NAV already lit. Post-go / market panic boost — useful corroboration, not the lead tell.`;
    }
    if (shekelConfirmsLeaders) {
      return `LAGGING CONFIRMATION warm — ${fx} with AER/NAV already lit. Confirmation path; still lead on physical/OSINT.`;
    }
    if (shekel.spiked) {
      return `SHEKEL SPIKE (lagging tell) — ${fx}. Often lags surprise kinetic; do not wait on Shekel for pre-launch.`;
    }
    return shekel.read.includes("quiet") || shekel.price != null
      ? `${fx} · EXEC-01 lagging confirmation (weight for post-go panic; High-go does not require FX).`
      : shekel.read;
  })();
  const exec01: IsraelStrikeTell = {
    id: "EXEC-01",
    category: "EXEC",
    label: "Shekel lagging confirmation (USD/ILS)",
    lookFor: `USD/ILS ≥${SHEKEL_SPIKE_HARD} (band ~${SHEKEL_SPIKE_FLOOR}–${SHEKEL_THRESHOLD}) or ≥${SHEKEL_ROC_FLOOR}+${SHEKEL_ROC_PCT}% d/d — lagging confirmation / market panic. Often spikes ON/AFTER kinetic; sometimes anticipatory — do not wait on Shekel for pre-launch.`,
    sourceHint: shekel.source,
    nominalConfidence: 70,
    weight: 22,
    status: exec01Status,
    ...exec01Pts,
    read: exec01Read,
    evidence:
      shekel.price != null
        ? [
            `USD/ILS ${shekel.price.toFixed(4)} · d/d ${shekel.changePct?.toFixed(2) ?? "—"}%`,
            shekelAlone
              ? "role=market_panic_lagging (quiet AER/NAV)"
              : shekelConfirmsLeaders
                ? "role=confirmation_after_AER_NAV"
                : "role=lagging_confirmation",
          ]
        : [],
    links: [linksCommon.yahooIls],
    layer: "auto",
  };

  // —— PIKUD / RocketAlert corroboration ——
  // Prefer Iran/strategic framing — routine Gaza/Lebanon sirens are wartime baseline.
  const pikudChannelRe = /rocketalert|pikud|home\s*front|alertisrael|idf/i;
  const pikudHits = [
    ...ironsight.alerts.map((a) =>
      a.source ? `[${a.source}] ${a.title}` : a.title,
    ),
    ...ironsight.tgPosts
      .filter((p) => pikudChannelRe.test(p.channel + " " + p.text))
      .map((p) => `[TG ${p.channel}] ${p.text}`),
    ...ironsight.news
      .map((n) => n.title)
      .filter((t) =>
        /Rocket\s*Alert|Pikud|Home\s*Front|siren|missile\s+alert/i.test(t),
      ),
  ].filter((t) =>
    /siren|rocket|Pikud|Home\s+Front|alert|interceptor|missile|ירי|אזעק/i.test(
      t,
    ),
  );
  const pikudStrategic = pikudHits.filter((t) =>
    /Iran|ballistic|nationwide|Tel\s+Aviv|central\s+Israel|Haifa|Jerusalem|missile\s+barrage|איראן/i.test(
      t,
    ),
  );
  const pikudSampleOk =
    ironsight.alertsOk ||
    ironsight.tgPosts.some((p) =>
      /rocketalert|alertisrael|pikud|home\s*front/i.test(p.channel),
    );
  const pikudStatus: IsraelStrikeTellStatus = !ironsight.online
    ? "unknown"
    : pikudStrategic.length >= 2
      ? "hot"
      : pikudStrategic.length >= 1 || pikudHits.length >= 8
        ? "warm"
        : pikudHits.length >= 1
          ? "quiet" // baseline wartime sirens — visible in evidence, not lit
          : "quiet";
  const pikudPts = tellPoints(pikudStatus, 8);
  const pikudUnknownRead = !ironsight.online
    ? "IRONSIGHT offline — RocketAlert TG is backup only."
    : !pikudSampleOk
      ? "IRONSIGHT up — alerts/RocketAlert sample empty this cycle (not full offline). Backup: t.me/RocketAlert."
      : "No Pikud sample yet in auto IRONSIGHT scrape.";
  const pikud01: IsraelStrikeTell = {
    id: "PIKUD-01",
    category: "PIKUD",
    label: "Pikud / RocketAlert activity",
    lookFor:
      "Home Front / RocketAlert surge — often post-launch or dual-front; corroborates, not sole go.",
    sourceHint: "IRONSIGHT alerts + RocketAlert/IDFofficial TG sample (auto)",
    nominalConfidence: 55,
    weight: 8,
    status: pikudStatus,
    ...pikudPts,
    read:
      pikudStatus === "hot"
        ? `Strategic/Iran-framed Pikud surge (${pikudStrategic.length}) — corroborating, not sole go.`
        : pikudStatus === "warm"
          ? `Elevated rocket/siren sample (strategic ${pikudStrategic.length} / raw ${pikudHits.length}) — auto from IRONSIGHT.`
          : pikudStatus === "unknown"
            ? pikudUnknownRead
            : pikudHits.length > 0
              ? `Routine wartime sirens in sample (${pikudHits.length}) — not treated as pre-launch tell.`
              : pikudSampleOk
                ? "IRONSIGHT RocketAlert/IDF sample present — no surge scored."
                : "IRONSIGHT up — no Pikud/RocketAlert surge in auto sample. Backup: t.me/RocketAlert.",
    evidence: (pikudStrategic.length > 0 ? pikudStrategic : pikudHits).slice(
      0,
      5,
    ),
    links: [linksCommon.rocketAlert, linksCommon.ironsight],
    layer: "auto",
  };

  // Leading physical for POL negative filter (AER/NAV) — Shekel alone ≠ pre-launch
  const physicalAutoLit = leadingPhysicalLit;
  const physicalProxyCount = [aer01, aer02, nav01].filter((t) => t.lit).length;

  let polStatus: IsraelStrikeTellStatus = pol01Lit ? "hot" : "quiet";
  let polPoints = 0;
  let polLit = false;
  let polRead = "No fresh security-cabinet / Iran convene leak.";
  if (pol01Lit && !physicalAutoLit) {
    polStatus = "hot";
    polLit = true;
    polPoints = -25; // inverse — pulls score down / flags feint
    polRead = `Cabinet leak WITHOUT aerial/NAV leading tells — treat as FEINT / 2h delay (DeepSeek POL-01 inverse). Shekel alone does not clear feint. ${polHits[0]?.title ?? ""}`;
  } else if (pol01Lit && physicalAutoLit) {
    polStatus = "warm";
    polLit = true;
    polPoints = 0; // context only when physical already lit
    polRead = `Cabinet leak WITH AER/NAV leading tells present — not a solo feint; still trust AER/NAV over the leak (Shekel lags). ${polHits[0]?.title ?? ""}`;
  }

  const pol01: IsraelStrikeTell = {
    ...pol01Base,
    status: polStatus,
    lit: polLit,
    points: polPoints,
    read: polRead,
  };

  // —— GO-01 Hebrew / Home Front go-language (soft; NEVER sole High-go peer) ——
  const goCorpus: NewsItem[] = [
    ...goLangItems.map((i) => ({
      ...i,
      source: i.source ?? "Google News",
    })),
    ...ironsight.news.map((n) => ({
      title: n.title,
      link: n.link ?? "",
      pubDate: n.pubDate ?? "",
      source: "IRONSIGHT news",
    })),
    ...ironsight.alerts.map((a) => ({
      title: a.title,
      link: "",
      pubDate: "",
      source: a.source ? `alert ${a.source}` : "IRONSIGHT alerts",
    })),
    ...ironsight.tgPosts.map((p) => ({
      title: p.text.slice(0, 400),
      link: p.url ?? "",
      pubDate: p.date ?? "",
      source: p.channel ? `TG ${p.channel}` : "IRONSIGHT TG",
    })),
  ];
  const goClassified = classifyGoLanguageItems(goCorpus, nowMs);
  const go01Status: IsraelStrikeTellStatus = goClassified.status;
  const go01Pts = tellPoints(go01Status, 14);
  const goHitsOrdered = [...goClassified.hardHits, ...goClassified.softHits];
  const goHitLines = goHitsOrdered.slice(0, 6).map((h) => formatGoLanguageHit(h));
  const goQuote =
    goHitsOrdered[0] != null
      ? ` “${goHitsOrdered[0].title.slice(0, 180)}”${goHitsOrdered[0].source ? ` (${goHitsOrdered[0].source})` : ""}`
      : "";
  const goHitLinks = goHitsOrdered
    .filter((h) => h.link?.trim())
    .slice(0, 3)
    .map((h, i) => ({
      label: `${h.strength === "hard" ? "HARD" : "SOFT"} hit ${i + 1}`,
      href: h.link!.trim(),
    }));
  const go01: IsraelStrikeTell = {
    id: "GO-01",
    category: "GO",
    label: "Hebrew / Home Front go-language",
    lookFor:
      "Home Front Command / open shelters / preemptive-strike language in Hebrew or EN — soft pre-launch tell. Never a sole High-go peer.",
    sourceHint:
      "Google News + IRONSIGHT news/TG (IDFofficial · RocketAlert prioritized) · classifyGoLanguageItems",
    nominalConfidence: 70,
    weight: 14,
    status: go01Status,
    lit: go01Pts.lit,
    points: go01Pts.points,
    read:
      go01Status === "hot"
        ? `GO-01 HOT — hard go-language (${goClassified.hardHits.length} hard / ${goClassified.softHits.length} soft). Soft wake; still need AER HOT + physical peer for High-go.${goQuote}`
        : go01Status === "warm"
          ? `GO-01 warm — soft strike/prep language (${goClassified.softHits.length}). Watch LLBG / AER; not a High-go peer alone.${goQuote}`
          : ironsight.online && ironsight.tgOk
            ? `No fresh Hebrew/Home Front go-language in IRONSIGHT+RSS auto sample (${ironsight.tgPosts.length} TG posts). Quiet on free feeds — not offline.`
            : ironsight.online
              ? "No go-language in RSS; IRONSIGHT TG sample empty this cycle — quiet/unknown on free feeds."
              : "No fresh Hebrew/Home Front go-language — IRONSIGHT offline; RSS only. Backup: N12/Walla.",
    evidence: goHitLines,
    links: [
      {
        label: "Google · Home Front / shelters",
        href: `https://news.google.com/search?q=${encodeURIComponent('"Home Front Command" OR shelters OR preemptive Israel')}&hl=en-US&gl=US&ceid=US:en`,
      },
      ...goHitLinks,
      linksCommon.fr24Llbg,
      linksCommon.ironsight,
    ],
    layer: "auto",
  };

  // —— CYBER-01 Iran blackout (soft elevated; not High-go) ——
  const blackoutArm = classifyIranBlackoutItems(blackoutItems, nowMs);
  const cyber01Status: IsraelStrikeTellStatus = blackoutArm.status;
  const cyber01Pts = tellPoints(
    cyber01Status === "unknown" ? "quiet" : cyber01Status,
    cyber01Status === "hot" ? 6 : 4,
  );
  const cyber01: IsraelStrikeTell = {
    id: "CYBER-01",
    category: "CYBER",
    label: "Iran internet blackout (news proxy)",
    lookFor:
      "Iran national internet cut / blackout headlines ≤24h — soft prelude, distinct from NOTAM radio_hole.",
    sourceHint: "Google News RSS · classifyIranBlackoutItems",
    nominalConfidence: 45,
    weight: 6,
    status: cyber01Status,
    lit: cyber01Pts.lit,
    points: cyber01Pts.points,
    read: blackoutArm.read,
    evidence: blackoutArm.evidence,
    links: [
      {
        label: "Google · Iran internet blackout",
        href: `https://news.google.com/search?q=${encodeURIComponent("Iran internet blackout OR shutdown")}&hl=en-US&gl=US&ceid=US:en`,
      },
      {
        label: "NetBlocks (manual)",
        href: "https://netblocks.org/",
      },
    ],
    layer: "auto",
  };

  // —— FIRMS-01 thermal soft wake ——
  const firmsArm = classifyFirmsSpike({
    hormuzCount: firmsCounts.hormuz,
    babCount: firmsCounts.bab,
    israelRegionCount: firmsCounts.israel,
  });
  const firms01Status: IsraelStrikeTellStatus = firmsArm.status;
  const firms01Pts = tellPoints(
    firms01Status === "unknown" ? "quiet" : firms01Status,
    firms01Status === "hot" ? 6 : 3,
  );
  const firms01: IsraelStrikeTell = {
    id: "FIRMS-01",
    category: "FIRMS",
    label: "FIRMS thermal soft wake",
    lookFor:
      "NASA FIRMS spike in Hormuz / Israel region — soft corroboration after kinetic; not a High-go gate.",
    sourceHint: "IRONSIGHT /api/fires · classifyFirmsSpike",
    nominalConfidence: 40,
    weight: 6,
    status: firms01Status,
    lit: firms01Pts.lit,
    points: firms01Status === "unknown" ? 0 : firms01Pts.points,
    read: firmsArm.read,
    evidence: firmsArm.evidence,
    links: [
      {
        label: "NASA FIRMS map",
        href: "https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@56.3,26.5,6z",
      },
      linksCommon.ironsight,
    ],
    layer: "auto",
  };

  // —— Strategic pressure soft layer (Mossad / Iran doctrine / IDF recovery / US–IL; MOU PAST) ——
  const stratCorpus: NewsItem[] = [
    ...stratItems,
    ...ironsight.news.map((n) => ({ title: n.title, link: "", pubDate: "" })),
    ...ironsight.tgPosts.map((p) => ({
      title: p.text.slice(0, 240),
      link: "",
      pubDate: p.date ?? "",
    })),
  ];
  const stratHits = classifyStrategicPressure(stratCorpus, nowMs);
  const byId = Object.fromEntries(stratHits.map((h) => [h.id, h]));

  function stratTell(
    id: IsraelStrikeTellId,
    category: IsraelStrikeTell["category"],
    label: string,
    lookFor: string,
    hitId: keyof typeof byId,
    googleQ: string,
  ): IsraelStrikeTell {
    const hit = byId[hitId]!;
    const status: IsraelStrikeTellStatus = hit.status;
    const pts = tellPoints(status, hit.weight);
    return {
      id,
      category,
      label,
      lookFor,
      sourceHint: "Google News + IRONSIGHT · classifyStrategicPressure — soft only",
      nominalConfidence: 55,
      weight: hit.weight,
      status,
      lit: pts.lit,
      points: pts.points,
      read: hit.read,
      evidence: hit.evidence,
      links: [
        {
          label: "Google search",
          href: `https://news.google.com/search?q=${encodeURIComponent(googleQ)}&hl=en-US&gl=US&ceid=US:en`,
        },
        { label: "N12", href: "https://www.n12.co.il/" },
        { label: "Walla", href: "https://news.walla.co.il/" },
        linksCommon.ironsight,
      ],
      layer: "auto",
    };
  }

  const pol02 = stratTell(
    "POL-02",
    "POL",
    "Mossad shakeup / failed Iran plan",
    "Mossad firings / failed regime-change or destabilization plan — Bibi political desperation overlay. Soft wake only.",
    "mossad_shakeup",
    "Mossad fired OR Iran Division OR regime change Iran",
  );
  const strat01 = stratTell(
    "STRAT-01",
    "STRAT",
    "Iran offensive doctrine",
    "IRGC/Naqdi 'offensive doctrine' / operations into enemy territory — soft risk-calculus shift, not High-go.",
    "iran_offensive",
    'Iran "offensive doctrine" OR Naqdi OR "enemy territory"',
  );
  const strat02 = stratTell(
    "STRAT-02",
    "STRAT",
    "IDF stunned / Iran recovery",
    "Israeli assessments that Iran rebuilt missiles/capability fast — strategic pressure soft wake.",
    "idf_recovery_stun",
    "IDF stunned OR shocked Iran recover OR rebuild missile",
  );
  const dip03 = stratTell(
    "DIP-03",
    "DIP",
    "US–IL intel gap / Israel alone",
    "US skeptical of Israeli intel, AF1/Trump threat path, or Israel-alone language — coordination soft watch.",
    "us_il_intel_gap",
    "Trump Secret Service Iran OR Israel act alone OR US skeptical Israel intel",
  );
  const pol03 = stratTell(
    "POL-03",
    "POL",
    "Hormuz MOU / Sunday deadline (PAST — DISABLED)",
    "PAST / DISABLED (Aug 2026) — Sunday MOU diplomacy window is over. Archive tell only; never scores or soft-wakes.",
    "mou_deadline_chatter",
    'Hormuz MOU OR "memorandum of understanding" deadline Iran',
  );

  const softArms: SoftElevatedArm[] = [blackoutArm, firmsArm];

  const tells: IsraelStrikeTell[] = [
    aer01,
    aer02,
    aer03,
    nav01,
    nav02,
    nav03,
    elec01,
    elec02,
    elec03,
    dip01,
    dip02,
    dip03,
    pol01,
    pol02,
    pol03,
    go01,
    exec01,
    pikud01,
    cyber01,
    firms01,
    strat01,
    strat02,
  ];

  let score = tells.reduce((n, t) => n + t.points, 0);
  // Confirmation boost: Shekel after AER/NAV already lit (post-go / panic print)
  if (shekelConfirmsLeaders) {
    score += exec01.status === "hot" ? 8 : 4;
  }
  score = Math.max(0, Math.min(100, score));

  // Scenario classification — High-go is physical/OSINT leading stack only.
  // Hard gate: AER-01 must be HOT (≥3 tankers). Warm (1–2 tankers; AWACS alone
  // does not warm) must never emit "High-confidence go (T-2–4h)" for paste consumers.
  // Peer: NAV-01 HOT, live AIS navy / manual navy count, or DIP/ELEC/AER-02 HOT.
  // ais_dark_suspected alone is soft watch — not a High-go peer.
  // GO-01 Hebrew go-language is NEVER a High-go peer alone (soft wake only).
  // EXEC-01 Shekel is NEVER required for High-go (lagging confirmation).
  // Ongoing war noise (routine DIP/PIKUD) must not alone print Medium.
  const navHardPeer =
    nav01.status === "hot" || aisNavyLit || manualCountLit;
  const highGoPeer =
    navHardPeer ||
    dip01.status === "hot" ||
    elec01.status === "hot" ||
    aer02.status === "hot";
  // GO-01 intentionally omitted from highGoPeer.
  const aer01Hot = aer01.status === "hot";

  let scenario: IsraelStrikeScenario = "quiet";
  if (!aerial.feedOk && !ironsight.online && shekel.price == null) {
    scenario = "unknown";
  } else if (pol01Lit && !physicalAutoLit) {
    scenario = "false_flag";
  } else if (aer01Hot && highGoPeer) {
    scenario = "high_confidence_go";
  } else if (
    elec01.lit &&
    !aer01.lit &&
    !aer02.lit &&
    !exec01.lit &&
    !dip01.lit &&
    !dip02.lit &&
    !nav01.lit
  ) {
    scenario = "silence_only";
  } else if (
    shekelAlone &&
    !aer01.lit &&
    !nav01.lit &&
    !dip01.lit &&
    !aer02.lit
  ) {
    // Lone FX spike = market panic / lagging print — medium watch, not High-go
    scenario = "medium_confidence";
  } else if (
    score >= 40 ||
    (aer01.lit && score >= 20) ||
    (exec01.lit && score >= 22) ||
    (aer02.lit && (dip01.lit || dip02.lit || pikud01.lit))
  ) {
    scenario = "medium_confidence";
  } else if (physicalProxyCount >= 1 && score >= 14) {
    scenario = "medium_confidence";
  } else {
    scenario = "quiet";
  }

  scenario = applyHighGoGates({
    scenario,
    aer01Hot,
    aerialTankerCount: aerial.tankerCount,
    score,
    aerialAwacsCount: aerial.awacsCount,
  });
  // POL feint wins over medium if no leading physical
  if (pol01Lit && !physicalAutoLit) {
    scenario = "false_flag";
    score = Math.min(score, 25);
  }

  const gaps = [
    "FR24 API / exact Hatzerim KC westward cluster (AER-01 full) — use FR24 LLBG deep link",
    cyprusAis.enabled
      ? cyprusAis.status === "live"
        ? "NAV-01 AISStream LIVE (auto navy-like) — warships often dark; posture mark optional backup"
        : `NAV-01 AISStream ${cyprusAis.status} (auto) — empty/stale ≠ quiet; deep links backup only`
      : "NAV-01: AISSTREAM_API_KEY unset — set key for auto Cyprus list; deep links + manual count are backup",
    "Mode-5 IFF ghost sweep (AER-03) — impossible on free ADS-B",
    "GPSJam (ELEC-02) and GreyNoise/Shodan (ELEC-03) — not wired",
    "Mil ADS-B often dark — blank Levant sky ≠ all-clear",
    "EXEC-01 Shekel often lags surprise kinetic (spikes ON/AFTER or when markets price it) — do not wait on FX for pre-launch; lead on AER-01 / NAV-01 / LLBG / Hebrew go language",
    "L1 Bataan SOG: IRONSIGHT /api/ships is static OSINT today (no kinematics) — sprint unknown until enrichment or manual mark",
  ];

  const nextTriggers: string[] = [];
  if (!aer01.lit) {
    nextTriggers.push(
      "AER-01: ≥3 tankers in Levant/Med/Israel adsb.lol (or FR24 Hatzerim KC / LLBG cluster manual) — primary pre-launch tell",
    );
  }
  if (!nav01.lit) {
    nextTriggers.push(
      cyprusAis.enabled && cyprusAis.status === "live"
        ? "NAV-01: AISStream auto watching navy-like — mark Loitering only if Sa'ar spotted AIS-dark (High-go peer)"
        : cyprusAis.enabled
          ? "NAV-01: AISStream armed — wait for navy-like or mark posture if eyeball confirms (High-go peer)"
          : "NAV-01: set AISSTREAM_API_KEY for auto navy-like (High-go peer); deep links backup",
    );
  }
  nextTriggers.push(
    go01.lit
      ? "GO-01 lit — corroborate LLBG / AER HOT; Hebrew go-language is soft wake, not High-go alone"
      : "Watch LLBG / Hebrew go-language OSINT (GO-01) — do not wait on Shekel for pre-launch",
  );
  if (blackoutArm.lit) {
    nextTriggers.push(
      "CYBER-01 Iran blackout chatter — soft elevated; confirm NetBlocks / TG, not a go gate",
    );
  }
  if (firmsArm.lit) {
    nextTriggers.push(
      "FIRMS-01 thermal soft wake — open NASA FIRMS map; not a High-go gate",
    );
  }
  const stratLit = [pol02, strat01, strat02, dip03].filter((t) => t.lit);
  if (stratLit.length > 0) {
    nextTriggers.push(
      `Strategic pressure soft (${stratLit.map((t) => t.id).join("/")}) — N12/Walla; not High-go alone`,
    );
  } else {
    nextTriggers.push(
      "Watch Mossad/Iran-doctrine/IDF-recovery soft layer (POL-02/STRAT/DIP-03) — judgment overlay; POL-03 MOU Sunday PAST/DISABLED",
    );
  }
  if (!exec01.lit) {
    nextTriggers.push(
      `EXEC-01 (lagging): USD/ILS ≥${SHEKEL_SPIKE_HARD} or ≥${SHEKEL_ROC_FLOOR}+${SHEKEL_ROC_PCT}% d/d — confirmation / market panic after AER/NAV, not a High-go gate`,
    );
  } else if (shekelAlone) {
    nextTriggers.push(
      "Shekel already spiked with quiet AER/NAV — treat as market panic; hunt AER-01 / NAV-01 / LLBG before calling go",
    );
  }
  nextTriggers.push("Confirm AER-02 NOTAM on Eurocontrol / FR24 if RSS warms");
  if (pol01Lit && !physicalAutoLit) {
    nextTriggers.push(
      "POL-01 feint active — wait for AER/NAV leading tells before treating as go (Shekel alone insufficient)",
    );
  }

  const oneLiner = (() => {
    switch (scenario) {
      case "high_confidence_go": {
        const incomplete =
          aerial.awacsCount === 0 || aerial.tankerCount < 3;
        if (incomplete) {
          return `Score ${score} · elevated physical stack but incomplete (tankers=${aerial.tankerCount} AWACS=${aerial.awacsCount}) — NOT full High-go for trade. Alert only; no auto-trade. Title ≠ signal; action = froGuidance.`;
        }
        return `Score ${score} · HIGH GO — AER-01 HOT (≥3 tankers) + hard peer. Shekel not required. Alert only; no auto-trade. Title ≠ signal; action = froGuidance.`;
      }
      case "medium_confidence":
        return shekelAlone
          ? `Score ${score} · elevated watch — NOT go. Shekel spike with quiet aerial/NAV = lagging market panic. Watch AER-01 HOT / NAV-01 / LLBG.`
          : aer01Hot
            ? `Score ${score} · elevated watch / pre-launch forming — NOT go (tankers=${aerial.tankerCount} AWACS=${aerial.awacsCount}). AER HOT without hard peer — await NAV HOT / DIP HOT / ELEC HOT / AER-02 / LLBG; Shekel lags.`
            : `Score ${score} · elevated watch / pre-launch forming — NOT go (tankers=${aerial.tankerCount} AWACS=${aerial.awacsCount}). Await AER-01 HOT (≥3) + hard peer; Shekel lags.`;
      case "false_flag":
        return `Score ${score} · POL cabinet leak alone — IGNORE / HOLD (feint).`;
      case "silence_only":
        return `Score ${score} · ELEC-01 silence only — MONITOR 2h.`;
      case "unknown":
        return `Score ${score} · feeds degraded — open deep links.`;
      default:
        return `Score ${score} · no Israel-strike pre-launch stack.`;
    }
  })();

  const levantMapOverlays = buildLevantMapOverlays({
    notamTitles: freshNotam.map((i) => i.title).slice(0, 8),
    notamStatus:
      aer02Status === "hot" || aer02Status === "warm" ? aer02Status : "quiet",
    aerialBoxesOk: aerial.boxesOk,
    aerialBoxesFailed: aerial.boxesFailed,
    // Live-only occupancy for zone titles — last-good/DARK pins are awareness,
    // not "N live" (that lied when sky was blank but sticky C17/E35L remained).
    aerialBoxTrackCounts: (() => {
      const counts: Record<string, number> = {
        "adsb-levant": 0,
        "adsb-med": 0,
        "adsb-israel": 0,
      };
      for (const t of aerial.tracks ?? []) {
        const pt = { lat: t.lat, lon: t.lon } as AdsbAc;
        if (inBbox(pt, ISRAEL_CORE_BBOX)) counts["adsb-israel"]! += 1;
        else if (inBbox(pt, MED_APPROACH_BBOX)) counts["adsb-med"]! += 1;
        else if (inBbox(pt, LEVANT_BBOX)) counts["adsb-levant"]! += 1;
      }
      return counts;
    })(),
    cyprusAis,
    dip01Status,
    dip01Evidence: dip01.evidence,
    nav01Status,
    firmsPoints: firmsCounts.points ?? [],
    firmsNote: firmsCounts.firmsNote ?? "FIRMS: no coords",
  });

  const archiveTs = new Date().toISOString();
  try {
    if (cyprusAis.vessels.length > 0) {
      archiveAisVessels({
        ts: cyprusAis.asOf ?? archiveTs,
        vessels: cyprusAis.vessels,
      });
    }
    if ((firmsCounts.points ?? []).length > 0) {
      archiveFirmsPoints({
        ts: archiveTs,
        points: firmsCounts.points ?? [],
      });
    }
    archiveMapZones({
      ts: archiveTs,
      zones: levantMapOverlays.zones.map((z) => ({
        zoneId: z.id,
        kind: z.kind,
        label: z.label,
        status: z.status,
        latMin: z.latMin,
        latMax: z.latMax,
        lonMin: z.lonMin,
        lonMax: z.lonMax,
        payload: { titles: z.titles },
      })),
    });
  } catch (err) {
    console.warn("[tradehole] levant overlay archive failed:", err);
  }

  const result: IsraelStrikeTells = {
    thesis:
      "Israel strike pre-launch tells (DeepSeek AER/NAV/ELEC/DIP/POL) mapped to free OSINT. Lead on AER-01 / NAV-01 / LLBG / Hebrew go language. EXEC-01 Shekel is a lagging confirmation (often ON/AFTER kinetic or market pricing) — High-go never requires FX; Shekel alone with quiet aerial/NAV = market panic print. NAV-01 uses optional AISStream Cyprus bbox + manual navy count/posture. POL cabinet leaks without AER/NAV are feints. Does not auto-trade.",
    oneLiner,
    asOf: new Date().toISOString(),
    score,
    scenario,
    statusLabel: statusLabel(scenario),
    froGuidance: froGuidance(scenario),
    autoTrade: false,
    physicalLit: [aer01, aer02, nav01].filter((t) => t.lit).length,
    diplomaticLit: [dip01, dip02, dip03].filter((t) => t.lit).length,
    electronicLit: [elec01].filter((t) => t.lit).length,
    politicalLit:
      (polLit ? 1 : 0) +
      (go01.lit ? 1 : 0) +
      [pol02, pol03, strat01, strat02].filter((t) => t.lit).length,
    executionLit: exec01.lit ? 1 : 0,
    tells,
    gaps,
    nextTriggers: nextTriggers.slice(0, 8),
    rulesSummary: [
      "High-confidence go: AER-01 HOT (≥3 tankers) AND ≥1 hard peer — NAV-01 HOT / live AIS navy / manual navy count / DIP-01 HOT / ELEC-01 HOT / AER-02 HOT. ais_dark_suspected alone and soft DIP warm never print High-go. AWACS=0 demotes the High-go title.",
      "DeepSeek 'E-6B+AWACS+tankers all together' is NOT the Tradehole High-go gate — E-6B is 5-Lock L2 (Hormuz/C2); Israel go remains AER≥3 + peer. Treat 'never all together' as a watch pattern only.",
      "0 Levant tankers ≠ all clear (EMCON/dark possible) AND ≠ High-go — quiet AER stays HOLD/elevated watch; do not upgrade on darkness alone.",
      "L2 E-6B with CONUS lat/lon = strategic C2 posture, not Levant tactical deployment — never sole Israel go.",
      "Pre-dawn Israel/Iran (~02–05 local) = heighten AER+peer attention; still need visible High-go gates.",
      "GO-01 Hebrew/Home Front go-language = soft wake only — never a sole High-go peer.",
      "East Africa / al-Shabaab Somali-basin watch is FRO/Cape freight overlay only — never an Israel High-go peer; one headline ≠ Cape-closed.",
      "CYBER-01 Iran blackout + FIRMS-01 thermal = soft elevated arms — not go gates.",
      "POL-02 Mossad shakeup · STRAT-01 Iran offensive · STRAT-02 IDF recovery stun · DIP-03 US–IL gap = soft political/intel pressure — never High-go alone. POL-03 Hormuz MOU / Sunday deadline is PAST and DISABLED.",
      "statusLabel / scenario title is NOT a trade signal — follow froGuidance (HOLD/watch; no auto-trade).",
      "EXEC-01 Shekel = lagging confirmation (weight for post-go / market panic). Often lags surprise kinetic; sometimes anticipatory — do not wait on Shekel for pre-launch.",
      "Shekel + quiet AER/NAV → market panic / lagging print (elevated watch — NOT go), not 'caught early'. Shekel after AER/NAV lit → confirmation score boost.",
      "Elevated watch (was medium): AER warm, soft DIP/ELEC, AER-02 + DIP/PIKUD, lone Shekel panic, or score ≥40 without full High-go gates.",
      "False flag: POL-01 cabinet leak + ZERO AER/NAV leading tells → IGNORE/HOLD (Shekel alone does not clear feint).",
      "Silence-only: ELEC-01 alone → MONITOR ~2h (weak).",
      "NAV-01: AISStream navy-like ≥1 (warm) / ≥2 (hot), or manual navy count ≥ threshold, or Loitering posture — High-go peer to AER-01 HOT.",
      "Never auto-trade — alert + FRO HOLD/watch guidance only.",
      "FR24 / Mode-5 / GPSJam = Layer-3 gaps (deep links). MarineTraffic is eyeball-only.",
    ],
    inputs: {
      shekelPrice: shekel.price,
      shekelChangePct: shekel.changePct,
      aerialTankersLevant: aerial.feedOk || aerial.fromCache ? aerial.tankerCount : null,
      aerialAwacsLevant: aerial.feedOk || aerial.fromCache ? aerial.awacsCount : null,
      aerialFeedOk: aerial.feedOk,
      aerialFeedStatus: aerial.feedStatus,
      aerialSampleAgeSec: aerial.ageSec,
      aerialSampledAt: aerial.sampledAt,
      aerialFromCache: aerial.fromCache,
      aerialSamples: aerial.samples,
      aerialTracks: aerial.tracks ?? [],
      aerialLastGoodTracks: aerial.lastGoodTracks ?? [],
      mapOverlays: levantMapOverlays,
      aerialOtherMil: aerial.feedOk || aerial.fromCache ? aerial.otherMilCount : null,
      aerialBoxesOk: aerial.boxesOk,
      aerialBoxesFailed: aerial.boxesFailed,
      aerialError: aerial.error ?? null,
      ironsightOnline: ironsight.online,
      intelAt: intel?.evaluatedAt ?? null,
      nav01Posture: manual.nav01.posture,
      nav01Note: manual.nav01.note,
      nav01UpdatedAt: manual.nav01.updatedAt,
      nav01NavyCount: manual.nav01.navyCount,
      nav01NavyThreshold: manual.nav01.navyThreshold,
      cyprusAis,
      softArms,
      goLanguageStatus: go01Status,
      goLanguageHits: goHitLines,
      aerialSessionPeak: (() => {
        hydrateAerialSessionPeakFromArchive();
        return aerialSessionPeak ? { ...aerialSessionPeak } : null;
      })(),
      aerialEvents: aerial.aerialEvents ?? [],
      aer01Churn: aerial.aer01Churn ?? null,
    },
    manual,
  };
  lastIsraelStrikeTells = result;
  lastIsraelStrikeTellsAt = Date.now();
  writeLastGood("israel-strike-tells", result, lastIsraelStrikeTellsAt);
  return result;
}
