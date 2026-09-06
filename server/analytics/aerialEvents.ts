/**
 * Minute-by-minute aerial asset lifecycle — state transitions for followed hexes.
 * Display-only; does not affect AER-01 High-go scoring.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AdsbAc } from "../adsbLol";
import {
  followRegionHint,
  looksLanded,
  normalizeHex,
} from "./aerialFollow";
import { isAerialTanker } from "./aerialClassify";
type AerialTrackKind = "tanker" | "awacs" | "mil";

type AerialTrack = {
  hex: string;
  callsign: string;
  kind: AerialTrackKind;
  acType: string;
  lat: number;
  lon: number;
  trackDeg: number | null;
  gsKt: number | null;
  altFt: number | null;
  bearingHint: string;
  inBox?: boolean;
  followed?: boolean;
  followRegion?: string;
};

type AerialLastGoodTrack = AerialTrack & {
  ageSec: number;
  lastSeenAt: string;
  stale: true;
};

export type AerialDisplayState = "live" | "dark" | "landed" | "followed";

export type AerialDarkReason = "descent_rtb" | "emcon_orbit" | "unknown";

export type AerialEvent = {
  id: string;
  at: string;
  hex: string;
  callsign: string;
  kind: AerialTrackKind;
  acType: string;
  from: AerialDisplayState | null;
  to: AerialDisplayState;
  /** Human detail — "@ LLBG", "descent RTB", "over Oklahoma". */
  detail: string;
  darkReason?: AerialDarkReason;
  lat?: number;
  lon?: number;
  ageSec?: number;
};

export type Aer01Churn = {
  summary: string;
  live: number;
  dark: number;
  landed: number;
  followed: number;
  prevLive: number | null;
  lastChangeAt: string | null;
};

type HexState = {
  state: AerialDisplayState;
  callsign: string;
  kind: AerialTrackKind;
  acType: string;
  detail: string;
  darkReason?: AerialDarkReason;
  lat?: number;
  lon?: number;
  updatedAt: string;
};

const MAX_EVENTS = 80;
const STORE_NAME = "aerial-events.json";
let eventSeq = 0;
let hexStates = new Map<string, HexState>();
let events: AerialEvent[] = [];
let lastAer01Live: number | null = null;
let lastAer01ChangeAt: string | null = null;
let hydrated = false;

const KNOWN_BASES: Array<{
  id: string;
  lat: number;
  lon: number;
  radiusDeg: number;
}> = [
  { id: "LLBG", lat: 32.01, lon: 34.89, radiusDeg: 0.12 },
  { id: "Hatzerim", lat: 31.23, lon: 34.66, radiusDeg: 0.08 },
  { id: "Nevatim", lat: 31.21, lon: 35.0, radiusDeg: 0.08 },
  { id: "Akrotiri", lat: 34.59, lon: 32.99, radiusDeg: 0.06 },
  { id: "Larnaca", lat: 34.87, lon: 33.62, radiusDeg: 0.06 },
];

function dataDir(): string {
  if (process.env.TRADEHOLE_DATA_DIR) return process.env.TRADEHOLE_DATA_DIR;
  return path.join(os.homedir(), "Library", "Application Support", "Tradehole");
}

function storePath(): string {
  return path.join(dataDir(), STORE_NAME);
}

