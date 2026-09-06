import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  Rectangle,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import type { LatLngBoundsExpression, LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  fetchIsraelStrikeTells,
  fetchKineticRewind,
  fetchOsintArchivePeaks,
  fetchOsintArchiveRange,
  fetchOsintArchiveStatus,
  fetchTheaterWatch,
} from "../services/api";
import { formatAerialAssetLine, formatAerialAssetShort } from "../lib/aerialFormat";
import { copyText } from "../lib/clipboard";
import { copyLiveMapAssets } from "../lib/copyMapAssets";
import { useDashboardStore } from "../store/dashboard";
import type {
  IsraelStrikeTells,
  KineticRewindReport,
  OsintArchivePeak,
  OsintArchiveSample,
  OsintArchiveStatus,
  TheaterWatch,
} from "../types";

type AerialTrack = NonNullable<
  IsraelStrikeTells["inputs"]["aerialTracks"]
>[number];
type AerialLastGoodTrack = NonNullable<
  IsraelStrikeTells["inputs"]["aerialLastGoodTracks"]
>[number];
type MapOverlays = NonNullable<IsraelStrikeTells["inputs"]["mapOverlays"]>;
type MapZone = MapOverlays["zones"][number];
type MapPoint = MapOverlays["points"][number];
type FirmsPoint = NonNullable<MapOverlays["firmsPoints"]>[number];

type LayerKey =
  | "aerial"
  | "notam"
  | "adsb"
  | "ais"
  | "dipNav"
  | "landmarks"
  | "theater"
  | "firms"
  | "kinetic";

type FitMode = "levant" | "gulf" | "theater" | "all" | "followed";

/** Sidebar / feature grouping across the wide theater viewport. */
type MapRegion = "levant" | "red_sea_horn" | "iraq_bridge" | "gulf" | "wider";

type TheaterStamp = {
  id: string;
  label: string;
  kind: "arg" | "arg_manual" | "e6b" | "gulf_adsb" | "ssgn" | "csg" | "naval";
  lat: number;
  lon: number;
  meta?: string;
  manual?: boolean;
  courseDeg?: number | null;
  sogKt?: number | null;
  region?: MapRegion;
  /** Dropped from live feed — last-known pin. */
  stale?: boolean;
  ageSec?: number;
  lastSeenAt?: string;
};

type TheaterZone = {
  id: string;
  kind: "notam" | "adsb_box" | "nav_watch" | "ais_box";
  label: string;
  status: "quiet" | "warm" | "hot" | "unknown" | "info" | "failed";
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  titles?: string[];
};

type FeatureRow = {
  id: string;
  layer: LayerKey;
  region: MapRegion;
  title: string;
  subtitle: string;
  lat: number;
  lon: number;
  color: string;
  zoom?: number;
};

/** Fallback ADS-B watch tiles if theater API omits mapOverlays (empty ≠ not watching). */
const FALLBACK_THEATER_ADSB: TheaterZone[] = [
  {
    id: "adsb-gulf",
    kind: "adsb_box",
    label: "ADS-B Gulf / Hormuz · watching · deferred",
    status: "unknown",
    latMin: 23.0,
    latMax: 31.0,
    lonMin: 47.5,
    lonMax: 61.5,
  },
  {
    id: "adsb-iraq",
    kind: "adsb_box",
    label: "ADS-B Iraq / Mesopotamia · watching · deferred",
    status: "unknown",
    latMin: 29.0,
    latMax: 37.5,
    lonMin: 38.5,
    lonMax: 49.5,
  },
  {
    id: "adsb-syria-jazira",
    kind: "adsb_box",
    label: "ADS-B Syria / Jazira bridge · watching · deferred",
    status: "unknown",
    latMin: 32.5,
    latMax: 37.5,
    lonMin: 35.5,
    lonMax: 43.0,
  },
  {
    id: "adsb-saudi",
    kind: "adsb_box",
    label: "ADS-B Saudi / Peninsula · watching · deferred",
    status: "unknown",
    latMin: 16.0,
    latMax: 32.0,
    lonMin: 34.5,
    lonMax: 55.5,
  },
  {
    id: "adsb-iran",
    kind: "adsb_box",
    label: "ADS-B Iran plateau · watching · deferred",
    status: "unknown",
    latMin: 25.0,
    latMax: 39.5,
    lonMin: 44.0,
    lonMax: 63.5,
  },
  {
    id: "adsb-redsea",
    kind: "adsb_box",
    label: "ADS-B Red Sea / Suez · watching · deferred",
    status: "unknown",
    latMin: 12.0,
    latMax: 30.5,
    lonMin: 32.0,
    lonMax: 44.0,
  },
  {
    id: "adsb-bab",
    kind: "adsb_box",
    label: "ADS-B Bab el-Mandeb / Aden · watching · deferred",
    status: "unknown",
    latMin: 10.0,
    latMax: 18.5,
    lonMin: 41.0,
    lonMax: 52.0,
  },
  {
    id: "adsb-somali",
    kind: "adsb_box",
    label: "ADS-B Somali basin / E. Africa · watching · deferred",
    status: "unknown",
    latMin: -2.0,
    latMax: 12.0,
    lonMin: 42.0,
    lonMax: 55.0,
  },
  {
    id: "adsb-arabian",
    kind: "adsb_box",
    label: "ADS-B Arabian Sea / NW IO · watching · deferred",
    status: "unknown",
    latMin: 10.0,
    latMax: 26.0,
    lonMin: 55.0,
    lonMax: 72.0,
  },
];

const THEATER_POLL_MS = 60_000;

/** Reference landmarks across the screenshot-scale theater (known places — not RSS invents). */
const LANDMARKS: Array<{
  label: string;
  lon: number;
  lat: number;
  region: MapRegion;
  soft?: boolean;
}> = [
  // Levant
  { label: "Cyprus", lon: 33.0, lat: 35.0, region: "levant" },
  { label: "LLBG", lon: 34.89, lat: 32.01, region: "levant" },
  { label: "Hatzerim", lon: 34.66, lat: 31.23, region: "levant" },
  { label: "Haifa", lon: 35.0, lat: 32.82, region: "levant" },
  { label: "Beirut", lon: 35.5, lat: 33.9, region: "levant" },
  { label: "Cairo", lon: 31.24, lat: 30.04, region: "levant" },
  { label: "Aqaba", lon: 35.0, lat: 29.53, region: "levant", soft: true },
  { label: "Eilat", lon: 34.95, lat: 29.56, region: "levant", soft: true },
  // Iraq / Syria bridge (soft context — not go-gates)
  { label: "Baghdad", lon: 44.37, lat: 33.31, region: "iraq_bridge", soft: true },
  { label: "Basra", lon: 47.78, lat: 30.51, region: "iraq_bridge", soft: true },
  { label: "Erbil", lon: 44.01, lat: 36.19, region: "iraq_bridge", soft: true },
  { label: "Damascus", lon: 36.28, lat: 33.51, region: "iraq_bridge", soft: true },
  { label: "Aleppo", lon: 37.16, lat: 36.2, region: "iraq_bridge", soft: true },
  // Red Sea / Horn
  { label: "Suez", lon: 32.55, lat: 29.97, region: "red_sea_horn" },
  { label: "Jeddah", lon: 39.17, lat: 21.49, region: "red_sea_horn", soft: true },
  { label: "Port Sudan", lon: 37.22, lat: 19.62, region: "red_sea_horn", soft: true },
  { label: "Hodeidah", lon: 42.95, lat: 14.8, region: "red_sea_horn", soft: true },
  { label: "Bab el-Mandeb", lon: 43.35, lat: 12.58, region: "red_sea_horn" },
  { label: "Aden", lon: 45.03, lat: 12.79, region: "red_sea_horn" },
  { label: "Mukalla", lon: 49.12, lat: 14.54, region: "red_sea_horn", soft: true },
  { label: "Djibouti", lon: 43.15, lat: 11.57, region: "red_sea_horn" },
  {
    label: "Bosaso",
    lon: 49.18,
    lat: 11.28,
    region: "red_sea_horn",
    soft: true,
  },
  {
    label: "E. Africa Cape watch",
    lon: 47.5,
    lat: 2.0,
    region: "red_sea_horn",
    soft: true,
  },
  // Gulf / Hormuz
  { label: "Hormuz", lon: 56.25, lat: 26.56, region: "gulf" },
  { label: "Kharg", lon: 50.32, lat: 29.24, region: "gulf" },
  { label: "Bushehr", lon: 50.84, lat: 28.97, region: "gulf", soft: true },
  { label: "Assaluyeh", lon: 52.61, lat: 27.48, region: "gulf", soft: true },
  { label: "Bandar Abbas", lon: 56.27, lat: 27.18, region: "gulf" },
  { label: "Jask", lon: 57.77, lat: 25.64, region: "gulf", soft: true },
  { label: "Kuwait City", lon: 47.98, lat: 29.38, region: "gulf", soft: true },
  { label: "Bahrain", lon: 50.58, lat: 26.23, region: "gulf" },
  { label: "Doha", lon: 51.53, lat: 25.29, region: "gulf", soft: true },
  { label: "Abu Dhabi", lon: 54.37, lat: 24.45, region: "gulf", soft: true },
  { label: "Dubai", lon: 55.27, lat: 25.2, region: "gulf", soft: true },
  { label: "Fujairah", lon: 56.33, lat: 25.13, region: "gulf" },
  { label: "Muscat", lon: 58.54, lat: 23.59, region: "gulf" },
  { label: "Duqm", lon: 57.6, lat: 19.65, region: "gulf", soft: true },
  { label: "Salalah", lon: 54.09, lat: 17.02, region: "gulf" },
  /** Soft context only — not go-gates. */
  {
    label: "Natanz",
    lon: 51.726,
    lat: 33.725,
    region: "gulf",
    soft: true,
  },
  {
    label: "Fordow",
    lon: 50.996,
    lat: 34.886,
    region: "gulf",
    soft: true,
  },
  // Wider (Iran plateau / Arabian Sea / fringe)
  { label: "Tehran", lon: 51.39, lat: 35.69, region: "wider", soft: true },
  { label: "Isfahan", lon: 51.67, lat: 32.65, region: "wider", soft: true },
  { label: "Shiraz", lon: 52.53, lat: 29.61, region: "wider", soft: true },
  { label: "Riyadh", lon: 46.72, lat: 24.69, region: "wider", soft: true },
  {
    label: "Chabahar",
    lon: 60.63,
    lat: 25.3,
    region: "wider",
  },
  {
    label: "Karachi approaches",
    lon: 66.98,
    lat: 24.86,
    region: "wider",
    soft: true,
  },
];

const COLORS = {
  tanker: "#c4a35a",
  awacs: "#7ec8e3",
  mil: "#e06b5c",
  ais: "#7eb0e0",
  aisTanker: "#c4a35a",
  aisOther: "#8fa396",
  arg: "#e8b84a",
  argManual: "#f0c86a",
  e6b: "#7ec8e3",
  gulf: "#3dba7a",
  ssgn: "#d4a017",
  csg: "#e08a5c",
  naval: "#b8a06a",
  firms: "#e07040",
  landmark: "#cfd8d1",
  landmarkSoft: "#a8b5ae",
  kinetic: "#e07050",
  kineticHit: "#c4a35a",
  notam: "#c4a35a",
  adsbBox: "#3dba7a",
  cyprusAis: "#5ab4c8",
  dip: "#e06b5c",
  nav: "#78aadc",
  lastGood: "#9a8b6a",
  followed: "#d4c48a",
} as const;

/** Wide theater (Africa–India screenshot scale) — default map open view. */
const THEATER_CENTER: LatLngExpression = [20.0, 45.0];
const DEFAULT_ZOOM = 4;
const LEVANT_BOUNDS: LatLngBoundsExpression = [
  [29.2, 28.5],
  [36.0, 37.2],
];
/** Iran / Persian Gulf / Hormuz frame. */
const GULF_BOUNDS: LatLngBoundsExpression = [
  [22.5, 47.0],
  [35.5, 62.0],
];
/**
 * Screenshot-scale theater: ~10°E–80°E · ~5°S–45°N
 * (Med / Levant / Red Sea / Horn / Arabia / Gulf / Arabian Sea).
 */
const THEATER_BOUNDS: LatLngBoundsExpression = [
  [-5.0, 10.0],
  [45.0, 80.0],
];

const REGION_LABELS: Record<MapRegion, string> = {
  levant: "Levant",
  red_sea_horn: "Red Sea / Horn",
  iraq_bridge: "Iraq / Levant–Gulf",
  gulf: "Gulf / Hormuz",
  wider: "Wider",
};

type FitRequest = {
  mode: FitMode;
  nonce: number;
  /** Snapshot for mode === "all" (avoids re-fit on every bounds recompute). */
  bounds?: LatLngBoundsExpression | null;
};

const ZONE_COLORS: Record<
  MapZone["kind"] | TheaterZone["kind"],
  { stroke: string; fill: string }
> = {
  notam: { stroke: COLORS.notam, fill: "rgba(196, 163, 90, 0.28)" },
  adsb_box: { stroke: COLORS.adsbBox, fill: "rgba(61, 186, 122, 0.12)" },
  cyprus_ais: {
    stroke: COLORS.cyprusAis,
    fill: "rgba(90, 180, 200, 0.18)",
  },
  dip_border: { stroke: COLORS.dip, fill: "rgba(224, 107, 92, 0.14)" },
  nav_watch: { stroke: COLORS.nav, fill: "rgba(120, 170, 220, 0.16)" },
  ais_box: {
    stroke: COLORS.cyprusAis,
    fill: "rgba(90, 180, 200, 0.18)",
  },
};

const STATUS_WEIGHT: Record<
  MapZone["status"] | TheaterZone["status"],
  number
> = {
  hot: 4,
  warm: 3.2,
  quiet: 2.4,
  info: 2.2,
  unknown: 2.2,
  failed: 2.8,
};

const LAYER_LABELS: Array<[LayerKey, string]> = [
  ["aerial", "ADS-B tracks"],
  ["notam", "NOTAM / AER-02 zones"],
  ["adsb", "ADS-B sample boxes"],
  ["ais", "AIS (Cyprus / Hormuz / Bab)"],
  ["dipNav", "DIP / NAV / AIS box"],
  ["landmarks", "Landmarks"],
  ["theater", "Gulf / ARG / E-6B / SSGN"],
  ["firms", "FIRMS thermal"],
  ["kinetic", "Kinetic targets"],
];

const ALL_LAYERS_ON: Record<LayerKey, boolean> = {
  aerial: true,
  notam: true,
  adsb: true,
  ais: true,
  dipNav: true,
  landmarks: true,
  theater: true,
  firms: true,
  kinetic: true,
};

/** Lon heuristic for Gulf cluster detection. */
const GULF_LON_SPLIT = 47;

const MANUAL_ARG_LS = [
  {
    key: "bataan",
    label: "USS Bataan (manual)",
    lat: "tradehole.intel.bataanLat",
    lon: "tradehole.intel.bataanLon",
    course: "tradehole.intel.bataanCourse",
    sog: "tradehole.intel.bataanSog",
  },
  {
    key: "boxer",
    label: "USS Boxer (manual)",
    lat: "tradehole.intel.boxerLat",
    lon: "tradehole.intel.boxerLon",
    course: "tradehole.intel.boxerCourse",
    sog: "tradehole.intel.boxerSog",
  },
  {
    key: "newYork",
    label: "USS New York (manual)",
    lat: "tradehole.intel.newYorkLat",
    lon: "tradehole.intel.newYorkLon",
    course: "tradehole.intel.newYorkCourse",
    sog: "tradehole.intel.newYorkSog",
  },
] as const;

function readLsNum(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null || !raw.trim()) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function collectManualArgPins(): TheaterStamp[] {
  const out: TheaterStamp[] = [];
  for (const h of MANUAL_ARG_LS) {
    const lat = readLsNum(h.lat);
    const lon = readLsNum(h.lon);
    if (lat == null || lon == null) continue;
    if (lat === 0 && lon === 0) continue;
    const course = readLsNum(h.course);
    const sog = readLsNum(h.sog);
    const bits = [
      "MANUAL",
      sog != null ? `${sog} kt` : null,
      course != null ? `crs ${Math.round(course)}°` : null,
    ].filter(Boolean);
    out.push({
      id: `manual-arg-${h.key}`,
      label: h.label,
      kind: "arg_manual",
      lat,
      lon,
      manual: true,
      courseDeg: course,
      sogKt: sog,
      meta: bits.join(" · "),
    });
  }
  return out;
}

type Props = {
  onRefreshAerial?: () => void;
  /** App header can call the same full-board copy. */
  onRegisterCopyHandler?: (fn: (() => void) | null) => void;
};

function MapResizeFix() {
  const map = useMap();
  useEffect(() => {
    const t = window.setTimeout(() => map.invalidateSize(), 80);
    return () => window.clearTimeout(t);
  }, [map]);
  return null;
}

function FitControl({ fit }: { fit: FitRequest | null }) {
  const map = useMap();
  // Intentionally depend only on fit (nonce/mode), not live feature bounds.
  // allBounds was recomputed every render (new visibleZones array), which
  // re-ran fitBounds(LEVANT_*) continuously and undid Iran/Gulf + flyTo.
  useEffect(() => {
    if (!fit) return;
    if (fit.mode === "levant") {
      map.fitBounds(LEVANT_BOUNDS, { padding: [28, 28], maxZoom: 8 });
    } else if (fit.mode === "gulf") {
      map.fitBounds(GULF_BOUNDS, { padding: [24, 24], maxZoom: 7 });
    } else if (fit.mode === "theater") {
      map.fitBounds(THEATER_BOUNDS, { padding: [20, 20], maxZoom: 5 });
    } else if (fit.mode === "followed" && fit.bounds) {
      map.fitBounds(fit.bounds, { padding: [36, 36], maxZoom: 7 });
    } else if (fit.bounds) {
      map.fitBounds(fit.bounds, { padding: [36, 36], maxZoom: 8 });
    } else {
      map.fitBounds(THEATER_BOUNDS, { padding: [20, 20], maxZoom: 5 });
    }
  }, [map, fit]);
  return null;
}

function FocusControl({
  focus,
}: {
  focus: { lat: number; lon: number; zoom: number; nonce: number } | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (!focus) return;
    map.flyTo([focus.lat, focus.lon], focus.zoom, { duration: 0.55 });
  }, [map, focus]);
  return null;
}

function headingLine(
  lat: number,
  lon: number,
  trackDeg: number | null,
  nm = 0.55,
): LatLngExpression[] | null {
  if (trackDeg == null || !Number.isFinite(trackDeg)) return null;
  const rad = (trackDeg * Math.PI) / 180;
  const dLat = nm * Math.cos(rad);
  const dLon =
    (nm * Math.sin(rad)) / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  return [
    [lat, lon],
    [lat + dLat, lon + dLon],
  ];
}

function zoneBounds(
  z: Pick<MapZone, "latMin" | "latMax" | "lonMin" | "lonMax">,
): LatLngBoundsExpression {
  return [
    [z.latMin, z.lonMin],
    [z.latMax, z.lonMax],
  ];
}

function zoneCenter(
  z: Pick<MapZone, "latMin" | "latMax" | "lonMin" | "lonMax">,
): { lat: number; lon: number } {
  return {
    lat: (z.latMin + z.latMax) / 2,
    lon: (z.lonMin + z.lonMax) / 2,
  };
}

function kindColor(kind: AerialTrack["kind"]): string {
  if (kind === "awacs") return COLORS.awacs;
  if (kind === "tanker") return COLORS.tanker;
  return COLORS.mil;
}

function aisColor(cat: string): string {
  if (cat === "military" || cat === "interest") return COLORS.ais;
  if (cat === "tanker") return COLORS.aisTanker;
  return COLORS.aisOther;
}

function stampColor(kind: TheaterStamp["kind"]): string {
  if (kind === "arg_manual") return COLORS.argManual;
  if (kind === "arg") return COLORS.arg;
  if (kind === "e6b") return COLORS.e6b;
  if (kind === "ssgn") return COLORS.ssgn;
  if (kind === "csg") return COLORS.csg;
  if (kind === "naval") return COLORS.naval;
  return COLORS.gulf;
}

function stampKindLabel(kind: TheaterStamp["kind"]): string {
  if (kind === "arg_manual") return "Manual ARG";
  if (kind === "arg") return "IRONSIGHT ARG";
  if (kind === "e6b") return "E-6B / TACAMO";
  if (kind === "ssgn") return "Florida / SSGN";
  if (kind === "csg") return "CSG / carrier";
  if (kind === "naval") return "IRONSIGHT naval";
  return "Gulf ADS-B";
}

function ageLabelSec(ageSec: number | null | undefined): string {
  if (ageSec == null) return "—";
  if (ageSec < 90) return `${ageSec}s`;
  return `${Math.round(ageSec / 60)}m`;
}

function regionOfPoint(lat: number, lon: number): MapRegion {
  // Levant desk (E-Med / Israel corridor)
  if (lon >= 28 && lon <= 38.5 && lat >= 29 && lat <= 37.5) return "levant";
  // Iraq / Mesopotamia / Levant–Gulf bridge
  if (lon >= 38.5 && lon <= 49 && lat >= 29 && lat <= 37.5) return "iraq_bridge";
  // Gulf / Hormuz / N. Arabia approaches
  if (lon >= 47 && lon <= 62.5 && lat >= 16.5 && lat <= 34.5) return "gulf";
  // Red Sea / Bab / Horn / Somali basin
  if (lon >= 32 && lon <= 58 && lat >= -4 && lat <= 31) return "red_sea_horn";
  return "wider";
}

function regionOfZone(
  z: Pick<
    TheaterZone | MapZone,
    "latMin" | "latMax" | "lonMin" | "lonMax"
  > & { id?: string },
): MapRegion {
  const id = (z.id ?? "").toLowerCase();
  if (
    id.includes("levant") ||
    id.includes("israel") ||
    id.includes("med") ||
    id.includes("cyprus") ||
    id.includes("llbg") ||
    id.includes("lebanon")
  ) {
    return "levant";
  }
  if (
    id.includes("iraq") ||
    id.includes("syria") ||
    id.includes("jazira") ||
    id.includes("baghdad") ||
    id.includes("mesopotamia")
  ) {
    return "iraq_bridge";
  }
  if (
    id.includes("redsea") ||
    id.includes("red-sea") ||
    id.includes("bab") ||
    id.includes("somali") ||
    id.includes("aden")
  ) {
    return "red_sea_horn";
  }
  if (
    id.includes("gulf") ||
    id.includes("hormuz") ||
    id.includes("bahrain") ||
    id.includes("kharg") ||
    id.includes("navwarn")
  ) {
    return "gulf";
  }
  if (id.includes("arabian") || id.includes("saudi") || id.includes("iran")) {
    return "wider";
  }
  const c = zoneCenter(z);
  return regionOfPoint(c.lat, c.lon);
}

function regionOfAdsbBoxId(boxId: string | undefined): MapRegion | null {
  if (!boxId) return null;
  const id = boxId.toLowerCase();
  if (id.includes("gulf")) return "gulf";
  if (
    id.includes("iraq") ||
    id.includes("syria") ||
    id.includes("jazira")
  ) {
    return "iraq_bridge";
  }
  if (
    id.includes("redsea") ||
    id.includes("bab") ||
    id.includes("somali")
  ) {
    return "red_sea_horn";
  }
  if (id.includes("arabian") || id.includes("saudi") || id.includes("iran")) {
    return "wider";
  }
  if (id.includes("levant") || id.includes("israel") || id.includes("med")) {
    return "levant";
  }
  return null;
}

function landmarkSubtitle(lm: (typeof LANDMARKS)[number]): string {
  if (lm.soft) {
    if (lm.label.includes("Natanz") || lm.label.includes("Fordow")) {
      return "Iran nuclear (context · not go-gate)";
    }
    if (lm.label.includes("Cape") || lm.label.includes("Bosaso")) {
      return "East Africa soft freight watch · not High-go";
    }
    if (lm.label.includes("Karachi")) {
      return "Wider approaches (soft · not go-gate)";
    }
    if (
      /Baghdad|Basra|Erbil|Damascus|Aleppo/.test(lm.label)
    ) {
      return "Iraq/Syria context · not go-gate";
    }
    if (
      /Tehran|Isfahan|Shiraz|Riyadh|Jeddah|Aqaba|Eilat|Port Sudan|Hodeidah|Mukalla|Duqm|Jask|Bushehr|Assaluyeh|Kuwait|Doha|Abu Dhabi|Dubai/.test(
        lm.label,
      )
    ) {
      return "Soft context · not go-gate";
    }
    return "Soft context · not go-gate";
  }
  return `${REGION_LABELS[lm.region]} landmark`;
}

function stampIdentityBits(s: {
  id: string;
  label: string;
  kind: string;
}): string[] {
  const bits: string[] = [];
  const idTail = s.id
    .replace(/^(arg|arg_manual|ssgn|csg|naval|e6b|gulf)-/i, "")
    .toLowerCase()
    .replace(/\s+/g, "");
  if (idTail) bits.push(idTail);
  const name = s.label
    .replace(/^u\.?s\.?s\.?\s+/i, "")
    .replace(/\s+/g, "")
    .toLowerCase();
  if (name) bits.push(name);
  // Common ARG hull aliases
  if (/bataan|lhd-?5/.test(`${idTail} ${name}`)) bits.push("bataan", "lhd-5");
  if (/boxer|lhd-?4/.test(`${idTail} ${name}`)) bits.push("boxer", "lhd-4");
  if (/newyork|new-york|lpd-?21/.test(`${idTail} ${name}`))
    bits.push("newyork", "lpd-21");
  return bits;
}

function stampsAreDup(
  a: { id: string; label: string; kind: string; lat: number; lon: number },
  b: { id: string; label: string; kind: string; lat: number; lon: number },
): boolean {
  if (a.id === b.id) return true;
  const ab = stampIdentityBits(a);
  const bb = stampIdentityBits(b);
  if (ab.some((x) => bb.includes(x))) return true;
  // Near-same position + overlapping name fragment
  if (
    Math.abs(a.lat - b.lat) < 0.35 &&
    Math.abs(a.lon - b.lon) < 0.35 &&
    ab.some((x) => x.length >= 4 && bb.some((y) => y.includes(x) || x.includes(y)))
  ) {
    return true;
  }
  return false;
}