function persist(): void {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(
      storePath(),
      JSON.stringify(
        {
          at: Date.now(),
          eventSeq,
          events,
          hexStates: [...hexStates.entries()],
          lastAer01Live,
          lastAer01ChangeAt,
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch (err) {
    console.warn("[tradehole] aerial events persist failed:", err);
  }
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const json = JSON.parse(fs.readFileSync(storePath(), "utf8")) as {
      eventSeq?: number;
      events?: AerialEvent[];
      hexStates?: Array<[string, HexState]>;
      lastAer01Live?: number | null;
      lastAer01ChangeAt?: string | null;
    };
    eventSeq = Number(json.eventSeq) || 0;
    events = json.events ?? [];
    hexStates = new Map(json.hexStates ?? []);
    lastAer01Live = json.lastAer01Live ?? null;
    lastAer01ChangeAt = json.lastAer01ChangeAt ?? null;
  } catch {
    /* missing */
  }
}

export function getRecentAerialEvents(limit = 24): AerialEvent[] {
  hydrate();
  return events.slice(0, limit);
}

function nearestBase(
  lat: number,
  lon: number,
): { id: string; distDeg: number } | null {
  let best: { id: string; distDeg: number } | null = null;
  for (const b of KNOWN_BASES) {
    const d = Math.hypot(lat - b.lat, lon - b.lon);
    if (d <= b.radiusDeg && (!best || d < best.distDeg)) {
      best = { id: b.id, distDeg: d };
    }
  }
  return best;
}

export function classifyDarkReason(args: {
  altFt: number | null;
  gsKt: number | null;
  trackDeg: number | null;
  bearingHint?: string | null;
}): AerialDarkReason {
  const alt = args.altFt;
  const gs = args.gsKt;
  if (alt != null && alt < 12_000) {
    if (gs != null && gs < 280) return "descent_rtb";
    if (args.bearingHint === "westbound" || args.bearingHint === "southbound") {
      return "descent_rtb";
    }
  }
  if (alt != null && alt >= 18_000) return "emcon_orbit";
  if (args.bearingHint === "orbit/unknown" && alt != null && alt >= 15_000) {
    return "emcon_orbit";
  }
  return "unknown";
}

function darkReasonLabel(r: AerialDarkReason): string {
  if (r === "descent_rtb") return "descent RTB";
  if (r === "emcon_orbit") return "mid-orbit EMCON";
  return "no ping";
}

function locationDetail(lat: number, lon: number): string {
  const base = nearestBase(lat, lon);
  if (base) return `@ ${base.id}`;
  return `over ${followRegionHint(lat, lon)}`;
}

function landedDetail(a: AdsbAc): string {
  const lat = a.lat!;
  const lon = a.lon!;
  const base = nearestBase(lat, lon);
  if (base) return `@ ${base.id}`;
  if (looksLanded(a)) return "@ ground";
  return locationDetail(lat, lon);
}

function pushEvent(ev: Omit<AerialEvent, "id">): void {
  hydrate();
  eventSeq += 1;
  events.unshift({ ...ev, id: `ae-${eventSeq}` });
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
}

function displayStateOfTrack(t: AerialTrack): AerialDisplayState {
  if (t.followed) return "followed";
  return "live";
}

function enrichTrack(
  t: AerialTrack,
  state: AerialDisplayState,
  extra?: { darkReason?: AerialDarkReason; detail?: string; ageSec?: number },
): AerialTrack & {
  displayState: AerialDisplayState;
  darkReason?: AerialDarkReason;
  stateDetail?: string;
  ageSec?: number;
} {
  return {
    ...t,
    displayState: state,
    darkReason: extra?.darkReason,
    stateDetail: extra?.detail ?? locationDetail(t.lat, t.lon),
    ageSec: extra?.ageSec,
  };
}

function enrichLastGood(t: AerialLastGoodTrack): AerialLastGoodTrack & {
  displayState: "dark";
  darkReason: AerialDarkReason;
  stateDetail: string;
} {
  const darkReason = classifyDarkReason({
    altFt: t.altFt,
    gsKt: t.gsKt,
    trackDeg: t.trackDeg,
    bearingHint: t.bearingHint,
  });
  return {
    ...t,
    displayState: "dark",
    darkReason,
    stateDetail: `${darkReasonLabel(darkReason)} · ${locationDetail(t.lat, t.lon)}`,
  };
}

function formatMinute(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function formatAerialEventLine(ev: AerialEvent): string {
  const cs = ev.callsign?.trim() || ev.hex;
  const kind = ev.kind === "mil" ? ev.acType || "mil" : ev.kind;
  const from = ev.from ? ev.from.toUpperCase() : "NEW";
  const to = ev.to.toUpperCase();
  const detail = ev.detail ? ` · ${ev.detail}` : "";
  const age =
    ev.ageSec != null && ev.to === "dark"
      ? ` · dark ${ev.ageSec >= 60 ? `${Math.round(ev.ageSec / 60)}m` : `${ev.ageSec}s`}`
      : "";
  return `${ev.hex} · ${kind} · ${from} → ${to}${detail}${age} · ${formatMinute(ev.at)}`;
}

function noteTransition(args: {
  hex: string;
  callsign: string;
  kind: AerialTrackKind;
  acType: string;
  from: AerialDisplayState | null;
  to: AerialDisplayState;
  detail: string;
  at: string;
  darkReason?: AerialDarkReason;
  lat?: number;
  lon?: number;
  ageSec?: number;
}): void {
  if (args.from === args.to) return;
  pushEvent({
    at: args.at,
    hex: args.hex,
    callsign: args.callsign,
    kind: args.kind,
    acType: args.acType,
    from: args.from,
    to: args.to,
    detail: args.detail,
    darkReason: args.darkReason,
    lat: args.lat,
    lon: args.lon,
    ageSec: args.ageSec,
  });
  hexStates.set(args.hex, {
    state: args.to,
    callsign: args.callsign,
    kind: args.kind,
    acType: args.acType,
    detail: args.detail,
    darkReason: args.darkReason,
    lat: args.lat,
    lon: args.lon,
    updatedAt: args.at,
  });
}

function tankerLandedCount(landedByHex: Map<string, AdsbAc>): number {
  let n = 0;
  for (const a of landedByHex.values()) {
    const cs = (a.flight ?? "").trim();
    if (isAerialTanker(a.t ?? "", a.desc ?? "", cs)) n += 1;
  }
  return n;
}
function countAer01Tankers(
  live: Array<AerialTrack & { displayState?: AerialDisplayState }>,
  dark: Array<AerialLastGoodTrack & { displayState?: AerialDisplayState }>,
  landedByHex: Map<string, AdsbAc>,
  kindFilter: (k: AerialTrackKind) => boolean,
): { live: number; dark: number; landed: number; followed: number } {
  let liveN = 0;
  let darkN = 0;
  let followedN = 0;
  for (const t of live) {
    if (!kindFilter(t.kind)) continue;
    if (t.followed) followedN += 1;
    else if (t.inBox !== false) liveN += 1;
  }
  for (const t of dark) {
    if (!kindFilter(t.kind)) continue;
    if (landedByHex.has(t.hex)) continue;
    if (t.inBox) darkN += 1;
    else if (t.followed) followedN += 1;
  }
  const landedN = tankerLandedCount(landedByHex);
  return { live: liveN, dark: darkN, landed: landedN, followed: followedN };
}

function buildChurnSummary(args: {
  live: number;
  dark: number;
  landed: number;
  followed: number;
  prevLive: number | null;
  lastChangeAt: string | null;
  now: string;
}): string {
  const parts: string[] = [];
  if (args.live > 0) parts.push(`${args.live} LIVE`);
  if (args.landed > 0) parts.push(`${args.landed} LANDED`);
  if (args.dark > 0) {
    const ageBit = args.lastChangeAt
      ? ` (${formatRelativeAge(args.lastChangeAt, args.now)})`
      : "";
    parts.push(`${args.dark} DARK${ageBit}`);
  }
  if (args.followed > 0) parts.push(`${args.followed} FOLLOWED`);
  const body = parts.length ? parts.join(" + ") : "0 tracked";
  if (args.prevLive != null && args.prevLive !== args.live) {
    return `${args.prevLive} LIVE → ${body}`;
  }
  return body;
}

function formatRelativeAge(fromIso: string, nowIso: string): string {
  const ms = Math.max(0, Date.parse(nowIso) - Date.parse(fromIso));
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.round(min / 60)}h ago`;
}

export type AerialLifecycleResult = {
  tracks: Array<
    AerialTrack & {
      displayState: AerialDisplayState;
      darkReason?: AerialDarkReason;
      stateDetail?: string;
    }
  >;
  lastGoodTracks: Array<
    AerialLastGoodTrack & {
      displayState: "dark";
      darkReason: AerialDarkReason;
      stateDetail: string;
    }
  >;
  events: AerialEvent[];
  aer01Churn: Aer01Churn;
};

/** Detect transitions and enrich tracks for the desk UI. */
export function applyAerialLifecycle(args: {
  tracks: AerialTrack[];
  lastGoodTracks: AerialLastGoodTrack[];
  landed: AdsbAc[];
  nowIso: string;
}): AerialLifecycleResult {
  hydrate();
  const nowIso = args.nowIso;
  const landedHexes = new Set<string>();
  const landedByHex = new Map<string, AdsbAc>();

  for (const a of args.landed) {
    const hex = normalizeHex(a.hex);
    if (!hex) continue;
    landedHexes.add(hex);
    landedByHex.set(hex, a);
  }

  const currentHexes = new Set<string>();
  const enrichedLive = args.tracks.map((t) => {
    currentHexes.add(t.hex);
    const state = displayStateOfTrack(t);
    const prev = hexStates.get(t.hex);
    if (!prev || prev.state !== state) {
      noteTransition({
        hex: t.hex,
        callsign: t.callsign,
        kind: t.kind,
        acType: t.acType,
        from: prev?.state ?? null,
        to: state,
        detail: locationDetail(t.lat, t.lon),
        at: nowIso,
        lat: t.lat,
        lon: t.lon,
      });
    } else {
      hexStates.set(t.hex, {
        ...prev,
        lat: t.lat,
        lon: t.lon,
        detail: locationDetail(t.lat, t.lon),
        updatedAt: nowIso,
      });
    }
    return enrichTrack(t, state, { detail: locationDetail(t.lat, t.lon) });
  });

  const enrichedDark = args.lastGoodTracks
    .filter((t) => !landedHexes.has(t.hex))
    .map((t) => {
    currentHexes.add(t.hex);
    const dark = enrichLastGood(t);
    const prev = hexStates.get(t.hex);
    if (!prev || prev.state !== "dark") {
      noteTransition({
        hex: t.hex,
        callsign: t.callsign,
        kind: t.kind,
        acType: t.acType,
        from: prev?.state ?? null,
        to: "dark",
        detail: dark.stateDetail,
        darkReason: dark.darkReason,
        at: nowIso,
        lat: t.lat,
        lon: t.lon,
        ageSec: t.ageSec,
      });
    } else {
      hexStates.set(t.hex, {
        state: "dark",
        callsign: t.callsign,
        kind: t.kind,
        acType: t.acType,
        detail: dark.stateDetail,
        darkReason: dark.darkReason,
        lat: t.lat,
        lon: t.lon,
        updatedAt: nowIso,
      });
    }
    return dark;
  });

  for (const [hex, a] of landedByHex) {
    const prev = hexStates.get(hex);
    const cs = (a.flight ?? "").trim() || prev?.callsign || hex;
    const acType = a.t || prev?.acType || "?";
    const kind: AerialTrackKind =
      prev?.kind ??
      (/(KC|BOOM|TANK)/i.test(cs)
        ? "tanker"
        : /(E3|AWACS|SENTRY)/i.test(cs)
          ? "awacs"
          : "mil");
    const detail = landedDetail(a);
    noteTransition({
      hex,
      callsign: cs,
      kind,
      acType,
      from: prev?.state ?? null,
      to: "landed",
      detail,
      at: nowIso,
      lat: a.lat ?? undefined,
      lon: a.lon ?? undefined,
    });
  }

  // Re-live: hex was dark/landed and is live again
  for (const t of enrichedLive) {
    const prev = hexStates.get(t.hex);
    if (prev && (prev.state === "dark" || prev.state === "landed") && t.displayState === "live") {
      /* already noted in live loop if from differed */
    }
  }

  const tankerCounts = countAer01Tankers(
    enrichedLive,
    enrichedDark,
    landedByHex,
    (k) => k === "tanker",
  );
  const scoredLive = tankerCounts.live;
  const prevLiveBefore = lastAer01Live;
  let changedNow = false;
  if (prevLiveBefore == null || scoredLive !== prevLiveBefore) {
    if (prevLiveBefore != null && scoredLive !== prevLiveBefore) {
      lastAer01ChangeAt = nowIso;
      changedNow = true;
    }
    lastAer01Live = scoredLive;
  }

  const aer01Churn: Aer01Churn = {
    live: tankerCounts.live,
    dark: tankerCounts.dark,
    landed: tankerCounts.landed,
    followed: tankerCounts.followed,
    prevLive: changedNow ? prevLiveBefore : null,
    lastChangeAt: lastAer01ChangeAt,
    summary: buildChurnSummary({
      live: tankerCounts.live,
      dark: tankerCounts.dark,
      landed: tankerCounts.landed,
      followed: tankerCounts.followed,
      prevLive: changedNow ? prevLiveBefore : null,
      lastChangeAt: lastAer01ChangeAt,
      now: nowIso,
    }),
  };

  persist();
  return {
    tracks: enrichedLive,
    lastGoodTracks: enrichedDark,
    events: getRecentAerialEvents(24),
    aer01Churn,
  };
}

/** Test helper */
export function resetAerialEventsForTests(): void {
  eventSeq = 0;
  hexStates.clear();
  events = [];
  lastAer01Live = null;
  lastAer01ChangeAt = null;
  hydrated = true;
}