function collectTheaterStamps(theater: TheaterWatch | null): TheaterStamp[] {
  if (!theater) return collectManualArgPins();
  const out: TheaterStamp[] = [...collectManualArgPins()];

  const pushUnique = (stamp: TheaterStamp) => {
    const dupIdx = out.findIndex((prev) => stampsAreDup(prev, stamp));
    if (dupIdx < 0) {
      out.push(stamp);
      return;
    }
    // Prefer fresher meta / non-manual when replacing near-dup (e.g. Bataan x2).
    const prev = out[dupIdx]!;
    const prevManual = prev.kind === "arg_manual" || prev.manual === true;
    const nextManual = stamp.kind === "arg_manual" || stamp.manual === true;
    if (prevManual && !nextManual) {
      out[dupIdx] = stamp;
      return;
    }
    if (!prevManual && nextManual) return;
    // Keep existing unless new has richer meta timestamp
    const prevTs = prev.meta?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
    const nextTs = stamp.meta?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
    if (nextTs && nextTs >= prevTs) out[dupIdx] = stamp;
  };

  for (const v of theater.khargPickaxe?.amphibious?.vessels ?? []) {
    const stamp = v.ironsight;
    if (!stamp) continue;
    if (!Number.isFinite(stamp.lat) || !Number.isFinite(stamp.lon)) continue;
    if (stamp.lat === 0 && stamp.lon === 0) continue;
    const stale = (stamp as { stale?: boolean }).stale === true;
    const ageSec = (stamp as { ageSec?: number }).ageSec;
    const sogKt = (stamp as { sogKt?: number | null }).sogKt ?? null;
    const courseDeg =
      (stamp as { courseDeg?: number | null }).courseDeg ??
      (stamp as { headingDeg?: number | null }).headingDeg ??
      null;
    const destination =
      (stamp as { destination?: string | null }).destination ?? null;
    const kinBits = [
      sogKt != null ? `${sogKt.toFixed(1)} kt` : null,
      courseDeg != null ? `crs ${Math.round(courseDeg)}°` : null,
      destination ? `→ ${destination}` : null,
    ].filter(Boolean);
    pushUnique({
      id: `arg-${v.key}`,
      label: stamp.name || v.name,
      kind: "arg",
      lat: stamp.lat,
      lon: stamp.lon,
      stale,
      ageSec,
      sogKt,
      courseDeg,
      meta: `${stale ? "DARK / LAST-KNOWN" : "LIVE"} · ${stamp.status} · ${stamp.region}${kinBits.length ? ` · ${kinBits.join(" · ")}` : ""}${stamp.lastReported ? ` · ${stamp.lastReported}` : ""}${stale && ageSec != null ? ` · ${ageLabelSec(ageSec)}` : ""}`,
    });
  }

  for (const s of theater.khargPickaxe?.e6b?.samples ?? []) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    const stale = (s as { stale?: boolean }).stale === true;
    const ageSec = (s as { ageSec?: number }).ageSec;
    pushUnique({
      id: `e6b-${(s as { hex?: string }).hex || s.callsign}-${s.lat.toFixed(2)}-${s.lon.toFixed(2)}`,
      label: s.callsign || "E-6B",
      kind: "e6b",
      lat: s.lat,
      lon: s.lon,
      stale,
      ageSec,
      meta: `${stale ? "DARK / LAST-KNOWN" : "LIVE"} · hex ${(s as { hex?: string }).hex || "?"} · type ${s.aircraftType || "?"} · class e6b${s.altitude ? ` · FL${Math.round(s.altitude / 100)}` : ""}${stale && ageSec != null ? ` · ${ageLabelSec(ageSec)}` : ""}`,
    });
  }

  for (const s of theater.aerial?.samples ?? []) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    const acType = (s.aircraftType || "").toUpperCase().replace(/[-\s]/g, "");
    if (
      s.type !== "tanker" &&
      s.type !== "awacs" &&
      /^(B7[0-8]|A3[0-58]|E35|A139|A169|CL2T|P180|P18)/.test(acType)
    ) {
      continue;
    }
    const sampleRegion =
      (s as { region?: MapRegion }).region ??
      regionOfAdsbBoxId((s as { boxId?: string }).boxId) ??
      regionOfPoint(s.lat, s.lon);
    const stale = (s as { stale?: boolean }).stale === true;
    const ageSec = (s as { ageSec?: number }).ageSec;
    const hex = (s as { hex?: string }).hex;
    pushUnique({
      id: `gulf-${hex || s.callsign}-${s.lat.toFixed(2)}-${s.lon.toFixed(2)}`,
      label: s.callsign || s.type || "ADS-B",
      kind: "gulf_adsb",
      lat: s.lat,
      lon: s.lon,
      stale,
      ageSec,
      meta: `${stale ? "DARK / LAST-KNOWN" : "LIVE"} · hex ${hex || "?"} · type ${s.aircraftType || "?"} · class ${s.type}${s.altitude ? ` · FL${Math.round(s.altitude / 100)}` : ""}${(s as { boxId?: string }).boxId ? ` · ${(s as { boxId?: string }).boxId!.replace("adsb-", "")}` : ""}${stale && ageSec != null ? ` · ${ageLabelSec(ageSec)}` : ""}`,
      region: sampleRegion,
    });
  }

  for (const s of theater.mapOverlays?.stamps ?? []) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    if (s.lat === 0 && s.lon === 0) continue;
    const stale = (s as { stale?: boolean }).stale === true;
    const ageSec = (s as { ageSec?: number }).ageSec;
    const sogKt = (s as { sogKt?: number | null }).sogKt ?? null;
    const courseDeg = (s as { courseDeg?: number | null }).courseDeg ?? null;
    const staleBit = s.lastReported ? ` · ${s.lastReported}` : "";
    pushUnique({
      id: s.id,
      label: s.label,
      kind: s.kind,
      lat: s.lat,
      lon: s.lon,
      stale,
      ageSec,
      sogKt,
      courseDeg,
      meta:
        s.meta ??
        `${stale ? "DARK / LAST-KNOWN" : "LIVE"} · ${s.status} · ${s.region}${staleBit}`,
      region: regionOfPoint(s.lat, s.lon),
    });
  }

  return out;
}

function zoneStrokeColor(
  kind: MapZone["kind"] | TheaterZone["kind"],
): string {
  return ZONE_COLORS[kind].stroke;
}

function collectTheaterZones(theater: TheaterWatch | null): TheaterZone[] {
  if (!theater?.mapOverlays?.zones) return [];
  return theater.mapOverlays.zones;
}

function computeAllBounds(
  tracks: AerialTrack[],
  aisPoints: MapPoint[],
  zones: Array<Pick<MapZone, "latMin" | "latMax" | "lonMin" | "lonMax">>,
  stamps: TheaterStamp[],
  landmarksOn: boolean,
): LatLngBoundsExpression | null {
  const pts: Array<[number, number]> = [];
  for (const t of tracks) pts.push([t.lat, t.lon]);
  for (const p of aisPoints) pts.push([p.lat, p.lon]);
  for (const s of stamps) pts.push([s.lat, s.lon]);
  for (const z of zones) {
    pts.push([z.latMin, z.lonMin], [z.latMax, z.lonMax]);
  }
  if (landmarksOn) {
    for (const lm of LANDMARKS) pts.push([lm.lat, lm.lon]);
  }
  const hasGulfFeature =
    stamps.some((s) => regionOfPoint(s.lat, s.lon) === "gulf") ||
    zones.some((z) => regionOfZone(z) === "gulf") ||
    (landmarksOn && LANDMARKS.some((lm) => lm.region === "gulf"));
  const hasLevantFeature =
    tracks.some((t) => regionOfPoint(t.lat, t.lon) === "levant") ||
    aisPoints.some((p) => regionOfPoint(p.lat, p.lon) === "levant") ||
    zones.some((z) => regionOfZone(z) === "levant") ||
    (landmarksOn && LANDMARKS.some((lm) => lm.region === "levant"));
  const hasWideFeature =
    stamps.some((s) => {
      const r = regionOfPoint(s.lat, s.lon);
      return r === "red_sea_horn" || r === "iraq_bridge" || r === "wider";
    }) ||
    zones.some((z) => {
      const r = regionOfZone(z);
      return r === "red_sea_horn" || r === "iraq_bridge" || r === "wider";
    }) ||
    (landmarksOn &&
      LANDMARKS.some(
        (lm) =>
          lm.region === "red_sea_horn" ||
          lm.region === "iraq_bridge" ||
          lm.region === "wider",
      ));

  // Never clip Fit-all to Levant-only when Gulf landmarks/stamps are on.
  if (hasGulfFeature) {
    const gb = GULF_BOUNDS as [[number, number], [number, number]];
    pts.push(gb[0], gb[1]);
  }
  if (hasLevantFeature) {
    const lb = LEVANT_BOUNDS as [[number, number], [number, number]];
    pts.push(lb[0], lb[1]);
  }
  // Landmarks / multi-region ⇒ always span screenshot-scale theater.
  if (
    landmarksOn ||
    hasWideFeature ||
    (hasGulfFeature && hasLevantFeature)
  ) {
    const tb = THEATER_BOUNDS as [[number, number], [number, number]];
    pts.push(tb[0], tb[1]);
  }
  if (pts.length === 0) return null;
  let latMin = pts[0]![0];
  let latMax = pts[0]![0];
  let lonMin = pts[0]![1];
  let lonMax = pts[0]![1];
  for (const [lat, lon] of pts) {
    latMin = Math.min(latMin, lat);
    latMax = Math.max(latMax, lat);
    lonMin = Math.min(lonMin, lon);
    lonMax = Math.max(lonMax, lon);
  }
  // Keep a usable box even for a single point
  if (latMax - latMin < 0.4) {
    latMin -= 0.3;
    latMax += 0.3;
  }
  if (lonMax - lonMin < 0.4) {
    lonMin -= 0.3;
    lonMax += 0.3;
  }
  return [
    [latMin, lonMin],
    [latMax, lonMax],
  ];
}

function zoneLabelIcon(label: string, color: string): L.DivIcon {
  return L.divIcon({
    className: "osint-map-zone-label",
    html: `<span style="--zone-c:${color}">${escapeHtml(label)}</span>`,
    iconSize: [1, 1],
    iconAnchor: [0, 0],
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Full-viewport Levant + Gulf OSINT map — Leaflet + archive time scrubber.
 */
export function OsintTheaterMap({
  onRefreshAerial,
  onRegisterCopyHandler,
}: Props) {
  const israelStrike = useDashboardStore((s) => s.israelStrike);
  const setIsraelStrike = useDashboardStore((s) => s.setIsraelStrike);
  const [theater, setTheater] = useState<TheaterWatch | null>(null);
  const [theaterError, setTheaterError] = useState<string | null>(null);
  const [fit, setFit] = useState<FitRequest | null>({
    mode: "theater",
    nonce: 0,
  });
  const [focus, setFocus] = useState<{
    lat: number;
    lon: number;
    zoom: number;
    nonce: number;
  } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    ...ALL_LAYERS_ON,
  });
  const [manualTick, setManualTick] = useState(0);
  const [basemap, setBasemap] = useState<"dark" | "osm">("dark");
  const [liveMode, setLiveMode] = useState(true);
  const [scrubMs, setScrubMs] = useState<number>(() => Date.now());
  const [archiveStatus, setArchiveStatus] = useState<OsintArchiveStatus | null>(
    null,
  );
  const [kinetic, setKinetic] = useState<KineticRewindReport | null>(null);
  const [peaks, setPeaks] = useState<OsintArchivePeak[]>([]);
  const [replaySamples, setReplaySamples] = useState<OsintArchiveSample[]>([]);
  const [replayLoading, setReplayLoading] = useState(false);
  const [copyFlash, setCopyFlash] = useState<string | null>(null);
  const scrubDebounce = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const tw = await fetchTheaterWatch(false);
        if (!cancelled) {
          setTheater(tw);
          setTheaterError(null);
          setManualTick((n) => n + 1);
        }
      } catch (e) {
        if (!cancelled) {
          setTheater((current) => {
            if (!current) {
              setTheaterError(
                e instanceof Error ? e.message : "theater fetch failed",
              );
            }
            return current;
          });
        }
        // Keep last-good theater (stamps/overlays) on timeout — do not clear.
      } finally {
        inFlight = false;
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), THEATER_POLL_MS);
    const onStorage = () => setManualTick((n) => n + 1);
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const kr = await fetchKineticRewind();
        if (!cancelled) setKinetic(kr);
      } catch {
        /* last-good kinetic pins stay */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 90_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadMeta = async () => {
      try {
        const [st, pk] = await Promise.all([
          fetchOsintArchiveStatus(),
          fetchOsintArchivePeaks({
            from: new Date(Date.now() - 48 * 3600_000).toISOString(),
            limit: 1500,
          }),
        ]);
        if (cancelled) return;
        setArchiveStatus(st);
        setPeaks(pk.peaks);
        if (st.oldestSampleAt) {
          const oldest = Date.parse(st.oldestSampleAt);
          if (Number.isFinite(oldest) && scrubMs < oldest) {
            setScrubMs(oldest);
          }
        }
      } catch {
        /* archive optional until first writes */
      }
    };
    void loadMeta();
    const id = window.setInterval(() => void loadMeta(), 120_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // Refresh archive bounds periodically; scrubMs only seeds from oldest once
  }, []);

  useEffect(() => {
    if (liveMode) {
      setReplaySamples([]);
      setReplayLoading(false);
      return;
    }
    let cancelled = false;
    if (scrubDebounce.current != null) {
      window.clearTimeout(scrubDebounce.current);
    }
    scrubDebounce.current = window.setTimeout(() => {
      setReplayLoading(true);
      void fetchOsintArchiveRange({
        at: new Date(scrubMs).toISOString(),
        windowMs: 5 * 60_000,
      })
        .then((frame) => {
          if (!cancelled) setReplaySamples(frame.samples);
        })
        .catch(() => {
          if (!cancelled) setReplaySamples([]);
        })
        .finally(() => {
          if (!cancelled) setReplayLoading(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      if (scrubDebounce.current != null) {
        window.clearTimeout(scrubDebounce.current);
      }
    };
  }, [liveMode, scrubMs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "Space") {
        e.preventDefault();
        setLiveMode(true);
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const oldest = archiveStatus?.oldestSampleAt
        ? Date.parse(archiveStatus.oldestSampleAt)
        : Date.now() - 86_400_000;
      const newest = archiveStatus?.newestSampleAt
        ? Date.parse(archiveStatus.newestSampleAt)
        : Date.now();
      const step = 60_000;
      setLiveMode(false);
      setScrubMs((prev) => {
        const base = liveMode ? newest : prev;
        const next =
          e.key === "ArrowLeft" ? base - step : base + step;
        return Math.min(newest, Math.max(oldest, next));
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [archiveStatus, liveMode]);

  const tracks = israelStrike?.inputs.aerialTracks ?? [];
  const lastGoodTracks = israelStrike?.inputs.aerialLastGoodTracks ?? [];
  const overlays = israelStrike?.inputs.mapOverlays;
  const zones = overlays?.zones ?? [];
  const aisPoints = [
    ...(overlays?.points ?? []),
    ...(theater?.mapOverlays?.aisPoints ?? []),
  ];
  const firmsPoints = overlays?.firmsPoints ?? [];
  const firmsNote = overlays?.firmsNote ?? "FIRMS: no coords";
  const theaterStamps = useMemo(
    () => collectTheaterStamps(theater),
    [theater, manualTick],
  );
  const theaterZones = useMemo(() => collectTheaterZones(theater), [theater]);

  const archiveRange = useMemo(() => {
    const oldest = archiveStatus?.oldestSampleAt
      ? Date.parse(archiveStatus.oldestSampleAt)
      : Date.now() - 3600_000;
    const newest = archiveStatus?.newestSampleAt
      ? Date.parse(archiveStatus.newestSampleAt)
      : Date.now();
    return {
      oldest: Number.isFinite(oldest) ? oldest : Date.now() - 3600_000,
      newest: Number.isFinite(newest) ? newest : Date.now(),
    };
  }, [archiveStatus]);

  const peakSpark = useMemo(() => {
    if (peaks.length < 2) return null;
    const vals = peaks.map((p) => p.tankers + p.awacs * 0.5);
    const max = Math.max(...vals, 1);
    const w = 240;
    const h = 28;
    const pts = vals
      .map((v, i) => {
        const x = (i / (vals.length - 1)) * w;
        const y = h - (v / max) * (h - 2) - 1;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    return { pts, w, h, max };
  }, [peaks]);

  const goLive = () => {
    setLiveMode(true);
    setScrubMs(Date.now());
  };

  const enterReplayAt = (ms: number) => {
    setLiveMode(false);
    setScrubMs(
      Math.min(archiveRange.newest, Math.max(archiveRange.oldest, ms)),
    );
  };

  const replayKindColor = (kind: string): string => {
    if (kind === "tanker") return COLORS.tanker;
    if (kind === "awacs" || kind === "e6b") return COLORS.awacs;
    if (kind === "ais") return COLORS.ais;
    if (kind === "firms") return COLORS.firms;
    if (kind === "arg" || kind === "arg_manual") return COLORS.arg;
    if (kind === "ssgn") return COLORS.ssgn;
    if (kind === "csg" || kind === "naval") return COLORS.arg;
    return COLORS.mil;
  };

  const notamZones = zones.filter((z) => z.kind === "notam");
  const adsbZones = zones.filter((z) => z.kind === "adsb_box");
  const dipNavZones = zones.filter(
    (z) =>
      z.kind === "dip_border" ||
      z.kind === "nav_watch" ||
      z.kind === "cyprus_ais",
  );
  const gulfNotamZones = theaterZones.filter((z) => z.kind === "notam");
  const gulfAdsbZonesRaw = theaterZones.filter((z) => z.kind === "adsb_box");
  const gulfAdsbZones =
    gulfAdsbZonesRaw.length > 0 ? gulfAdsbZonesRaw : FALLBACK_THEATER_ADSB;
  const gulfNavZones = theaterZones.filter(
    (z) => z.kind === "nav_watch" || z.kind === "ais_box",
  );

  const copyDisplayedAssets = async () => {
    if (liveMode) {
      setCopyFlash("Fetching…");
      try {
        await copyLiveMapAssets({ israelStrike, theater });
        setCopyFlash("Copied");
        window.setTimeout(() => setCopyFlash(null), 1600);
      } catch {
        setCopyFlash("Copy failed");
        window.setTimeout(() => setCopyFlash(null), 2000);
      }
      return;
    }
    setCopyFlash("Fetching…");
    const mode = liveMode
      ? "LIVE"
      : `REPLAY @ ${new Date(scrubMs).toISOString()}`;
    const onLayers = (Object.keys(layers) as LayerKey[])
      .filter((k) => layers[k])
      .join(", ");

    // Always refresh live sources for paste — don't copy an empty cold-start UI.
    let istSnap: IsraelStrikeTells | null = israelStrike;
    let theaterSnap: TheaterWatch | null = theater;
    let fetchNotes: string[] = [];
    if (liveMode) {
      const [twRes, istRes] = await Promise.allSettled([
        fetchTheaterWatch(false),
        fetchIsraelStrikeTells(false),
      ]);
      if (twRes.status === "fulfilled") {
        theaterSnap = twRes.value;
        setTheater(twRes.value);
        setTheaterError(null);
        setManualTick((n) => n + 1);
      } else {
        fetchNotes.push(
          `theater fetch failed: ${twRes.reason instanceof Error ? twRes.reason.message : String(twRes.reason)}`,
        );
      }
      if (istRes.status === "fulfilled") {
        istSnap = istRes.value;
        setIsraelStrike(istRes.value);
      } else {
        fetchNotes.push(
          `aerial/IST fetch failed: ${istRes.reason instanceof Error ? istRes.reason.message : String(istRes.reason)}`,
        );
      }
    }

    const liveTracks = istSnap?.inputs.aerialTracks ?? [];
    const darkTracks = istSnap?.inputs.aerialLastGoodTracks ?? [];
    const istOverlays = istSnap?.inputs.mapOverlays;
    const istZones = istOverlays?.zones ?? [];
    const istAis = istOverlays?.points ?? [];
    const theaterAis = theaterSnap?.mapOverlays?.aisPoints ?? [];
    const allAis = [...istAis, ...theaterAis];
    const istFirms = istOverlays?.firmsPoints ?? [];
    const istFirmsNote = istOverlays?.firmsNote ?? firmsNote;
    const stampRows = collectTheaterStamps(theaterSnap);
    const theaterZoneRows = collectTheaterZones(theaterSnap);

    const lines: string[] = [
      `**Tradehole Map · displayed assets** · ${new Date().toISOString()}`,
      `Mode: ${mode}`,
      `Layers on: ${onLayers || "(none)"}`,
      `Honesty: class = Tradehole label; type = raw ICAO (E35L = Embraer Legacy 600 bizjet, not E-3 Sentry AWACS). FOLLOWED = tanker/AWACS/airlift/combat hex enrolled in Med–Gulf–Horn, then tracked outside scoring boxes (still transmitting, not AER-01). VIP airliners (B77W) and EMS/firefighting types are not followed. Naval stamps are curated OSINT (often static lat/lon, no SOG).`,
      `Source: fresh API pull for paste (not cold UI state).`,
      ``,
    ];
    if (fetchNotes.length) {
      lines.push(`Fetch notes: ${fetchNotes.join(" · ")}`, ``);
    }

    const pushNone = () => lines.push(`- (none)`);

    if (liveMode) {
      if (layers.aerial) {
        lines.push(`### Aerial · Levant ADS-B`);
        let n = 0;
        const followedLive = liveTracks.filter((t) => t.followed);
        const inBoxLive = liveTracks.filter((t) => !t.followed);
        for (const t of inBoxLive) {
          lines.push(`- ${formatAerialAssetLine(t)}`);
          n += 1;
        }
        if (followedLive.length) {
          lines.push(
            `### Aerial · FOLLOWED outbound (enrolled in theater, still transmitting — not AER-scored)`,
          );
          for (const t of followedLive) {
            lines.push(`- ${formatAerialAssetLine(t)}`);
            n += 1;
          }
        }
        for (const t of darkTracks) {
          lines.push(`- ${formatAerialAssetLine({ ...t, stale: true })}`);
          n += 1;
        }
        if (!n) pushNone();
        lines.push(
          `AER scored: ${istSnap?.inputs.aerialTankersLevant ?? "—"}t / ${istSnap?.inputs.aerialAwacsLevant ?? "—"}a · feed ${istSnap?.inputs.aerialFeedStatus ?? "?"} · peak ${istSnap?.inputs.aerialSessionPeak ? `${istSnap.inputs.aerialSessionPeak.tankers}t/${istSnap.inputs.aerialSessionPeak.awacs}a` : "—"}`,
        );
        lines.push(``);
      }

      if (layers.theater) {
        lines.push(
          `### Theater stamps · ARG / SSGN / CSG / naval / Gulf ADS-B / E-6B`,
        );
        if (!stampRows.length) pushNone();
        const aerialHex = new Set(
          [...liveTracks, ...darkTracks].map((t) => t.hex).filter(Boolean),
        );
        for (const s of stampRows) {
          const gulfHex = s.kind === "gulf_adsb" ? s.id.replace(/^gulf-/, "").split("-")[0] : "";
          if (gulfHex && aerialHex.has(gulfHex)) continue;
          lines.push(
            `- ${s.stale ? "DARK" : "LIVE"} ${s.label} · kind ${s.kind} · ${s.lat.toFixed(4)},${s.lon.toFixed(4)}${s.courseDeg != null ? ` · hdg ${Math.round(s.courseDeg)}°` : ""}${s.sogKt != null ? ` · ${s.sogKt.toFixed(1)}kt` : ""}${s.region ? ` · region ${s.region}` : ""}${s.ageSec != null ? ` · age ${s.ageSec}s` : ""}${s.lastSeenAt ? ` · lastSeen ${s.lastSeenAt}` : ""}${s.meta ? ` · ${s.meta}` : ""}`,
          );
        }
        lines.push(``);
      }

      if (layers.ais) {
        lines.push(`### AIS · Cyprus / Hormuz / Bab`);
        if (!allAis.length) pushNone();
        for (const p of allAis) {
          lines.push(
            `- ${p.label} · category ${p.category} · ${p.lat.toFixed(4)},${p.lon.toFixed(4)}${p.sog != null ? ` · ${p.sog.toFixed(1)}kt` : ""}${p.cog != null ? ` · cog ${Math.round(p.cog)}°` : ""}${"boxId" in p && p.boxId ? ` · ${p.boxId}` : ""} · id ${p.id}`,
          );
        }
        lines.push(``);
      }

      if (layers.firms) {
        lines.push(`### FIRMS thermal`);
        if (!istFirms.length) pushNone();
        for (const p of istFirms) {
          lines.push(
            `- ${p.label} · box ${p.box} · ${p.lat.toFixed(4)},${p.lon.toFixed(4)}${p.frp != null ? ` · frp ${p.frp}` : ""}${p.acqDate ? ` · ${p.acqDate}` : ""} · id ${p.id}`,
          );
        }
        lines.push(`Note: ${istFirmsNote}`);
        lines.push(``);
      }
    } else {
      lines.push(`### Replay frame assets (± window)`);
      if (!replaySamples.length) pushNone();
      for (const s of replaySamples) {
        const show =
          (layers.aerial &&
            (s.kind === "tanker" ||
              s.kind === "awacs" ||
              s.kind === "mil" ||
              s.kind === "e6b")) ||
          (layers.ais && s.kind === "ais") ||
          (layers.firms && s.kind === "firms") ||
          (layers.theater &&
            (s.kind === "arg" ||
              s.kind === "arg_manual" ||
              s.kind === "ssgn" ||
              s.kind === "csg" ||
              s.kind === "naval" ||
              s.kind === "gulf_adsb"));
        if (!show) continue;
        lines.push(
          `- ${s.stale ? "DARK" : "LIVE"} ${s.label || s.assetKey} · key ${s.assetKey} · type/kind ${s.kind} · ${s.lat.toFixed(4)},${s.lon.toFixed(4)}${s.trackDeg != null ? ` · hdg ${Math.round(s.trackDeg)}°` : ""}${s.gsKt != null ? ` · ${Math.round(s.gsKt)}kt` : ""}${s.altFt != null ? ` · FL${Math.round(s.altFt / 100)}` : ""}${s.region ? ` · region ${s.region}` : ""}${s.source ? ` · ${s.source}` : ""} · ts ${s.ts}`,
        );
      }
      lines.push(``);
    }

    if (layers.notam || layers.adsb || layers.dipNav) {
      lines.push(`### Zones (on-map rectangles)`);
      const zoneList: Array<{
        id: string;
        kind: string;
        label: string;
        status: string;
        latMin: number;
        latMax: number;
        lonMin: number;
        lonMax: number;
        titles?: string[];
      }> = [];
      const levantNotam = istZones.filter((z) => z.kind === "notam");
      const levantAdsb = istZones.filter((z) => z.kind === "adsb_box");
      const levantDip = istZones.filter(
        (z) =>
          z.kind === "dip_border" ||
          z.kind === "nav_watch" ||
          z.kind === "cyprus_ais",
      );
      const tNotam = theaterZoneRows.filter((z) => z.kind === "notam");
      const tAdsb = theaterZoneRows.filter((z) => z.kind === "adsb_box");
      const tNav = theaterZoneRows.filter(
        (z) => z.kind === "nav_watch" || z.kind === "ais_box",
      );
      if (layers.notam) zoneList.push(...levantNotam, ...tNotam);
      if (layers.adsb) {
        zoneList.push(...levantAdsb);
        zoneList.push(...(tAdsb.length ? tAdsb : FALLBACK_THEATER_ADSB));
      }
      if (layers.dipNav) zoneList.push(...levantDip, ...tNav);
      if (!zoneList.length) pushNone();
      for (const z of zoneList) {
        lines.push(
          `- ${z.id} · ${z.kind} · ${z.status} · ${z.label} · box ${z.latMin.toFixed(2)}–${z.latMax.toFixed(2)}N ${z.lonMin.toFixed(2)}–${z.lonMax.toFixed(2)}E${z.titles?.length ? ` · ${z.titles.slice(0, 2).join(" | ")}` : ""}`,
        );
      }
      lines.push(``);
    }

    if (layers.landmarks) {
      lines.push(`### Landmarks (context only — not go-gates)`);
      for (const lm of LANDMARKS) {
        lines.push(
          `- ${lm.label} · ${lm.lat.toFixed(3)},${lm.lon.toFixed(3)} · region ${lm.region}${lm.soft ? " · soft/context" : ""}`,
        );
      }
      lines.push(``);
    }

    if (layers.kinetic) {
      lines.push(`### Kinetic rewind (named bases — not AER-01 High-go)`);
      lines.push(
        kinetic?.honesty ??
          "Confirmed strike ≠ ADS-B over target. Support = tankers/corridor in archive.",
      );
      if (kinetic?.event) {
        lines.push(
          `- EVENT ${kinetic.event.target.label} · ${kinetic.event.target.lat.toFixed(3)},${kinetic.event.target.lon.toFixed(3)} · ${kinetic.event.eventAt ?? "time unknown"} · ${kinetic.event.headline ?? "stamped"}`,
        );
      } else {
        pushNone();
      }
      for (const h of kinetic?.hits.slice(0, 12) ?? []) {
        lines.push(
          `- ${h.kind} ${h.assetKey} · ${h.distKm.toFixed(0)} km · ${h.ts}${h.trackDeg != null ? ` · hdg ${Math.round(h.trackDeg)}°` : ""}${h.corridorTell ? " · Jordan-east SOFT" : ""}`,
        );
      }
      lines.push(``);
    }

    lines.push(
      `Counts: Levant aerial ${liveTracks.filter((t) => !t.followed).length} live / ${liveTracks.filter((t) => t.followed).length} followed / ${darkTracks.length} dark · theater stamps ${stampRows.length} · AIS ${allAis.length} · FIRMS ${istFirms.length}`,
    );

    try {
      await copyText(lines.join("\n"));
      setCopyFlash("Copied");
      window.setTimeout(() => setCopyFlash(null), 1600);
    } catch {
      setCopyFlash("Copy failed");
      window.setTimeout(() => setCopyFlash(null), 2000);
    }
  };

  useEffect(() => {
    if (!onRegisterCopyHandler) return;
    onRegisterCopyHandler(() => {
      void copyDisplayedAssets();
    });
    return () => onRegisterCopyHandler(null);
    // Re-bind when board inputs change so header always copies current frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- copyDisplayedAssets closes over latest board
  }, [
    onRegisterCopyHandler,
    liveMode,
    scrubMs,
    layers,
    tracks,
    lastGoodTracks,
    theaterStamps,
    aisPoints,
    firmsPoints,
    notamZones,
    gulfNotamZones,
    adsbZones,
    gulfAdsbZones,
    dipNavZones,
    gulfNavZones,
    replaySamples,
    firmsNote,
    kinetic,
  ]);

  const layerCounts: Record<LayerKey, number> = {
    aerial: tracks.length + lastGoodTracks.length,
    notam: notamZones.length + gulfNotamZones.length,
    adsb: adsbZones.length + gulfAdsbZones.length,
    ais: aisPoints.length,
    dipNav: dipNavZones.length + gulfNavZones.length,
    landmarks: LANDMARKS.length,
    theater: theaterStamps.length,
    firms: firmsPoints.length,
    kinetic:
      (kinetic?.targets.length ?? 0) +
      (kinetic?.hits.length ?? 0) +
      (kinetic?.event ? 1 : 0),
  };

  const hasGulfCluster =
    theaterStamps.some(
      (s) =>
        s.kind === "arg" ||
        s.kind === "arg_manual" ||
        s.kind === "gulf_adsb" ||
        s.kind === "ssgn" ||
        s.kind === "csg" ||
        s.kind === "naval" ||
        s.lon >= GULF_LON_SPLIT,
    ) ||
    theaterZones.length > 0 ||
    firmsPoints.some((p) => p.lon >= GULF_LON_SPLIT);

  const visibleTracks = layers.aerial ? tracks : [];
  const visibleLastGood = layers.aerial ? lastGoodTracks : [];
  const visibleAis = layers.ais ? aisPoints : [];
  const visibleFirms = layers.firms ? firmsPoints : [];
  const visibleZones = [
    ...(layers.notam ? notamZones : []),
    ...(layers.notam ? gulfNotamZones : []),
    ...(layers.adsb ? adsbZones : []),
    ...(layers.adsb ? gulfAdsbZones : []),
    ...(layers.dipNav ? dipNavZones : []),
    ...(layers.dipNav ? gulfNavZones : []),
  ];
  const visibleStamps = layers.theater ? theaterStamps : [];

  const allBounds = useMemo(
    () =>
      computeAllBounds(
        [...visibleTracks, ...visibleLastGood],
        [...visibleAis, ...visibleFirms.map((p) => ({
          id: p.id,
          kind: "ais_vessel" as const,
          label: p.label,
          category: "firms",
          lat: p.lat,
          lon: p.lon,
          sog: null,
          cog: null,
        }))],
        visibleZones,
        visibleStamps,
        layers.landmarks,
      ),
    [
      visibleTracks,
      visibleLastGood,
      visibleAis,
      visibleFirms,
      visibleZones,
      visibleStamps,
      layers.landmarks,
    ],
  );

  const requestFit = (mode: FitMode) => {
    setFocus(null);
    setSelectedId(null);
    const followedPts = [
      ...tracks.filter((t) => t.followed),
      ...lastGoodTracks.filter((t) => t.followed),
    ];
    const followedBounds: LatLngBoundsExpression | null =
      followedPts.length > 0
        ? [
            [
              Math.min(...followedPts.map((t) => t.lat)),
              Math.min(...followedPts.map((t) => t.lon)),
            ],
            [
              Math.max(...followedPts.map((t) => t.lat)),
              Math.max(...followedPts.map((t) => t.lon)),
            ],
          ]
        : null;
    setFit((prev) => ({
      mode,
      nonce: (prev?.nonce ?? 0) + 1,
      bounds:
        mode === "all"
          ? allBounds
          : mode === "followed"
            ? followedBounds
            : null,
    }));
  };

  const applyComprehensivePreset = () => {
    setLayers({ ...ALL_LAYERS_ON });
    setFocus(null);
    setSelectedId(null);
    // Wide theater frame covers all watch tiles + soft landmarks.
    setFit((prev) => ({
      mode: "theater",
      nonce: (prev?.nonce ?? 0) + 1,
      bounds: null,
    }));
  };

  const featureRows: FeatureRow[] = useMemo(() => {
    const rows: FeatureRow[] = [];

    if (layers.aerial) {
      for (const t of tracks) {
        rows.push({
          id: `aerial-${t.hex}`,
          layer: "aerial",
          region: regionOfPoint(t.lat, t.lon),
          title: t.callsign || t.hex,
          subtitle: formatAerialAssetShort(t),
          lat: t.lat,
          lon: t.lon,
          color: kindColor(t.kind),
          zoom: 8,
        });
      }
      for (const t of lastGoodTracks) {
        rows.push({
          id: `aerial-lg-${t.hex}`,
          layer: "aerial",
          region: regionOfPoint(t.lat, t.lon),
          title: t.callsign || t.hex,
          subtitle: formatAerialAssetShort({ ...t, stale: true }),
          lat: t.lat,
          lon: t.lon,
          color: COLORS.lastGood,
          zoom: 8,
        });
      }
    }

    if (layers.ais) {
      for (const p of aisPoints) {
        rows.push({
          id: `ais-${p.id}`,
          layer: "ais",
          region: regionOfPoint(p.lat, p.lon),
          title: p.label,
          subtitle: `AIS ${p.category}`,
          lat: p.lat,
          lon: p.lon,
          color: aisColor(p.category),
          zoom: 9,
        });
      }
    }

    if (layers.firms) {
      for (const p of firmsPoints) {
        rows.push({
          id: `firms-${p.id}`,
          layer: "firms",
          region: regionOfPoint(p.lat, p.lon),
          title: p.label,
          subtitle: `FIRMS ${p.box}${p.acqDate ? ` · ${p.acqDate}` : ""}`,
          lat: p.lat,
          lon: p.lon,
          color: COLORS.firms,
          zoom: 8,
        });
      }
    }

    if (layers.theater) {
      for (const s of theaterStamps) {
        const liveBit = s.stale
          ? `DARK / LAST-KNOWN${s.ageSec != null ? ` · ${ageLabelSec(s.ageSec)}` : ""}`
          : s.kind === "arg_manual" || s.manual
            ? "MANUAL"
            : "LIVE";
        rows.push({
          id: s.id,
          layer: "theater",
          region: s.region ?? regionOfPoint(s.lat, s.lon),
          title: s.label,
          subtitle:
            `${liveBit} · ${stampKindLabel(s.kind)}` +
            (s.meta ? ` · ${s.meta}` : ""),
          lat: s.lat,
          lon: s.lon,
          color: s.stale ? COLORS.lastGood : stampColor(s.kind),
          zoom: 7,
        });
      }
    }

    const zoneList: Array<(MapZone | TheaterZone) & { region: MapRegion }> = [
      ...(layers.notam
        ? notamZones.map((z) => ({ ...z, region: regionOfZone(z) }))
        : []),
      ...(layers.notam
        ? gulfNotamZones.map((z) => ({ ...z, region: regionOfZone(z) }))
        : []),
      ...(layers.adsb
        ? adsbZones.map((z) => ({ ...z, region: regionOfZone(z) }))
        : []),
      ...(layers.adsb
        ? gulfAdsbZones.map((z) => ({ ...z, region: regionOfZone(z) }))
        : []),
      ...(layers.dipNav
        ? dipNavZones.map((z) => ({ ...z, region: regionOfZone(z) }))
        : []),
      ...(layers.dipNav
        ? gulfNavZones.map((z) => ({ ...z, region: regionOfZone(z) }))
        : []),
    ];
    for (const z of zoneList) {
      const c = zoneCenter(z);
      const layer: LayerKey =
        z.kind === "notam"
          ? "notam"
          : z.kind === "adsb_box"
            ? "adsb"
            : "dipNav";
      rows.push({
        id: `zone-${z.id}`,
        layer,
        region: z.region,
        title: z.label,
        subtitle:
          z.kind === "adsb_box"
            ? `${z.status} · empty ≠ not watching`
            : z.status === "warm" || z.status === "hot"
              ? `${z.kind.replace("_", " ")} · ${z.status.toUpperCase()}`
              : `${z.kind.replace("_", " ")} · ${z.status}`,
        lat: c.lat,
        lon: c.lon,
        color: zoneStrokeColor(z.kind),
        zoom: 7,
      });
    }

    if (layers.landmarks) {
      for (const lm of LANDMARKS) {
        rows.push({
          id: `lm-${lm.label}`,
          layer: "landmarks",
          region: lm.region,
          title: lm.label,
          subtitle: landmarkSubtitle(lm),
          lat: lm.lat,
          lon: lm.lon,
          color: lm.soft ? COLORS.landmarkSoft : COLORS.landmark,
          zoom: 8,
        });
      }
    }

    if (layers.kinetic && kinetic) {
      const activeId = kinetic.event?.target.id;
      for (const t of kinetic.targets) {
        if (t.role === "context" && t.id !== activeId) continue;
        rows.push({
          id: `kr-${t.id}`,
          layer: "kinetic",
          region: regionOfPoint(t.lat, t.lon),
          title: t.label,
          subtitle:
            t.id === activeId
              ? `ACTIVE · ${kinetic.honesty}`
              : `${t.role} · approx pin · not High-go`,
          lat: t.lat,
          lon: t.lon,
          color: t.id === activeId ? COLORS.kinetic : COLORS.landmarkSoft,
          zoom: 7,
        });
      }
      for (const h of kinetic.hits.slice(0, 12)) {
        rows.push({
          id: `kr-hit-${h.assetKey}`,
          layer: "kinetic",
          region: regionOfPoint(h.lat, h.lon),
          title: `${h.kind} ${h.assetKey.slice(0, 8)}`,
          subtitle: `${h.distKm.toFixed(0)} km${h.corridorTell ? " · corridor SOFT" : ""} · not High-go`,
          lat: h.lat,
          lon: h.lon,
          color: h.corridorTell ? COLORS.kinetic : COLORS.kineticHit,
          zoom: 8,
        });
      }
    }

    return rows;
  }, [
    layers,
    tracks,
    lastGoodTracks,
    aisPoints,
    firmsPoints,
    theaterStamps,
    notamZones,
    gulfNotamZones,
    adsbZones,
    gulfAdsbZones,
    dipNavZones,
    gulfNavZones,
    kinetic,
  ]);

  const levantRows = featureRows.filter((r) => r.region === "levant");
  const redSeaHornRows = featureRows.filter(
    (r) => r.region === "red_sea_horn",
  );
  const iraqBridgeRows = featureRows.filter(
    (r) => r.region === "iraq_bridge",
  );
  const gulfRows = featureRows.filter((r) => r.region === "gulf");
  const widerRows = featureRows.filter((r) => r.region === "wider");
  const regionCounts = {
    levant: levantRows.length,
    red_sea_horn: redSeaHornRows.length,
    iraq_bridge: iraqBridgeRows.length,
    gulf: gulfRows.length,
    wider: widerRows.length,
  };

  /** Per-region watching N boxes · M live · K stamps — even when live=0. */
  const regionWatchStatus = useMemo(() => {
    const allZones = [
      ...adsbZones,
      ...gulfAdsbZones,
      ...notamZones,
      ...gulfNotamZones,
      ...dipNavZones,
      ...gulfNavZones,
    ];
    const statusFor = (region: MapRegion) => {
      const boxes = allZones.filter(
        (z) => z.kind === "adsb_box" && regionOfZone(z) === region,
      ).length;
      const live =
        tracks.filter((t) => regionOfPoint(t.lat, t.lon) === region).length +
        theaterStamps.filter(
          (s) =>
            s.kind === "gulf_adsb" &&
            (s.region ?? regionOfPoint(s.lat, s.lon)) === region,
        ).length;
      const stamps = theaterStamps.filter((s) => {
        if (s.kind === "gulf_adsb") return false;
        return (s.region ?? regionOfPoint(s.lat, s.lon)) === region;
      }).length;
      const warmNotam = [...notamZones, ...gulfNotamZones].filter(
        (z) =>
          regionOfZone(z) === region &&
          (z.status === "warm" || z.status === "hot"),
      ).length;
      return { boxes, live, stamps, warmNotam };
    };
    return {
      levant: statusFor("levant"),
      red_sea_horn: statusFor("red_sea_horn"),
      iraq_bridge: statusFor("iraq_bridge"),
      gulf: statusFor("gulf"),
      wider: statusFor("wider"),
    };
  }, [
    adsbZones,
    gulfAdsbZones,
    notamZones,
    gulfNotamZones,
    dipNavZones,
    gulfNavZones,
    tracks,
    theaterStamps,
  ]);

  const manualArgCount = theaterStamps.filter(
    (s) => s.kind === "arg_manual",
  ).length;
  const widerAerial = theater?.aerial?.widerTheater;
  const gulfAerialNote =
    theater?.aerial != null
      ? `Gulf AER ${theater.aerial.tankerCount}t/${theater.aerial.awacsCount}a`
      : null;
  const widerAerialNote =
    widerAerial != null
      ? `Wider ${widerAerial.tankerCount}t/${widerAerial.awacsCount}a`
      : null;

  const ageSec = israelStrike?.inputs.aerialSampleAgeSec ?? null;
  const ageLabel = ageLabelSec(ageSec);

  const toggle = (key: LayerKey) =>
    setLayers((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      // When turning Gulf theater on with live ARG/Gulf stamps, jump to Iran/Gulf
      // so the desk isn't staring at Levant while Bataan lives off-frame.
      if (
        key === "theater" &&
        !prev.theater &&
        next.theater &&
        hasGulfCluster
      ) {
        setFocus(null);
        setFit((f) => ({
          mode: "gulf",
          nonce: (f?.nonce ?? 0) + 1,
        }));
      }
      return next;
    });

  const focusFeature = (row: FeatureRow) => {
    setSelectedId(row.id);
    // Clear preset so FitControl does not fight sidebar flyTo on later renders.
    setFit(null);
    setFocus((prev) => ({
      lat: row.lat,
      lon: row.lon,
      zoom: row.zoom ?? 8,
      nonce: (prev?.nonce ?? 0) + 1,
    }));
  };

  const emptyLayers = LAYER_LABELS.filter(([key]) => layerCounts[key] === 0);

  const renderFeatureList = (rows: FeatureRow[]) =>
    rows.length === 0 ? (
      <p className="muted tiny">None plotted.</p>
    ) : (
      <ul className="osint-map-feature-list">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              className={`osint-map-feature${selectedId === row.id ? " active" : ""}`}
              onClick={() => focusFeature(row)}
            >
              <span
                className="osint-map-feature-dot"
                style={{ background: row.color }}
              />
              <span className="osint-map-feature-text">
                <span className="osint-map-feature-title">{row.title}</span>
                <span className="osint-map-feature-sub">{row.subtitle}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="osint-map">
      <aside className="osint-map-chrome" aria-label="Map layers">
        <div className="osint-map-chrome-top">
          <p className="eyebrow">OSINT map · OSM</p>
          <div className="osint-map-chrome-actions">
            <button
              type="button"
              className="ghost chrome-btn osint-map-copy-all"
              onClick={() => void copyDisplayedAssets()}
              title="Copy every asset currently shown on the map"
            >
              {copyFlash ?? "Copy displayed assets"}
            </button>
          </div>
          <p className="muted tiny">
            {tracks.length} live ADS-B
            {tracks.filter((t) => t.followed).length
              ? ` · ${tracks.filter((t) => t.followed).length} followed`
              : ""}
            {lastGoodTracks.length
              ? ` · ${lastGoodTracks.length} last-good`
              : ""}
            {` · ${aisPoints.length} AIS`}
            {` · ${theaterStamps.length} theater`}
            {manualArgCount ? ` (${manualArgCount} manual ARG)` : ""}
            {` · ${firmsPoints.length} FIRMS`}
            {` · ${zones.length + theaterZones.length} zones`}
            {` · Levant ${regionCounts.levant} · Red Sea/Horn ${regionCounts.red_sea_horn} · Iraq ${regionCounts.iraq_bridge} · Gulf ${regionCounts.gulf} · Wider ${regionCounts.wider}`}
            {gulfAerialNote ? ` · ${gulfAerialNote}` : ""}
            {widerAerialNote ? ` · ${widerAerialNote}` : ""}
            {overlays?.notamStatus && overlays.notamStatus !== "quiet"
              ? ` · NOTAM ${overlays.notamStatus.toUpperCase()}`
              : ""}
            {theater?.mapOverlays?.radioHoleStatus &&
            theater.mapOverlays.radioHoleStatus !== "quiet"
              ? ` · radio_hole ${String(theater.mapOverlays.radioHoleStatus).toUpperCase()}`
              : " · Gulf NOTAM quiet"}
            {` · aerial ${ageLabel}`}
            {israelStrike?.inputs.aerialFeedOk === false
              ? " · last-good / degraded"
              : ""}
            {theaterError
              ? ` · theater deferred (${theaterError.slice(0, 48)})`
              : ""}
            {theater && gulfAdsbZonesRaw.length === 0
              ? " · ADS-B boxes deferred"
              : ""}
          </p>
          <p className="muted tiny">
            Watching tiled airspace across wide theater; Israel High-go still
            Levant-gated. Military hexes enrolled anywhere Med→Gulf→Horn stay
            FOLLOWED after they leave the tiles.
            {kinetic?.event
              ? ` Kinetic: ${kinetic.event.target.label} · ${kinetic.honesty}`
              : " Kinetic layer = named-base pins + archive rewind (not High-go)."}
          </p>
        </div>

        <div className="osint-map-toggles">
          {LAYER_LABELS.map(([key, label]) => (
            <label key={key} className="osint-map-toggle">
              <input
                type="checkbox"
                checked={layers[key]}
                onChange={() => toggle(key)}
              />
              <span>
                {label}
                <span
                  className={`osint-map-count${layerCounts[key] === 0 ? " empty" : ""}`}
                >
                  {layerCounts[key]}
                </span>
              </span>
            </label>
          ))}
        </div>

        <div className="osint-map-fit">
          <button
            type="button"
            className="ghost chrome-btn osint-map-comprehensive"
            onClick={() => applyComprehensivePreset()}
            title="Enable all layers · Wide theater bounds (comprehensive desk view)"
          >
            Comprehensive
          </button>
          <button
            type="button"
            className={`ghost chrome-btn${fit?.mode === "levant" ? " active" : ""}`}
            onClick={() => requestFit("levant")}
          >
            Levant
          </button>
          <button
            type="button"
            className={`ghost chrome-btn${fit?.mode === "gulf" ? " active" : ""}`}
            onClick={() => requestFit("gulf")}
            title="Iran / Persian Gulf / Hormuz"
          >
            Iran / Gulf
          </button>
          <button
            type="button"
            className={`ghost chrome-btn${fit?.mode === "theater" ? " active" : ""}`}
            onClick={() => requestFit("theater")}
            title="Wide theater ~10°E–80°E · 5°S–45°N (Med → Arabian Sea)"
          >
            Wide theater
          </button>
          <button
            type="button"
            className={`ghost chrome-btn${fit?.mode === "followed" ? " active" : ""}`}
            onClick={() => requestFit("followed")}
            title="Fit map to FOLLOWED hexes that left the Levant scoring boxes"
          >
            Followed
          </button>
          <button
            type="button"
            className={`ghost chrome-btn${fit?.mode === "all" ? " active" : ""}`}
            onClick={() => requestFit("all")}
            title="Fit all active features (ADS-B boxes + landmarks)"
          >
            Fit all
          </button>
          <button
            type="button"
            className={`ghost chrome-btn${basemap === "dark" ? " active" : ""}`}
            onClick={() => setBasemap("dark")}
            title="CARTO dark basemap"
          >
            Dark map
          </button>
          <button
            type="button"
            className={`ghost chrome-btn${basemap === "osm" ? " active" : ""}`}
            onClick={() => setBasemap("osm")}
            title="OpenStreetMap basemap"
          >
            OSM
          </button>
          {onRefreshAerial ? (
            <button
              type="button"
              className="ghost chrome-btn"
              onClick={() => onRefreshAerial()}
            >
              Refresh aerial
            </button>
          ) : null}
        </div>

        <ul className="osint-map-legend">
          <li>
            <span className="osint-map-swatch tanker" /> Tanker (live)
          </li>
          <li>
            <span className="osint-map-swatch awacs" /> AWACS / E-6B
          </li>
          <li>
            <span className="osint-map-swatch last-good" /> Last-good / stale
          </li>
          <li>
            <span className="osint-map-swatch followed" /> Followed outbound
          </li>
          <li>
            <span className="osint-map-swatch mil" /> Other mil
          </li>
          <li>
            <span className="osint-map-swatch ais" /> AIS vessel
          </li>
          <li>
            <span className="osint-map-swatch arg" /> ARG / IRONSIGHT
          </li>
          <li>
            <span className="osint-map-swatch arg-manual" /> Manual ARG
          </li>
          <li>
            <span className="osint-map-swatch ssgn" /> Florida / SSGN
          </li>
          <li>
            <span className="osint-map-swatch gulf" /> Gulf ADS-B
          </li>
          <li>
            <span className="osint-map-swatch firms" /> FIRMS (coords only)
          </li>
          <li>
            <span className="osint-map-swatch notam" /> NOTAM approx FIR
          </li>
          <li>
            <span className="osint-map-swatch kinetic" /> Kinetic pin / rewind
          </li>
        </ul>

        <div className="osint-map-inventory" aria-label="Plotted features">
          <p className="osint-map-inventory-head">
            Plotted · {featureRows.length}
            <span className="osint-map-region-counts">
              {" "}
              · Levant {regionCounts.levant} · Red Sea/Horn{" "}
              {regionCounts.red_sea_horn} · Iraq {regionCounts.iraq_bridge} ·
              Gulf {regionCounts.gulf} · Wider {regionCounts.wider}
            </span>
          </p>
          {emptyLayers.length > 0 ? (
            <p className="muted tiny osint-map-empty-note">
              Empty:{" "}
              {emptyLayers
                .map(
                  ([key]) =>
                    `${LAYER_LABELS.find((x) => x[0] === key)?.[1] ?? key} (0)`,
                )
                .join(" · ")}
            </p>
          ) : null}
          <p className="muted tiny osint-map-empty-note">{firmsNote}</p>
          {layers.aerial && (tracks.length > 0 || lastGoodTracks.length > 0) ? (
            <p className="muted tiny osint-map-empty-note">
              Levant AER-01: {tracks.filter((t) => !t.followed).length} live
              {tracks.filter((t) => t.followed).length
                ? ` · ${tracks.filter((t) => t.followed).length} FOLLOWED outbound`
                : ""}
              {lastGoodTracks.length
                ? ` · ${lastGoodTracks.length} DARK/LAST-KNOWN (≤30m tankers / 20m mil)`
                : ""}
              {israelStrike?.inputs.aerialTankersLevant != null
                ? ` · ${israelStrike.inputs.aerialTankersLevant}t/${israelStrike.inputs.aerialAwacsLevant ?? 0}a scored`
                : ""}
            </p>
          ) : null}
          {theater?.aerial ? (
            <p className="muted tiny osint-map-empty-note">
              Gulf regime: {theater.aerial.tankerCount}t/
              {theater.aerial.awacsCount}a ({theater.aerial.regime})
              {theaterStamps.filter((s) => s.kind === "gulf_adsb" && s.stale)
                .length
                ? ` · ${theaterStamps.filter((s) => s.kind === "gulf_adsb" && s.stale).length} DARK/LAST-KNOWN (≤30m tankers)`
                : ""}
              {widerAerial
                ? ` · Wider plot-only: ${widerAerial.tankerCount}t/${widerAerial.awacsCount}a`
                : ""}
            </p>
          ) : null}
          {featureRows.length === 0 ? (
            <p className="muted tiny">
              No features on with current layers — toggles above show 0 counts
              when feeds are quiet.
            </p>
          ) : (
            <>
              {(
                [
                  ["levant", levantRows],
                  ["red_sea_horn", redSeaHornRows],
                  ["iraq_bridge", iraqBridgeRows],
                  ["gulf", gulfRows],
                  ["wider", widerRows],
                ] as const
              ).map(([key, rows]) => {
                const ws = regionWatchStatus[key];
                return (
                  <Fragment key={key}>
                    <p className="osint-map-region-head">
                      {REGION_LABELS[key]} · {rows.length}
                    </p>
                    <p className="muted tiny osint-map-region-watch">
                      watching {ws.boxes} box
                      {ws.boxes === 1 ? "" : "es"} · {ws.live} live ·{" "}
                      {ws.stamps} stamp{ws.stamps === 1 ? "" : "s"}
                      {ws.warmNotam
                        ? ` · ${ws.warmNotam} NOTAM lit`
                        : ""}
                    </p>
                    {renderFeatureList(rows)}
                  </Fragment>
                );
              })}
            </>
          )}
        </div>

        <p className="muted tiny osint-map-honesty">
          Default view: Wide theater (~10°E–80°E · 5°S–45°N). Watching tiled
          airspace across wide theater (Iraq / Syria bridge / Saudi / Iran /
          Red Sea / Horn / Arabian / Gulf); Israel High-go still Levant-gated.
          Levant zooms the Israel desk; Iran/Gulf centers Hormuz. AER-01 High-go
          uses Levant/Med ADS-B only — Iraq/Iran/Saudi/Somali/Red Sea tankers
          never print Israel go. Gulf mass_stack / 5-Lock uses Gulf/Hormuz box
          only; all other theater samples are plot + awareness.           OpenStreetMap or CARTO dark basemap. NOTAM / NAVWARN boxes are heuristic FIR approximations from
          RSS — not official geometry (Iraq/Baghdad FIR soft zone separate from
          Gulf radio_hole and AER-02). Military often dark on free ADS-B.
          IRONSIGHT naval stamps (ARG / SSGN / CSG / other) only when lat/lon
          exists — no invented GPS. SOG/course stamp when IRONSIGHT ships
          payload includes kinematics (today usually unavailable — static OSINT).
          Manual ARG pins require operator lat+lon (5-Lock / Intel). ADS-B
          LAST-GOOD holds dropped tankers/AWACS ~30m (other mil ~20m). IRONSIGHT naval
          DARK/LAST-KNOWN ~4h. Sticky pins are awareness only.
          Theater archive (`osint-theater.db`) stores samples 90d / peaks 365d —
          scrubber REPLAY is forward-only history (not a backfill of lost nights).
          FIRMS only when IRONSIGHT returns fire coords ({firmsNote}).
          Natanz/Fordow/Bosaso/Karachi and soft city landmarks (Baghdad, Tehran,
          Jeddah, …) are context only — not go-gates. East Africa Cape is soft
          freight only.
          {theater?.mapOverlays?.radioHoleStatus &&
          theater.mapOverlays.radioHoleStatus !== "quiet"
            ? ` · radio_hole ${String(theater.mapOverlays.radioHoleStatus).toUpperCase()}`
            : ""}
          {theaterError ? ` Theater: ${theaterError.slice(0, 80)}` : ""}
        </p>
      </aside>

      <div className={`osint-map-stage${liveMode ? "" : " replay"}`}>
        <div className="osint-map-stage-actions">
          <button
            type="button"
            className="ghost chrome-btn osint-map-copy-all osint-map-copy-float"
            onClick={() => void copyDisplayedAssets()}
            title="Copy every asset currently shown on the map"
          >
            {copyFlash ?? "Copy displayed assets"}
          </button>
        </div>
        <MapContainer
          className={`osint-map-leaflet${basemap === "dark" ? " basemap-dark" : " basemap-osm"}`}
          center={THEATER_CENTER}
          zoom={DEFAULT_ZOOM}
          minZoom={3}
          maxZoom={12}
          worldCopyJump={false}
          attributionControl
        >
          <MapResizeFix />
          <FitControl fit={fit} />
          <FocusControl focus={focus} />
          {basemap === "dark" ? (
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />
          ) : (
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          )}

          {layers.adsb &&
            [...adsbZones, ...gulfAdsbZones].map((z) => {
              const c = zoneCenter(z);
              return (
                <Fragment key={z.id}>
                  <Rectangle
                    bounds={zoneBounds(z)}
                    pathOptions={{
                      color: ZONE_COLORS.adsb_box.stroke,
                      fillColor: ZONE_COLORS.adsb_box.fill,
                      fillOpacity: 1,
                      weight: STATUS_WEIGHT[z.status] + 0.8,
                      dashArray: z.status === "failed" ? "5 4" : undefined,
                    }}
                  >
                    <Tooltip sticky>
                      {z.label} · {z.status}
                    </Tooltip>
                  </Rectangle>
                  <Marker
                    position={[c.lat, c.lon]}
                    icon={zoneLabelIcon(z.label, ZONE_COLORS.adsb_box.stroke)}
                    interactive={false}
                  />
                </Fragment>
              );
            })}

          {layers.dipNav &&
            [...dipNavZones, ...gulfNavZones].map((z) => {
              const c = zoneCenter(z);
              return (
                <Fragment key={z.id}>
                  <Rectangle
                    bounds={zoneBounds(z)}
                    pathOptions={{
                      color: ZONE_COLORS[z.kind].stroke,
                      fillColor: ZONE_COLORS[z.kind].fill,
                      fillOpacity: 1,
                      weight: STATUS_WEIGHT[z.status] + 0.8,
                    }}
                  >
                    <Tooltip sticky>
                      {z.label} · {z.status}
                      {z.titles?.[0] ? ` · ${z.titles[0].slice(0, 80)}` : ""}
                    </Tooltip>
                  </Rectangle>
                  <Marker
                    position={[c.lat, c.lon]}
                    icon={zoneLabelIcon(z.label, ZONE_COLORS[z.kind].stroke)}
                    interactive={false}
                  />
                </Fragment>
              );
            })}

          {layers.notam &&
            [...notamZones, ...gulfNotamZones].map((z) => {
              const c = zoneCenter(z);
              const lit = z.status === "warm" || z.status === "hot";
              return (
                <Fragment key={z.id}>
                  <Rectangle
                    bounds={zoneBounds(z)}
                    pathOptions={{
                      color: ZONE_COLORS.notam.stroke,
                      fillColor: ZONE_COLORS.notam.fill,
                      fillOpacity: 1,
                      weight: STATUS_WEIGHT[z.status] + (lit ? 2.4 : 1.2),
                    }}
                  >
                    <Popup>
                      <strong>NOTAM · {z.label}</strong>
                      <br />
                      {z.status.toUpperCase()}
                      {z.titles?.length ? (
                        <ul>
                          {z.titles.slice(0, 4).map((t) => (
                            <li key={t}>{t}</li>
                          ))}
                        </ul>
                      ) : null}
                      <p className="muted tiny">
                        Approx FIR box — not official NOTAM geometry
                      </p>
                    </Popup>
                    <Tooltip sticky>
                      NOTAM {z.label} · {z.status}
                    </Tooltip>
                  </Rectangle>
                  <Marker
                    position={[c.lat, c.lon]}
                    icon={zoneLabelIcon(
                      `NOTAM ${z.label}`,
                      ZONE_COLORS.notam.stroke,
                    )}
                    interactive={false}
                  />
                </Fragment>
              );
            })}

          {layers.landmarks &&
            LANDMARKS.map((lm) => (
              <CircleMarker
                key={lm.label}
                center={[lm.lat, lm.lon]}
                radius={lm.soft ? 5 : 6}
                pathOptions={{
                  color: "rgba(231, 239, 232, 0.95)",
                  fillColor: lm.soft
                    ? "rgba(168, 181, 174, 0.85)"
                    : "rgba(207, 216, 209, 0.95)",
                  fillOpacity: 1,
                  weight: 2,
                  dashArray: lm.soft ? "2 3" : undefined,
                }}
              >
                <Tooltip
                  direction="right"
                  offset={[8, 0]}
                  permanent
                  className={`osint-map-label landmark${lm.soft ? " soft" : ""}`}
                >
                  {lm.soft ? `${lm.label} · context` : lm.label}
                </Tooltip>
              </CircleMarker>
            ))}

          {layers.kinetic && kinetic?.event ? (
            <>
              <Circle
                center={[kinetic.event.target.lat, kinetic.event.target.lon]}
                radius={400_000}
                pathOptions={{
                  color: COLORS.kinetic,
                  weight: 1,
                  dashArray: "7 8",
                  fillColor: COLORS.kinetic,
                  fillOpacity: 0.05,
                }}
              />
              <Circle
                center={[kinetic.event.target.lat, kinetic.event.target.lon]}
                radius={Math.max(4, kinetic.event.target.radiusKm) * 1000}
                pathOptions={{
                  color: COLORS.kinetic,
                  weight: 2,
                  fillColor: COLORS.kinetic,
                  fillOpacity: 0.18,
                }}
              />
            </>
          ) : null}

          {layers.kinetic &&
            (kinetic?.corridorTells.length ?? 0) > 0 && (
              <Rectangle
                bounds={[
                  [30, 36.01],
                  [33, 39.5],
                ]}
                pathOptions={{
                  color: COLORS.kineticHit,
                  weight: 1.4,
                  dashArray: "4 5",
                  fillColor: COLORS.kineticHit,
                  fillOpacity: 0.08,
                }}
              >
                <Tooltip
                  direction="center"
                  permanent
                  className="osint-map-label kinetic soft"
                >
                  Jordan-east corridor · SOFT · not High-go
                </Tooltip>
              </Rectangle>
            )}

          {layers.kinetic &&
            kinetic?.targets.map((t) => {
              const active = kinetic.event?.target.id === t.id;
              if (t.role === "context" && !active) return null;
              return (
                <CircleMarker
                  key={`kr-${t.id}`}
                  center={[t.lat, t.lon]}
                  radius={active ? 8 : t.role === "kinetic" ? 6 : 5}
                  pathOptions={{
                    color: active ? "#f5d0c4" : "rgba(231, 239, 232, 0.7)",
                    fillColor: active
                      ? COLORS.kinetic
                      : t.role === "kinetic"
                        ? "rgba(224, 112, 80, 0.85)"
                        : "rgba(168, 181, 174, 0.8)",
                    fillOpacity: 1,
                    weight: active ? 2 : 1,
                    dashArray: active ? undefined : "2 3",
                  }}
                >
                  <Popup>
                    <strong>{t.label}</strong>
                    <br />
                    {t.note}
                    <br />
                    {t.lat.toFixed(2)}N {t.lon.toFixed(2)}E · approx pin
                    <br />
                    {kinetic.honesty}
                  </Popup>
                  <Tooltip
                    direction="right"
                    offset={[8, 0]}
                    permanent={active}
                    className={`osint-map-label kinetic${active ? "" : " soft"}`}
                  >
                    {active ? `${t.label} · STRIKE` : t.label}
                  </Tooltip>
                </CircleMarker>
              );
            })}

          {layers.kinetic &&
            kinetic?.hits.slice(0, 12).map((h) => {
              const hdg = headingLine(h.lat, h.lon, h.trackDeg, 0.4);
              const color = h.corridorTell ? COLORS.kinetic : COLORS.kineticHit;
              return (
                <Fragment key={`krh-${h.assetKey}-${h.ts}`}>
                  {hdg ? (
                    <Polyline
                      positions={hdg}
                      pathOptions={{ color, weight: 2, opacity: 0.85 }}
                    />
                  ) : null}
                  <CircleMarker
                    center={[h.lat, h.lon]}
                    radius={7}
                    pathOptions={{
                      color: "#0a100e",
                      fillColor: color,
                      fillOpacity: 1,
                      weight: 2,
                    }}
                  >
                    <Popup>
                      <strong>
                        {h.kind} {h.assetKey.slice(0, 8)}
                      </strong>
                      <br />
                      {h.distKm.toFixed(0)} km from pin
                      {h.trackDeg != null
                        ? ` · hdg ${Math.round(h.trackDeg)}°`
                        : ""}
                      <br />
                      {h.ts}
                      {h.corridorTell ? " · Jordan-east SOFT" : ""}
                      <br />
                      {kinetic.honesty}
                    </Popup>
                    <Tooltip
                      direction="top"
                      offset={[0, -6]}
                      className="osint-map-label kinetic"
                    >
                      {h.kind} · {h.distKm.toFixed(0)} km
                    </Tooltip>
                  </CircleMarker>
                </Fragment>
              );
            })}

          {liveMode && layers.ais &&
            aisPoints.map((p: MapPoint) => {
              const hdg = headingLine(p.lat, p.lon, p.cog, 0.35);
              const color = aisColor(p.category);
              return (
                <Fragment key={p.id}>
                  {hdg ? (
                    <Polyline
                      positions={hdg}
                      pathOptions={{
                        color,
                        weight: 3,
                        opacity: 0.9,
                      }}
                    />
                  ) : null}
                  <CircleMarker
                    center={[p.lat, p.lon]}
                    radius={8}
                    pathOptions={{
                      color: "#0a100e",
                      fillColor: color,
                      fillOpacity: 1,
                      weight: 2,
                    }}
                  >
                    <Popup>
                      <strong>{p.label}</strong>
                      <br />
                      AIS {p.category}
                      <br />
                      {p.lat.toFixed(3)}, {p.lon.toFixed(3)}
                      {p.sog != null ? ` · ${p.sog.toFixed(1)} kt` : ""}
                      {p.cog != null ? ` · cog ${Math.round(p.cog)}°` : ""}
                    </Popup>
                    <Tooltip
                      direction="top"
                      offset={[0, -6]}
                      permanent
                      className="osint-map-label ais"
                    >
                      {p.label}
                    </Tooltip>
                  </CircleMarker>
                </Fragment>
              );
            })}

          {liveMode && layers.theater &&
            theaterStamps.map((s) => {
              const isManual = s.kind === "arg_manual" || s.manual === true;
              const isDark = s.stale === true;
              const color = isDark ? COLORS.lastGood : stampColor(s.kind);
              const hdg = headingLine(
                s.lat,
                s.lon,
                s.courseDeg ?? null,
                0.45,
              );
              const statusBit = isDark
                ? "DARK / LAST-KNOWN"
                : isManual
                  ? "MANUAL"
                  : "LIVE";
              return (
                <Fragment key={s.id}>
                  {hdg ? (
                    <Polyline
                      positions={hdg}
                      pathOptions={{
                        color,
                        weight: 3,
                        opacity: isDark ? 0.65 : 0.95,
                        dashArray: isManual || isDark ? "4 4" : undefined,
                      }}
                    />
                  ) : null}
                  <CircleMarker
                    center={[s.lat, s.lon]}
                    radius={
                      s.kind === "arg" ||
                      s.kind === "arg_manual" ||
                      s.kind === "ssgn" ||
                      s.kind === "csg"
                        ? 12
                        : 9
                    }
                    pathOptions={{
                      color: isManual || isDark ? color : "#0a100e",
                      fillColor: color,
                      fillOpacity: isManual || isDark ? 0.75 : 1,
                      weight: isManual || isDark ? 3 : 2.5,
                      dashArray: isManual || isDark ? "3 2" : undefined,
                    }}
                  >
                    <Popup>
                      <strong>{s.label}</strong>
                      <br />
                      {stampKindLabel(s.kind)} · {statusBit}
                      {isDark && s.ageSec != null
                        ? ` · ${ageLabelSec(s.ageSec)}`
                        : ""}
                      <br />
                      {s.lat.toFixed(3)}, {s.lon.toFixed(3)}
                      {s.meta ? (
                        <>
                          <br />
                          {s.meta}
                        </>
                      ) : null}
                      {isDark ? (
                        <>
                          <br />
                          <span className="muted">
                            Awareness only — not High-go / 5-Lock
                          </span>
                        </>
                      ) : null}
                    </Popup>
                    <Tooltip
                      direction="top"
                      offset={[0, -8]}
                      permanent
                      className={`osint-map-label theater${isManual ? " manual" : ""}${isDark ? " last-good" : ""}`}
                    >
                      {isDark
                        ? `${s.label} · DARK`
                        : isManual
                          ? `${s.label} · MANUAL`
                          : s.label}
                    </Tooltip>
                  </CircleMarker>
                </Fragment>
              );
            })}

          {liveMode && layers.firms &&
            firmsPoints.map((p: FirmsPoint) => (
              <CircleMarker
                key={p.id}
                center={[p.lat, p.lon]}
                radius={7}
                pathOptions={{
                  color: "#0a100e",
                  fillColor: COLORS.firms,
                  fillOpacity: 0.95,
                  weight: 2,
                }}
              >
                <Popup>
                  <strong>{p.label}</strong>
                  <br />
                  FIRMS {p.box}
                  <br />
                  {p.lat.toFixed(3)}, {p.lon.toFixed(3)}
                  {p.acqDate ? (
                    <>
                      <br />
                      {p.acqDate}
                    </>
                  ) : null}
                </Popup>
                <Tooltip
                  direction="top"
                  offset={[0, -6]}
                  permanent
                  className="osint-map-label firms"
                >
                  {p.label}
                </Tooltip>
              </CircleMarker>
            ))}

          {liveMode && layers.aerial &&
            lastGoodTracks.map((t: AerialLastGoodTrack) => {
              const trail: LatLngExpression[] = t.trail.map((p) => [
                p.lat,
                p.lon,
              ]);
              return (
                <Fragment key={`lg-${t.hex}`}>
                  {trail.length >= 2 ? (
                    <Polyline
                      positions={trail}
                      pathOptions={{
                        color: COLORS.lastGood,
                        weight: 2,
                        opacity: 0.45,
                        dashArray: "4 6",
                      }}
                    />
                  ) : null}
                  <CircleMarker
                    center={[t.lat, t.lon]}
                    radius={9}
                    pathOptions={{
                      color: COLORS.lastGood,
                      fillColor: COLORS.lastGood,
                      fillOpacity: 0.55,
                      weight: 2,
                      dashArray: "3 3",
                    }}
                  >
                    <Popup>
                      <strong>{t.callsign}</strong> · DARK / LAST-KNOWN
                      <br />
                      {formatAerialAssetLine({ ...t, stale: true })}
                      <br />
                      Sticky until ~30m (tankers/AWACS) / ~20m (other mil) after last ADS-B ping
                    </Popup>
                    <Tooltip
                      direction="top"
                      offset={[0, -8]}
                      permanent
                      className="osint-map-label aerial last-good"
                    >
                      {formatAerialAssetShort({ ...t, stale: true })}
                    </Tooltip>
                  </CircleMarker>
                </Fragment>
              );
            })}

          {liveMode && layers.aerial &&
            tracks.map((t: AerialTrack) => {
              const trail: LatLngExpression[] = t.trail.map((p) => [
                p.lat,
                p.lon,
              ]);
              const hdg = headingLine(t.lat, t.lon, t.trackDeg, 0.65);
              const color = t.followed ? COLORS.followed : kindColor(t.kind);
              return (
                <Fragment key={t.hex}>
                  {trail.length >= 2 ? (
                    <Polyline
                      positions={trail}
                      pathOptions={{
                        color,
                        weight: t.followed ? 2.5 : 3,
                        opacity: 0.7,
                        dashArray: t.followed ? "6 4" : undefined,
                      }}
                    />
                  ) : null}
                  {hdg ? (
                    <Polyline
                      positions={hdg}
                      pathOptions={{ color, weight: 3.5, opacity: 1 }}
                    />
                  ) : null}
                  <CircleMarker
                    center={[t.lat, t.lon]}
                    radius={t.followed ? 11 : 10}
                    pathOptions={{
                      color: t.followed ? COLORS.followed : "#0a100e",
                      fillColor: kindColor(t.kind),
                      fillOpacity: 1,
                      weight: t.followed ? 3 : 2.5,
                      dashArray: t.followed ? "4 3" : undefined,
                    }}
                  >
                    <Popup>
                      <strong>{t.callsign}</strong>
                      {t.followed ? " · FOLLOWED outbound" : ""}
                      <br />
                      {formatAerialAssetLine(t)}
                      <br />
                      {t.followed
                        ? "Enrolled in Levant — still transmitting outside scoring boxes (not AER-01)."
                        : t.bearingHint}
                      {t.desc ? (
                        <>
                          <br />
                          <span className="muted">{t.desc}</span>
                        </>
                      ) : null}
                    </Popup>
                    <Tooltip
                      direction="top"
                      offset={[0, -8]}
                      permanent
                      className={`osint-map-label aerial${t.followed ? " followed" : ""}`}
                    >
                      {formatAerialAssetShort(t)}
                    </Tooltip>
                  </CircleMarker>
                </Fragment>
              );
            })}

          {!liveMode &&
            replaySamples.map((s) => {
              const color = s.stale
                ? COLORS.lastGood
                : replayKindColor(s.kind);
              const showAerial =
                layers.aerial &&
                (s.kind === "tanker" ||
                  s.kind === "awacs" ||
                  s.kind === "mil" ||
                  s.kind === "e6b");
              const showAis = layers.ais && s.kind === "ais";
              const showFirms = layers.firms && s.kind === "firms";
              const showTheater =
                layers.theater &&
                (s.kind === "arg" ||
                  s.kind === "arg_manual" ||
                  s.kind === "ssgn" ||
                  s.kind === "csg" ||
                  s.kind === "naval" ||
                  s.kind === "gulf_adsb");
              if (!showAerial && !showAis && !showFirms && !showTheater) {
                return null;
              }
              const hdg = headingLine(s.lat, s.lon, s.trackDeg, 0.5);
              return (
                <Fragment key={`${s.assetKey}-${s.ts}`}>
                  {hdg ? (
                    <Polyline
                      positions={hdg}
                      pathOptions={{
                        color,
                        weight: 2,
                        opacity: 0.75,
                        dashArray: s.stale ? "4 4" : undefined,
                      }}
                    />
                  ) : null}
                  <CircleMarker
                    center={[s.lat, s.lon]}
                    radius={9}
                    pathOptions={{
                      color: s.stale ? color : "#0a100e",
                      fillColor: color,
                      fillOpacity: s.stale ? 0.6 : 1,
                      weight: 2,
                      dashArray: s.stale ? "3 3" : undefined,
                    }}
                  >
                    <Popup>
                      <strong>{s.label || s.assetKey}</strong> · REPLAY
                      <br />
                      {s.kind}
                      {s.stale ? " · stale" : ""}
                      <br />
                      {s.lat.toFixed(3)}, {s.lon.toFixed(3)}
                      <br />
                      {new Date(s.ts).toLocaleString()}
                    </Popup>
                    <Tooltip
                      direction="top"
                      offset={[0, -8]}
                      permanent
                      className="osint-map-label aerial"
                    >
                      {s.label || s.kind} · REPLAY
                    </Tooltip>
                  </CircleMarker>
                </Fragment>
              );
            })}
        </MapContainer>

        <div className="osint-map-scrubber" aria-label="Archive time scrubber">
          <div className="osint-map-scrubber-top">
            <span
              className={`osint-map-mode-badge${liveMode ? " live" : " replay"}`}
            >
              {liveMode ? "LIVE" : "REPLAY"}
            </span>
            <span className="muted tiny">
              {liveMode
                ? "Space stays LIVE · ←/→ scrub history"
                : `${new Date(scrubMs).toLocaleString()}${
                    replayLoading ? " · loading…" : ` · ${replaySamples.length} assets`
                  }`}
            </span>
            <button
              type="button"
              className="ghost chrome-btn"
              onClick={goLive}
              disabled={liveMode}
            >
              Return LIVE
            </button>
          </div>
          {peakSpark ? (
            <svg
              className="osint-map-peak-spark"
              viewBox={`0 0 ${peakSpark.w} ${peakSpark.h}`}
              width="100%"
              height={peakSpark.h}
              aria-label="Levant tanker/AWACS peaks"
              onClick={(e) => {
                const rect = (
                  e.currentTarget as SVGSVGElement
                ).getBoundingClientRect();
                const frac = Math.min(
                  1,
                  Math.max(0, (e.clientX - rect.left) / rect.width),
                );
                const t =
                  archiveRange.oldest +
                  frac * (archiveRange.newest - archiveRange.oldest);
                enterReplayAt(t);
              }}
            >
              <polyline
                fill="none"
                stroke="rgba(196, 163, 90, 0.9)"
                strokeWidth="1.5"
                points={peakSpark.pts}
              />
            </svg>
          ) : (
            <p className="muted tiny osint-map-scrubber-empty">
              {archiveStatus?.enabled
                ? `Archive ${archiveStatus.assetRows} samples · peaks fill as Levant aerial refreshes`
                : "OSINT archive warming up…"}
            </p>
          )}
          <input
            type="range"
            className="osint-map-scrubber-range"
            min={archiveRange.oldest}
            max={archiveRange.newest}
            step={60_000}
            value={liveMode ? archiveRange.newest : scrubMs}
            onChange={(e) => {
              enterReplayAt(Number(e.target.value));
            }}
            aria-label="Scrub archive time"
          />
          <div className="osint-map-scrubber-ends muted tiny">
            <span>
              {archiveStatus?.oldestSampleAt
                ? new Date(archiveStatus.oldestSampleAt).toLocaleString()
                : "—"}
            </span>
            <span>
              {archiveStatus?.newestSampleAt
                ? new Date(archiveStatus.newestSampleAt).toLocaleString()
                : "now"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
