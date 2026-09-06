import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getStockQuote, getOptionsChain, type StockQuote } from "./market";
import { fetchBdtiSeries } from "./analytics/bdti";
import {
  buildPoliticsCalendarChip,
  type PoliticsCalendarChip,
} from "./analytics/politicsCalendar";
import { classifyNavwarnItems } from "./analytics/navwarnClassifier";
import {
  buildEastAfricaCapeState,
  emptyEastAfricaCape,
  EAST_AFRICA_RSS_QUERIES,
  type EastAfricaCapeState,
} from "./analytics/eastAfricaCape";
import {
  fetchAdsbLol,
  fetchAdsbMil,
  rotateTheaterBoxes,
  adsbLolBackingOff,
  type AdsbAc,
} from "./adsbLol";
import {
  fetchOpenSkyBbox,
  OPENSKY_GULF_BBOX,
  openSkyLooksMilCallsign,
} from "./opensky";
import {
  EXTRA_NAVWARN_RSS_QUERIES,
  EXTRA_NOTAM_RSS_QUERIES_GULF,
  fetchAwcMeSigmetItems,
  fetchEurocontrolAviationRss,
  mergeAviationNews,
} from "./aviationText";
import { serveLastGood } from "./lastGoodServe";
import { readLastGood, writeLastGood } from "./lastGoodStore";
import { singleFlight } from "./singleFlight";
import { fetchIfIronsightUp } from "./ironsightHealth";
import {
  archiveE6bSamples,
  archiveMapZones,
  archiveNavalStamps,
  archiveTheaterAerial,
} from "./osintArchive";
import {
  isAerialTanker,
  isAwacs,
  isCivOrVipAirframe,
} from "./analytics/aerialClassify";
import {
  collectWatchlistLastGood,
  enrollWideTheaterWatch,
  fetchAdsbHex,
  inLevantStrikeBox,
  inWideTheaterFootprint,
  isWatchedHex,
  looksLanded,
  missingHighValueHexes,
  missingWatchHexes,
  normalizeHex,
  pickFollowLookups,
  shouldEnroll,
  stickyDisplayTtlMs,
} from "./analytics/aerialFollow";
import { getTheaterAisSnapshot } from "./aisstreamCyprus";

/** Rome walkout arm disabled — next round September; always calendar_gap. */
export const ROME_WALKOUT_REGIME = "calendar_gap" as const;

export function romeTalksRegime(): typeof ROME_WALKOUT_REGIME {
  return ROME_WALKOUT_REGIME;
}

/** Persian Gulf / Strait of Hormuz — counts toward mass_stack / 5-Lock aerial. */
const GULF_BBOX = { latMin: 23.0, latMax: 31.0, lonMin: 47.5, lonMax: 61.5 };

/**
 * Wide-theater ADS-B sample boxes (~screenshot scale: ~10°E–80°E · 5°S–45°N).
 *
 * Coverage tiling (approximate sample boxes — NOT official FIRs):
 *
 *   [levant/med/israel]  ← AER-01 only (israelStrikeTells) — Israel High-go gated
 *   [redsea]             Red Sea / Suez corridor
 *   [bab]                Bab el-Mandeb / Aden
 *   [somali]             Somali basin / E. Africa
 *   [arabian]            Arabian Sea / NW IO
 *   [gulf]               Persian Gulf / Hormuz — mass_stack / 5-Lock ONLY
 *   [iraq]               Iraq + approaches (Baghdad FIR-ish → W Iran / N Gulf link)
 *   [syria-jazira]       Syria / Jazira Levant↔Mesopotamia continuity bridge
 *   [saudi]              Saudi / Peninsula interior (Red Sea ↔ Gulf land bridge)
 *   [iran]               Iran plateau (plot-only; High-go never)
 *
 * Soft fringe gaps (not dedicated boxes): Black Sea N, Central Asia NE,
 * deep Sahara / Maghreb W, far Arabian Sea E of ~72°E — outside desk priority.
 *
 * Cap: Gulf + Iraq/Syria corridor every cycle + ≤2 rotated fringe tiles
 * (+ shared mil) — never hammer all 9 geos every refresh. Gulf box alone
 * feeds aerial.regime / mass_stack. All other theater boxes = plot +
 * widerTheater awareness only — never Israel High-go.
 */
export type TheaterAdsbRegion =
  | "gulf"
  | "red_sea_horn"
  | "iraq_bridge"
  | "wider";

export type TheaterAdsbBoxDef = {
  id: string;
  label: string;
  /** Sidebar / map region tag. */
  region: TheaterAdsbRegion;
  /** When true, mil/tanker/AWACS inside this bbox count for Gulf aerial regime. */
  countsForGulfRegime: boolean;
  /** Always sampled (Israel↔Gulf land bridge) — not rotated out. */
  alwaysPoll?: boolean;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  centerLat: number;
  centerLon: number;
  distNm: number;
};

export const THEATER_ADSB_BOXES: TheaterAdsbBoxDef[] = [
  {
    id: "adsb-gulf",
    label: "ADS-B Gulf / Hormuz",
    region: "gulf",
    countsForGulfRegime: true,
    ...GULF_BBOX,
    centerLat: 26.5,
    centerLon: 54.0,
    distNm: 800,
  },
  {
    id: "adsb-iraq",
    label: "ADS-B Iraq / Mesopotamia",
    region: "iraq_bridge",
    countsForGulfRegime: false,
    alwaysPoll: true,
    // Baghdad FIR-ish + western Iran border + northern Gulf link
    latMin: 29.0,
    latMax: 37.5,
    lonMin: 38.5,
    lonMax: 49.0,
    centerLat: 33.2,
    centerLon: 44.0,
    distNm: 550,
  },
  {
    id: "adsb-syria-jazira",
    label: "ADS-B Syria / Jazira bridge",
    region: "iraq_bridge",
    countsForGulfRegime: false,
    alwaysPoll: true,
    // Levant desk east edge → Mesopotamia continuity (not AER-01)
    latMin: 32.0,
    latMax: 37.5,
    lonMin: 35.5,
    lonMax: 42.5,
    centerLat: 34.8,
    centerLon: 39.0,
    distNm: 420,
  },
  {
    id: "adsb-saudi",
    label: "ADS-B Saudi / Peninsula",
    region: "wider",
    countsForGulfRegime: false,
    // Red Sea ↔ Gulf land bridge / peninsula interior
    latMin: 16.0,
    latMax: 29.5,
    lonMin: 36.0,
    lonMax: 50.5,
    centerLat: 23.0,
    centerLon: 43.5,
    distNm: 700,
  },
  {
    id: "adsb-iran",
    label: "ADS-B Iran plateau",
    region: "wider",
    countsForGulfRegime: false,
    // Broader Iran airspace (not only Hormuz coastal) — plot-only
    latMin: 27.0,
    latMax: 39.5,
    lonMin: 48.0,
    lonMax: 62.5,
    centerLat: 32.5,
    centerLon: 54.5,
    distNm: 750,
  },
  {
    id: "adsb-redsea",
    label: "ADS-B Red Sea / Suez",
    region: "red_sea_horn",
    countsForGulfRegime: false,
    latMin: 14.0,
    latMax: 31.0,
    lonMin: 32.0,
    lonMax: 43.5,
    centerLat: 22.0,
    centerLon: 37.5,
    distNm: 700,
  },
  {
    id: "adsb-bab",
    label: "ADS-B Bab el-Mandeb / Aden",
    region: "red_sea_horn",
    countsForGulfRegime: false,
    latMin: 10.0,
    latMax: 15.8,
    lonMin: 41.0,
    lonMax: 52.0,
    centerLat: 12.5,
    centerLon: 46.0,
    distNm: 450,
  },
  {
    id: "adsb-somali",
    label: "ADS-B Somali basin / E. Africa",
    region: "red_sea_horn",
    countsForGulfRegime: false,
    latMin: -3.0,
    latMax: 12.5,
    lonMin: 42.0,
    lonMax: 58.0,
    centerLat: 5.0,
    centerLon: 50.0,
    distNm: 650,
  },
  {
    id: "adsb-arabian",
    label: "ADS-B Arabian Sea / NW IO",
    region: "wider",
    countsForGulfRegime: false,
    latMin: 8.0,
    latMax: 26.0,
    lonMin: 55.0,
    lonMax: 72.0,
    centerLat: 17.0,
    centerLon: 63.0,
    distNm: 700,
  },
];

const FOCUS_EXPIRY = "2026-09-18";
const FOCUS_STRIKE = 46;

export type TheaterWatch = {
  fetchedAt: string;
  ais: {
    note: string;
    links: Array<{ label: string; href: string }>;
    readAnchored: string;
    readCapeDiversion: string;
  };
  brentCurve: {
    near: { symbol: string; label: string; price: number | null };
    far: { symbol: string; label: string; price: number | null };
    spread: number | null;
    regime: "extreme_backwardation" | "backwardation" | "flat" | "contango" | "unknown";
    read: string;
    source: string;
  };
  wtiCurve: {
    near: { symbol: string; label: string; price: number | null; changePct: number | null };
    far: { symbol: string; label: string; price: number | null; changePct: number | null };
    spread: number | null;
    regime: "front_crash_back_hold" | "both_crash" | "both_firm" | "mixed" | "unknown";
    read: string;
    source: string;
  };
  bdti: {
    latest: { date: string; value: number } | null;
    prev: { date: string; value: number } | null;
    changePct1d: number | null;
    changePct5d: number | null;
    risingVsOil: boolean | null;
    read: string;
    sourceUrl: string;
  };
  peers: {
    fro: PeerRow | null;
    rows: PeerRow[];
    regime: "fro_idiosyncratic" | "macro_tape" | "mixed" | "unknown";
    read: string;
  };
  polymarket: {
    ceasefire: PolyRow | null;
    hormuz: PolyRow | null;
    top: PolyRow[];
    read: string;
    source: string;
    error?: string;
  };
  insiders: {
    rows: InsiderRow[];
    read: string;
    sourceUrl: string;
    error?: string;
  };
  aerial: {
    /** Gulf / Hormuz box only — feeds mass_stack / 5-Lock (not Israel High-go). */
    tankerCount: number;
    awacsCount: number;
    otherMilCount: number;
    regime: "routine" | "elevated" | "mass_stack" | "unknown";
    read: string;
    samples: Array<{
      callsign: string;
      type: string;
      aircraftType: string;
      lat: number;
      lon: number;
      altitude: number;
      /** ICAO hex when known — sticky key. */
      hex?: string;
      /** Sample box id (adsb-gulf, adsb-redsea, …). */
      boxId?: string;
      /** Map sidebar region. */
      region?: TheaterAdsbRegion;
      /** Dropped from live ADS-B but within sticky TTL (tankers 30m / mil 20m). */
      stale?: boolean;
      ageSec?: number;
      lastSeenAt?: string;
      /** Enrolled in theater, now live outside the tiled boxes. */
      followed?: boolean;
    }>;
    source: string;
    boxesOk?: string[];
    boxesFailed?: string[];
    /** Live plotted tracks per ADS-B sample box (for always-on watch tile labels). */
    boxTrackCounts?: Record<string, number>;
    /**
     * Wider theater (Iraq / Syria bridge / Saudi / Iran / Red Sea / Horn /
     * Arabian) — plot + awareness only. Never feeds Gulf mass_stack or
     * Israel AER-01 High-go.
     */
    widerTheater?: {
      tankerCount: number;
      awacsCount: number;
      otherMilCount: number;
      boxesOk: string[];
      boxesFailed: string[];
      read: string;
    };
    error?: string;
  };
  focus46c: {
    expiry: string;
    strike: number;
    bid: number | null;
    ask: number | null;
    last: number | null;
    volume: number | null;
    openInterest: number | null;
    iv: number | null;
    width: number | null;
    froPrice: number | null;
    oilProxy: number | null;
    regime: "vol_bid_up" | "bid_collapse" | "mixed" | "unknown";
    read: string;
    source: string | null;
  };
  /** Free OSINT: underwriter war-risk premium chatter via Google News. */
  warRiskInsurance: {
    query: string;
    items: Array<{ title: string; link: string; pubDate: string }>;
    spikeHints: string[];
    regime: "spike_chatter" | "quiet" | "mixed" | "unknown";
    read: string;
    searchUrl: string;
    source: string;
    error?: string;
  };
  /** Free OSINT: Oman / Iran state media deal text (vs Polymarket %). */
  stateMedia: {
    queries: string[];
    items: Array<{
      source: string;
      title: string;
      link: string;
      pubDate: string;
    }>;
    feeDisputeHits: string[];
    dealHits: string[];
    /** US/CENTCOM or Iran kinetic on Hormuz / islands (e.g. Larak) — not Israel AER. */
    kineticHits: string[];
    regime:
      | "no_deal_fees"
      | "deal_announced"
      | "fee_dispute_live"
      | "quiet"
      | "mixed"
      | "unknown";
    read: string;
    links: Array<{ label: string; href: string }>;
    source: string;
    error?: string;
  };
  /** Refined product calendars: HO / RB front vs 2nd month. */
  productCurves: {
    heatingOil: ProductCurveLeg;
    gasoline: ProductCurveLeg;
    regime:
      | "backwardation_firm"
      | "backwardation_eroding"
      | "contango"
      | "mixed"
      | "unknown";
    read: string;
    source: string;
  };
  /**
   * Free OSINT cluster for weekend Kharg Island / amphibious "Pickaxe" thesis:
   * ARG hull deep-links, E-6B Mercury, IRGC boat chatter, VLCC Cape diversion.
   */
  khargPickaxe: KhargPickaxeCluster;
  /**
   * Somali-basin / al-Shabaab Cape-*route* freight watch.
   * Soft overlay — never an Israel High-go peer; one headline ≠ Cape-closed.
   */
  eastAfricaCape: EastAfricaCapeState;
  /**
   * Ghost footprints that appear *before* USS Bataan turns on AIS —
   * air, logistics, SSGN, commercial canary, IRGC panic, NAVWARN box.
   * Do not wait for L1 AIS; watch this formation.
   */
  bataanGhost: BataanGhostCluster;
  /** Iran / Gulf / Hormuz map overlays (NOTAM FIR boxes, ADS-B box, SSGN/CSG stamps). */
  mapOverlays: TheaterMapOverlays;
  /**
   * Free OSINT cluster for "Bibi Spoiler" thesis:
   * Rome Israel–Lebanon talks, USD/ILS Shekel, IDF Lebanon-border ground chatter.
   */
  bibiSpoiler: BibiSpoilerCluster;
  /** Domestic politics event horizon — judgment overlay, not a fire rule. */
  politicsCalendar: PoliticsCalendarChip;
  /** Honesty: last-good / in-flight rebuild. Scoring fields unchanged. */
  stale?: boolean;
  fromCache?: boolean;
  servedAgeMs?: number;
  rebuilding?: boolean;
  degradedReason?: string | null;
};

export type BataanGhostSignStatus =
  | "hot"
  | "warm"
  | "quiet"
  | "unknown"
  | "manual";

export type BataanGhostSignId =
  | "radio_hole"
  | "aerial_taxis"
  | "sub_shuffle"
  | "unrep"
  | "commercial_canary"
  | "irgc_squirrel"
  | "navwarn_box";

export type BataanGhostSign = {
  id: BataanGhostSignId;
  label: string;
  lookFor: string;
  sourceHint: string;
  status: BataanGhostSignStatus;
  read: string;
  evidence: string[];
  links: Array<{ label: string; href: string }>;
};

export type BataanGhostCluster = {
  thesis: string;
  oneLiner: string;
  fetchedAt: string;
  /** Count of signs with status hot (warm counts 0.5). */
  formationScore: number;
  formationMax: number;
  formationRegime: "tight" | "forming" | "loose" | "quiet" | "unknown";
  read: string;
  signs: BataanGhostSign[];
};

/** Heuristic Gulf / Iran map overlays for the OSINT Map tab (approx FIRs — not official geometry). */
export type TheaterMapZoneKind = "notam" | "adsb_box" | "nav_watch" | "ais_box";

export type TheaterMapZone = {
  id: string;
  kind: TheaterMapZoneKind;
  label: string;
  status: "quiet" | "warm" | "hot" | "unknown" | "info" | "failed";
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  titles?: string[];
};

export type TheaterMapStamp = {
  id: string;
  kind: "arg" | "ssgn" | "csg" | "naval";
  label: string;
  lat: number;
  lon: number;
  status: string;
  region: string;
  meta?: string;
  /** ISO or feed string when known — UI marks stale. */
  lastReported?: string | null;
  /** Live SOG/course when IRONSIGHT ships payload includes kinematics. */
  sogKt?: number | null;
  courseDeg?: number | null;
  /** Voyage destination when IRONSIGHT includes it. */
  destination?: string | null;
  /** Hull dropped from IRONSIGHT feed — last-known pin (awareness only). */
  stale?: boolean;
  ageSec?: number;
  lastSeenAt?: string;
};

export type TheaterMapOverlays = {
  zones: TheaterMapZone[];
  stamps: TheaterMapStamp[];
  /** Hormuz / Bab AIS (plot-only — never NAV-01). */
  aisPoints: Array<{
    id: string;
    kind: "ais_vessel";
    label: string;
    category: string;
    lat: number;
    lon: number;
    sog: number | null;
    cog: number | null;
    boxId?: string;
  }>;
  radioHoleStatus: BataanGhostSignStatus;
  navwarnStatus: BataanGhostSignStatus;
};

export type BibiSpoilerCluster = {
  thesis: string;
  scenarios: {
    romeTrap: string;
    nuclearBreakout: string;
  };
  tradeImplication: string;
  fetchedAt: string;
  romeTalks: {
    queries: string[];
    items: Array<{
      source: string;
      title: string;
      link: string;
      pubDate: string;
    }>;
    keywordHits: {
      walkout: string[];
      disarmamentPrecondition: string[];
      talksOngoing: string[];
      concluded: string[];
      calendarGap: string[];
    };
    regime:
      | "concluded"
      | "calendar_gap"
      | "walkout_chatter"
      | "disarmament_precondition"
      | "talks_ongoing"
      | "quiet"
      | "unknown";
    read: string;
    links: Array<{ label: string; href: string }>;
    source: string;
    error?: string;
  };
  shekel: {
    symbol: string;
    price: number | null;
    changePct: number | null;
    /** Crisis-ish USD/ILS level (ILS per USD). */
    threshold: number;
    regime: "spike_toward_4" | "firm" | "quiet" | "unknown";
    read: string;
    source: string;
    error?: string;
  };
  idfGround: {
    items: Array<{
      source: string;
      title: string;
      link: string;
      pubDate: string;
    }>;
    keywordHits: {
      lebaneseBorder: string[];
      gazaFocus: string[];
    };
    regime:
      | "troops_lebanon_border"
      | "gaza_focus"
      | "quiet"
      | "mixed"
      | "unknown";
    read: string;
    links: Array<{ label: string; href: string }>;
    ironsightOnline: boolean;
    source: string;
    error?: string;
  };
};

export type KhargPickaxeCluster = {
  thesis: string;
  fetchedAt: string;
  amphibious: {
    context: string;
    decisionTable: Array<{
      ship: string;
      check: string;
      bullishKharg: string;
      bearishDelay: string;
    }>;
    vessels: Array<{
      key: "bataan" | "boxer" | "newYork";
      name: string;
      hull: string;
      role: string;
      mmsiHint: string | null;
      links: Array<{ label: string; href: string }>;
      ironsight: {
        name: string;
        hull: string;
        lat: number;
        lon: number;
        status: string;
        region: string;
        lastReported: string | null;
        stale?: boolean;
        ageSec?: number;
        lastSeenAt?: string;
      } | null;
    }>;
    readOptionA: string;
    readOptionB: string;
    note: string;
    source: string;
    error?: string;
  };
  e6b: {
    airborneCount: number;
    samples: Array<{
      callsign: string;
      aircraftType: string;
      lat: number;
      lon: number;
      altitude: number;
      gs: number | null;
      hex?: string;
      /** Dropped from live feed but within sticky TTL (~20m). */
      stale?: boolean;
      ageSec?: number;
      lastSeenAt?: string;
    }>;
    regime: "airborne" | "quiet" | "unknown";
    read: string;
    source: string;
    error?: string;
  };
  irgcBoats: {
    items: Array<{
      source: string;
      title: string;
      link: string;
      pubDate: string;
    }>;
    telegramLinks: Array<{ label: string; href: string }>;
    keywordHits: {
      dispersing: string[];
      massingOman: string[];
      reinforcingKharg: string[];
    };
    regime:
      | "dispersing_from_kharg"
      | "massing_gulf_of_oman"
      | "reinforcing_kharg"
      | "quiet"
      | "mixed"
      | "unknown";
    read: string;
    source: string;
    error?: string;
  };
  vlccCape: {
    links: Array<{ label: string; href: string }>;
    items: Array<{ title: string; link: string; pubDate: string }>;
    diversionHints: string[];
    regime: "cape_diversion" | "normal_transit" | "mixed" | "unknown";
    read: string;
    readOptionA: string;
    readOptionB: string;
    source: string;
    error?: string;
  };
};

type ProductCurveLeg = {
  root: "HO" | "RB";
  label: string;
  near: {
    symbol: string;
    label: string;
    price: number | null;
    changePct: number | null;
  };
  far: {
    symbol: string;
    label: string;
    price: number | null;
    changePct: number | null;
  };
  /** near − far in $/gal (positive = backwardation). */
  spread: number | null;
  spreadChangePctApprox: number | null;
  regime: "backwardation_firm" | "backwardation_eroding" | "contango" | "flat" | "unknown";
  read: string;
};

type PeerRow = {
  symbol: string;
  label: string;
  price: number | null;
  changePct: number | null;
};

type PolyRow = {
  question: string;
  yesPct: number | null;
  oneDayChange: number | null;
  volume24hr: number | null;
  slug: string | null;
};

type InsiderRow = {
  date: string | null;
  insider: string | null;
  title: string | null;
  tradeType: string | null;
  price: string | null;
  qty: string | null;
  value: string | null;
};


function classifyBrentSpread(
  spread: number | null,
): TheaterWatch["brentCurve"]["regime"] {
  if (spread == null) return "unknown";
  if (spread >= 5) return "extreme_backwardation";
  if (spread >= 1) return "backwardation";
  if (spread > -1) return "flat";
  return "contango";
}

function brentRead(
  regime: TheaterWatch["brentCurve"]["regime"],
  spread: number | null,
): string {
  const s = spread != null ? `$${spread.toFixed(2)}` : "—";
  switch (regime) {
    case "extreme_backwardation":
      return `Near-term Brent ≫ deferred (${s} Sep−Dec). Physical oil is screaming for supply now — tanker rates track this tightness, not just headlines.`;
    case "backwardation":
      return `Backwardation (${s}). Near-term demand/supply stress — supportive for VLCC rates if Hormuz stays tight.`;
    case "flat":
      return `Curve flattening (${s}). Market pricing crisis de-escalation — less urgent physical pull.`;
    case "contango":
      return `Contango (${s}). Near-term softer than deferred — market not pricing an acute physical squeeze.`;
    default:
      return "Brent calendar quotes unavailable.";
  }
}

function aerialRegime(tankers: number): TheaterWatch["aerial"]["regime"] {
  if (tankers >= 5) return "mass_stack";
  if (tankers >= 3) return "elevated";
  if (tankers >= 0) return "routine";
  return "unknown";
}

function aerialRead(
  regime: TheaterWatch["aerial"]["regime"],
  tankers: number,
  awacs: number,
): string {
  switch (regime) {
    case "mass_stack":
      return `${tankers} aerial tankers (+${awacs} AWACS) in Gulf/Hormuz box — mass refueling stack. Prep for strikes / deal-off risk if this jumps toward 10+. Wider Red Sea/Horn/Arabian samples are plot-only.`;
    case "elevated":
      return `${tankers} tankers (+${awacs} AWACS) in Gulf/Hormuz — above routine. Watch for further surge. Wider theater boxes are awareness only.`;
    case "routine":
      return `${tankers} tanker(s) (+${awacs} AWACS) in Gulf/Hormuz — routine patrol levels (many mil flights stay dark).`;
    default:
      return "ADS-B Gulf sample unavailable.";
  }
}

function inTheaterAdsbBox(
  a: AdsbAc,
  box: Pick<TheaterAdsbBoxDef, "latMin" | "latMax" | "lonMin" | "lonMax">,
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

function matchTheaterAdsbBox(a: AdsbAc): TheaterAdsbBoxDef | null {
  // Prefer Gulf first so regime-counting box wins on overlap edges.
  for (const box of THEATER_ADSB_BOXES) {
    if (box.countsForGulfRegime && inTheaterAdsbBox(a, box)) return box;
  }
  for (const box of THEATER_ADSB_BOXES) {
    if (!box.countsForGulfRegime && inTheaterAdsbBox(a, box)) return box;
  }
  return null;
}

/** Round-robin cursor for non-Gulf theater ADS-B tiles. */
let theaterAdsbRotateIdx = 0;
/** Last-good Gulf/theater aerial — served on 429 / total miss. */
let gulfAerialLastGood: TheaterWatch["aerial"] | null = null;
/** Per-hex sticky when adsb.lol drops a tanker/AWACS/mil (matches Levant TTLs). */
type GulfStickySample = TheaterWatch["aerial"]["samples"][number] & {
  lastSeenAt: string;
  hex: string;
};
const gulfAerialStickyByHex = new Map<string, GulfStickySample>();

function gulfKindTtl(
  type: TheaterWatch["aerial"]["samples"][number]["type"],
): number {
  return stickyDisplayTtlMs(type === "tanker" || type === "awacs" ? type : "mil");
}

function mergeGulfAerialSticky(
  liveSamples: TheaterWatch["aerial"]["samples"],
  opts: { feedFullyFailed: boolean; sampledAt: string },
): TheaterWatch["aerial"]["samples"] {
  const now = Date.parse(opts.sampledAt) || Date.now();
  if (!opts.feedFullyFailed) {
    for (const s of liveSamples) {
      const hex = (s.hex ?? "").replace("~", "");
      if (!hex) continue;
      if (
        isCivOrVipAirframe(s.aircraftType) &&
        s.type !== "tanker" &&
        s.type !== "awacs"
      ) {
        continue;
      }
      gulfAerialStickyByHex.set(hex, {
        ...s,
        hex,
        stale: undefined,
        ageSec: undefined,
        lastSeenAt: opts.sampledAt,
      });
    }
  }

  const liveHexes = new Set(
    opts.feedFullyFailed
      ? []
      : liveSamples.map((s) => (s.hex ?? "").replace("~", "")).filter(Boolean),
  );

  for (const w of collectWatchlistLastGood(liveHexes, now)) {
    if (gulfAerialStickyByHex.has(w.hex) && liveHexes.has(w.hex)) continue;
    const prev = gulfAerialStickyByHex.get(w.hex);
    const prevSeen = prev ? Date.parse(prev.lastSeenAt) || 0 : 0;
    const watchSeen = Date.parse(w.lastSeenAt) || 0;
    if (prev && prevSeen >= watchSeen) continue;
    gulfAerialStickyByHex.set(w.hex, {
      callsign: w.callsign,
      type: w.kind,
      aircraftType: w.acType,
      lat: w.lat,
      lon: w.lon,
      altitude: w.altFt ?? 0,
      hex: w.hex,
      region: "wider",
      followed: true,
      lastSeenAt: w.lastSeenAt,
    });
  }

  const out: TheaterWatch["aerial"]["samples"] = opts.feedFullyFailed
    ? []
    : liveSamples.map((s) => ({ ...s, stale: false }));

  for (const [hex, snap] of [...gulfAerialStickyByHex.entries()]) {
    const seenAt = Date.parse(snap.lastSeenAt) || 0;
    const ageMs = Math.max(0, now - seenAt);
    if (ageMs > gulfKindTtl(snap.type)) {
      gulfAerialStickyByHex.delete(hex);
      continue;
    }
    if (liveHexes.has(hex)) continue;
    if (
      isCivOrVipAirframe(snap.aircraftType) &&
      snap.type !== "tanker" &&
      snap.type !== "awacs"
    ) {
      gulfAerialStickyByHex.delete(hex);
      continue;
    }
    // Levant mil is IST's board; keep Levant tankers/AWACS here as a fallback pin.
    if (
      snap.type !== "tanker" &&
      snap.type !== "awacs" &&
      inLevantStrikeBox({ lat: snap.lat, lon: snap.lon })
    ) {
      gulfAerialStickyByHex.delete(hex);
      continue;
    }
    out.push({
      callsign: snap.callsign,
      type: snap.type,
      aircraftType: snap.aircraftType,
      lat: snap.lat,
      lon: snap.lon,
      altitude: snap.altitude,
      hex: snap.hex,
      boxId: snap.boxId,
      region: snap.region,
      followed: snap.followed,
      stale: true,
      ageSec: Math.max(0, Math.round(ageMs / 1000)),
      lastSeenAt: snap.lastSeenAt,
    });
  }
  const vip = out.filter((s) => s.type === "tanker" || s.type === "awacs");
  const rest = out.filter((s) => s.type !== "tanker" && s.type !== "awacs");
  return [...vip, ...rest].slice(0, 96);
}

function buildOpenSkyGulfAerialSnap(
  osAc: AdsbAc[],
  boxesFailed: string[],
  boxTrackCounts: Record<string, number>,
): TheaterWatch["aerial"] {
  const gulfBox = THEATER_ADSB_BOXES.find((b) => b.countsForGulfRegime)!;
  let gulfTankers = 0;
  let gulfAwacs = 0;
  let gulfOther = 0;
  const samples: TheaterWatch["aerial"]["samples"] = [];
  for (const a of osAc) {
    if (!inTheaterAdsbBox(a, gulfBox)) continue;
    const callsign = (a.flight ?? "").trim();
    const acType = a.t ?? "";
    const desc = a.desc ?? "";
    const tanker = isAerialTanker(acType, desc, callsign);
    const awacs = isAwacs(acType, desc, callsign);
    const mil =
      !!(a.dbFlags && (a.dbFlags & 1 || a.dbFlags & 2)) ||
      openSkyLooksMilCallsign(callsign);
    if (tanker) gulfTankers += 1;
    else if (awacs) gulfAwacs += 1;
    else if (mil) gulfOther += 1;
    else continue;
    if (Number.isFinite(a.lat) && Number.isFinite(a.lon)) {
      const alt =
        typeof a.alt_baro === "number"
          ? a.alt_baro
          : a.alt_baro === "ground"
            ? 0
            : Number(a.alt_baro) || 0;
      samples.push({
        callsign: callsign || "—",
        type: tanker ? "tanker" : awacs ? "awacs" : "mil",
        aircraftType: acType || desc || "opensky",
        lat: a.lat!,
        lon: a.lon!,
        altitude: alt,
        hex: (a.hex ?? "").replace("~", "") || undefined,
        boxId: gulfBox.id,
        region: gulfBox.region,
      });
      boxTrackCounts[gulfBox.id] = (boxTrackCounts[gulfBox.id] ?? 0) + 1;
    }
  }
  const sampledAt = new Date().toISOString();
  const mergedSamples = mergeGulfAerialSticky(samples, {
    feedFullyFailed: false,
    sampledAt,
  });
  const regime = aerialRegime(gulfTankers);
  const snap: TheaterWatch["aerial"] = {
    tankerCount: gulfTankers,
    awacsCount: gulfAwacs,
    otherMilCount: gulfOther,
    regime,
    read: `${aerialRead(regime, gulfTankers, gulfAwacs)} · OpenSky failover (no aircraft type — callsign heuristics only).`,
    samples: mergedSamples,
    source: "opensky (Gulf bbox failover; adsb.lol failed)",
    boxesOk: ["opensky-gulf"],
    boxesFailed,
    boxTrackCounts,
    widerTheater: {
      tankerCount: 0,
      awacsCount: 0,
      otherMilCount: 0,
      boxesOk: [],
      boxesFailed: [...boxesFailed],
      read: "Wider theater skipped this cycle — OpenSky Gulf-only failover.",
    },
    error: `adsb.lol failed (${boxesFailed.join("; ") || "timeout"}) · OpenSky Gulf`,
  };
  gulfAerialLastGood = {
    ...snap,
    samples: samples.slice(0, 96),
  };
  return snap;
}

async function tryOpenSkyGulfFailover(
  boxesFailed: string[],
  boxTrackCounts: Record<string, number>,
  id: string,
): Promise<TheaterWatch["aerial"] | null> {
  const os = await fetchOpenSkyBbox(OPENSKY_GULF_BBOX, { id });
  if (!os.ok || os.ac.length === 0) return null;
  return buildOpenSkyGulfAerialSnap(os.ac, boxesFailed, boxTrackCounts);
}

function staleGulfAerial(error: string): TheaterWatch["aerial"] {
  const cached = gulfAerialLastGood;
  const sampledAt = new Date().toISOString();
  if (cached && cached.samples) {
    const ageBit = cached.source?.includes("cached")
      ? ""
      : " · last-good cache";
    const stickySamples = mergeGulfAerialSticky(
      (cached.samples ?? []).filter((s) => !s.stale),
      { feedFullyFailed: true, sampledAt },
    );
    return {
      ...cached,
      // Keep live regime counts from last-good snap — do not invent fresh mass_stack.
      samples: stickySamples.length > 0 ? stickySamples : (cached.samples ?? []).map((s) => ({
        ...s,
        stale: true,
      })),
      source: `${cached.source}${ageBit}`,
      error: `${error} · serving last-good aerial`,
      widerTheater: cached.widerTheater
        ? {
            ...cached.widerTheater,
            read: `${cached.widerTheater.read} (degraded / last-good)`,
          }
        : cached.widerTheater,
    };
  }
  return {
    tankerCount: 0,
    awacsCount: 0,
    otherMilCount: 0,
    regime: "unknown",
    read: aerialRead("unknown", 0, 0),
    samples: mergeGulfAerialSticky([], {
      feedFullyFailed: true,
      sampledAt,
    }),
    source: "adsb.lol shared queue (degraded)",
    boxesOk: [],
    boxesFailed: ["all"],
    boxTrackCounts: Object.fromEntries(
      THEATER_ADSB_BOXES.map((b) => [b.id, 0]),
    ),
    widerTheater: {
      tankerCount: 0,
      awacsCount: 0,
      otherMilCount: 0,
      boxesOk: [],
      boxesFailed: ["all"],
      read: "Wider theater ADS-B unavailable — last-good empty.",
    },
    error,
  };
}

/**
 * Wide-theater ADS-B — shared queue + Gulf + Iraq/Syria corridor every
 * cycle + ≤2 rotated fringe tiles (avoids adsb.lol 429 from mil+9 geos
 * every poll). Gulf bbox alone feeds aerial.regime / mass_stack. Wider
 * boxes populate samples + widerTheater for the map — never Israel
 * High-go. Always reports all THEATER_ADSB_BOXES in boxTrackCounts
 * (0 = watching, not absent).
 */
async function fetchGulfAerial(): Promise<TheaterWatch["aerial"]> {
  if (adsbLolBackingOff() && gulfAerialLastGood) {
    return staleGulfAerial("adsb.lol rate-limit backoff");
  }

  const boxesOk: string[] = [];
  const boxesFailed: string[] = [];
  const seen = new Set<string>();
  const merged: Array<{ ac: AdsbAc; box: TheaterAdsbBoxDef }> = [];
  const outboundFollow: AdsbAc[] = [];
  // Always-on watch tiles — every defined box appears even at 0 live / not polled this cycle.
  const boxTrackCounts: Record<string, number> = Object.fromEntries(
    THEATER_ADSB_BOXES.map((b) => [b.id, 0]),
  );

  try {
    // Shared mil (may hit Levant cache) — priority gulf so theater waits behind AER-01.
    const mil = await fetchAdsbMil("gulf");
    if (mil.ok) {
      boxesOk.push("mil");
      for (const a of mil.ac) {
        const box = matchTheaterAdsbBox(a);
        const hex = (a.hex ?? "").replace("~", "");
        if (!hex || seen.has(hex)) continue;
        if (box) {
          seen.add(hex);
          merged.push({ ac: a, box });
          continue;
        }
        // Keep transmitting mil in the footprint gaps, or already-watched hexes that left.
        if (
          shouldEnroll(a) &&
          !looksLanded(a) &&
          !inLevantStrikeBox(a) &&
          (inWideTheaterFootprint(a) || isWatchedHex(hex))
        ) {
          seen.add(hex);
          outboundFollow.push(a);
        }
      }
    } else {
      boxesFailed.push(`mil:${mil.error ?? mil.status}`);
      if (mil.rateLimited) {
        const failover = await tryOpenSkyGulfFailover(
          boxesFailed,
          boxTrackCounts,
          "gulf-failover-mil429",
        );
        if (failover) return failover;
        return staleGulfAerial(
          `adsb.lol mil rate-limited (${mil.error ?? mil.status})`,
        );
      }
    }

    const missingHigh = missingHighValueHexes(seen);
    const fringePerCycle =
      adsbLolBackingOff() || missingHigh.length > 0 ? 0 : 2;
    const { selected, nextIdx } = rotateTheaterBoxes(
      THEATER_ADSB_BOXES,
      { idx: theaterAdsbRotateIdx },
      fringePerCycle,
    );
    theaterAdsbRotateIdx = nextIdx;

    const geoEndpoints = selected.map((b) => ({
      id: b.id.replace(/^adsb-/, ""),
      boxId: b.id,
      priority: (b.countsForGulfRegime ? "gulf" : "theater") as "gulf" | "theater",
      url: `https://api.adsb.lol/v2/lat/${b.centerLat}/lon/${b.centerLon}/dist/${b.distNm}`,
    }));

    for (const ep of geoEndpoints) {
      const result = await fetchAdsbLol(ep.url, {
        id: ep.id,
        priority: ep.priority,
      });
      if (!result.ok) {
        boxesFailed.push(`${ep.id}:${result.error ?? result.status}`);
        if (result.rateLimited) {
          // Stop further geos this cycle — keep mil + whatever we already have.
          break;
        }
        continue;
      }
      boxesOk.push(ep.id);
      for (const a of result.ac) {
        const box = matchTheaterAdsbBox(a);
        const hex = (a.hex ?? "").replace("~", "");
        if (!hex || seen.has(hex)) continue;
        if (box) {
          seen.add(hex);
          merged.push({ ac: a, box });
          continue;
        }
        if (
          shouldEnroll(a) &&
          !looksLanded(a) &&
          !inLevantStrikeBox(a) &&
          (inWideTheaterFootprint(a) || isWatchedHex(hex))
        ) {
          seen.add(hex);
          outboundFollow.push(a);
        }
      }
    }

    if (!adsbLolBackingOff()) {
      for (const hex of pickFollowLookups(missingWatchHexes(seen))) {
        const acs = await fetchAdsbHex(hex);
        for (const a of acs) {
          const h = normalizeHex(a.hex);
          if (!h || seen.has(h) || a.lat == null || a.lon == null) continue;
          if (looksLanded(a)) continue;
          const box = matchTheaterAdsbBox(a);
          seen.add(h);
          if (box) merged.push({ ac: a, box });
          else if (!inLevantStrikeBox(a)) outboundFollow.push(a);
        }
      }
    }

    // Mark unselected (not polled this cycle) as soft-ok so map still "watching".
    const polledShort = new Set(geoEndpoints.map((e) => e.id));
    for (const b of THEATER_ADSB_BOXES) {
      const short = b.id.replace(/^adsb-/, "");
      if (!polledShort.has(short) && !boxesOk.includes(short)) {
        // Not failed — simply rotated out; still watching.
        if (!boxesFailed.some((f) => f.startsWith(`${short}:`))) {
          boxesOk.push(short);
        }
      }
    }

    if (boxesOk.filter((id) => id === "mil" || polledShort.has(id)).length === 0) {
      const failover = await tryOpenSkyGulfFailover(
        boxesFailed,
        boxTrackCounts,
        "gulf-failover",
      );
      if (failover) return failover;
      return staleGulfAerial(
        `all polled boxes failed (${boxesFailed.join("; ") || "timeout"})`,
      );
    }

    const samples: TheaterWatch["aerial"]["samples"] = [];
    let gulfTankers = 0;
    let gulfAwacs = 0;
    let gulfOther = 0;
    let wideTankers = 0;
    let wideAwacs = 0;
    let wideOther = 0;

    for (const { ac: a, box } of merged) {
      const callsign = (a.flight ?? "").trim();
      const acType = a.t ?? "";
      const desc = a.desc ?? "";
      const flags = a.dbFlags ?? 0;
      const milFlag = !!(flags & 1) || !!(flags & 2);
      const tanker = isAerialTanker(acType, desc, callsign);
      const awacs = isAwacs(acType, desc, callsign);
      const gulf = box.countsForGulfRegime;

      if (tanker) {
        if (gulf) gulfTankers += 1;
        else wideTankers += 1;
      } else if (awacs) {
        if (gulf) gulfAwacs += 1;
        else wideAwacs += 1;
      } else if (milFlag) {
        if (gulf) gulfOther += 1;
        else wideOther += 1;
      } else continue;

      if (
        (tanker || awacs || milFlag) &&
        Number.isFinite(a.lat) &&
        Number.isFinite(a.lon)
      ) {
        const alt =
          typeof a.alt_baro === "number"
            ? a.alt_baro
            : a.alt_baro === "ground"
              ? 0
              : Number(a.alt_baro) || 0;
        const hex = (a.hex ?? "").replace("~", "");
        samples.push({
          callsign: callsign || "—",
          type: tanker ? "tanker" : awacs ? "awacs" : "mil",
          aircraftType: acType || desc || "?",
          lat: a.lat!,
          lon: a.lon!,
          altitude: alt,
          hex: hex || undefined,
          boxId: box.id,
          region: box.region,
        });
        boxTrackCounts[box.id] = (boxTrackCounts[box.id] ?? 0) + 1;
      }
    }

    const nowIso = new Date().toISOString();
    enrollWideTheaterWatch(
      [...merged.map((m) => m.ac), ...outboundFollow],
      nowIso,
    );

    for (const a of outboundFollow) {
      if (!shouldEnroll(a) || looksLanded(a)) continue;
      if (a.lat == null || a.lon == null) continue;
      const hex = normalizeHex(a.hex);
      if (!hex) continue;
      const callsign = (a.flight ?? "").trim();
      const acType = a.t ?? "";
      const desc = a.desc ?? "";
      const tanker = isAerialTanker(acType, desc, callsign);
      const awacs = isAwacs(acType, desc, callsign);
      const alt =
        typeof a.alt_baro === "number"
          ? a.alt_baro
          : a.alt_baro === "ground"
            ? 0
            : Number(a.alt_baro) || 0;
      samples.push({
        callsign: callsign || "—",
        type: tanker ? "tanker" : awacs ? "awacs" : "mil",
        aircraftType: acType || desc || "?",
        lat: a.lat,
        lon: a.lon,
        altitude: alt,
        hex,
        region: "wider",
        followed: true,
      });
    }

    // Merge live counts onto last-good samples for boxes not polled this cycle.
    if (gulfAerialLastGood?.samples?.length) {
      const liveHexApprox = new Set(
        samples
          .map((s) => s.hex?.replace("~", "") || "")
          .filter(Boolean),
      );
      const liveKeyApprox = new Set(
        samples.map(
          (s) => `${s.callsign}:${s.lat.toFixed(2)}:${s.lon.toFixed(2)}`,
        ),
      );
      for (const s of gulfAerialLastGood.samples) {
        if (s.stale) continue;
        if (!s.boxId) continue;
        const short = s.boxId.replace(/^adsb-/, "");
        if (polledShort.has(short)) continue;
        const hex = s.hex?.replace("~", "") || "";
        if (hex && liveHexApprox.has(hex)) continue;
        const key = `${s.callsign}:${s.lat.toFixed(2)}:${s.lon.toFixed(2)}`;
        if (liveKeyApprox.has(key)) continue;
        samples.push({ ...s, stale: false });
        // Rotation hold — do not inflate live boxTrackCounts for watch labels.
        liveKeyApprox.add(key);
        if (hex) liveHexApprox.add(hex);
      }
    }

    samples.sort((a, b) => {
      const ra = a.region ?? "";
      const rb = b.region ?? "";
      if (ra !== rb) return ra.localeCompare(rb);
      return a.type.localeCompare(b.type);
    });

    const sampledAt = new Date().toISOString();
    // Per-hex sticky last-known (tankers 30m / mil 20m) for hexes that dropped.
    // Stale samples are map awareness only — never feed mass_stack / 5-Lock counts.
    const mergedSamples = mergeGulfAerialSticky(samples, {
      feedFullyFailed: false,
      sampledAt,
    });

    const regime = aerialRegime(gulfTankers);
    const widerOk = boxesOk.filter((id) => id !== "mil" && id !== "gulf");
    const widerFailed = boxesFailed.filter(
      (id) => !id.startsWith("mil") && !id.startsWith("gulf"),
    );
    const rotateNote = `polled ${[...polledShort].join("+")} this cycle`;
    const widerRead =
      wideTankers + wideAwacs === 0
        ? `Wider theater ADS-B quiet/dark · ${rotateNote} · boxes ${widerOk.join("+") || "—"}. Tiled airspace awareness only — not Gulf mass_stack, not Israel High-go.`
        : `Wider theater: ${wideTankers} tanker(s) + ${wideAwacs} AWACS outside Gulf box · ${rotateNote}. Plot-only — never feeds mass_stack or AER-01.`;

    const snap: TheaterWatch["aerial"] = {
      tankerCount: gulfTankers,
      awacsCount: gulfAwacs,
      otherMilCount: gulfOther,
      regime,
      read: aerialRead(regime, gulfTankers, gulfAwacs),
      samples: mergedSamples,
      source: "adsb.lol shared queue (Gulf + Iraq/Syria corridor + rotated fringe)",
      boxesOk,
      boxesFailed,
      boxTrackCounts,
      widerTheater: {
        tankerCount: wideTankers,
        awacsCount: wideAwacs,
        otherMilCount: wideOther,
        boxesOk: widerOk,
        boxesFailed: widerFailed,
        read: widerRead,
      },
      error:
        boxesFailed.length > 0
          ? `partial: ${boxesFailed.join("; ")}`
          : undefined,
    };
    gulfAerialLastGood = {
      ...snap,
      // Persist live-only for rotation hold next cycle.
      samples: samples.slice(0, 96),
    };
    return snap;
  } catch (err) {
    return staleGulfAerial(String(err));
  }
}

async function fetchBrentCurve(): Promise<TheaterWatch["brentCurve"]> {
  const [near, far] = await Promise.all([
    getStockQuote("BZU26.NYM").catch(() => null),
    getStockQuote("BZZ26.NYM").catch(() => null),
  ]);
  const nearPx = near?.price ?? null;
  const farPx = far?.price ?? null;
  const spread = nearPx != null && farPx != null ? nearPx - farPx : null;
  const regime = classifyBrentSpread(spread);
  return {
    near: { symbol: "BZU26.NYM", label: "Brent Sep '26", price: nearPx },
    far: { symbol: "BZZ26.NYM", label: "Brent Dec '26", price: farPx },
    spread,
    regime,
    read: brentRead(regime, spread),
    source: "yahoo-finance2",
  };
}

function focus46cRead(opts: {
  bid: number | null;
  volume: number | null;
  width: number | null;
  froChangePct: number | null;
  oilChangePct: number | null;
}): { regime: TheaterWatch["focus46c"]["regime"]; read: string } {
  const { bid, volume, width, froChangePct, oilChangePct } = opts;
  const volSpike = volume != null && volume >= 200;
  const wide = width != null && bid != null && width > Math.max(0.4, bid * 0.8);
  const oilDown = oilChangePct != null && oilChangePct < -1;
  const froDown = froChangePct != null && froChangePct < -1.5;
  const bidWeak = bid != null && bid < 0.4;

  if (volSpike && (oilDown || froDown) && bid != null && bid >= 0.5) {
    return {
      regime: "vol_bid_up",
      read: `Bid $${bid.toFixed(2)} holding/wide with vol ${volume} while oil/FRO soft — options pricing geopolitical blow-up (vol skew), not just spot.`,
    };
  }
  if (bidWeak || (froDown && bid != null && bid < 0.8 && !volSpike)) {
    return {
      regime: "bid_collapse",
      read: `Bid ${bid != null ? `$${bid.toFixed(2)}` : "—"} soft${volume != null ? ` · vol ${volume}` : ""} — book looks like selling the news / deal hope. Watch next open for bid collapse vs hold.`,
    };
  }
  if (wide) {
    return {
      regime: "mixed",
      read: `Wide bid/ask (${bid?.toFixed(2)}–spread) — liquidity thin; don't trust mid. Use limits.`,
    };
  }
  return {
    regime: "unknown",
    read: `Sep $46c mark ${bid != null ? `bid $${bid.toFixed(2)}` : "—"}${volume != null ? ` · vol ${volume}` : ""}. Bid widen + vol spike into oil drop = blow-up priced; bid collapse = sell-the-news.`,
  };
}

async function fetchFocus46c(
  fro: StockQuote | null,
  oil: StockQuote | null,
): Promise<TheaterWatch["focus46c"]> {
  try {
    const chain = await getOptionsChain("FRO", FOCUS_EXPIRY);
    const row = chain.calls.find((c) => Math.abs(c.strike - FOCUS_STRIKE) < 0.01);
    const bid = row?.bid ?? null;
    const ask = row?.ask ?? null;
    const width = bid != null && ask != null ? ask - bid : null;
    const { regime, read } = focus46cRead({
      bid,
      volume: row?.volume ?? null,
      width,
      froChangePct: fro?.changePercent ?? null,
      oilChangePct: oil?.changePercent ?? null,
    });
    return {
      expiry: FOCUS_EXPIRY,
      strike: FOCUS_STRIKE,
      bid,
      ask,
      last: row?.lastPrice ?? null,
      volume: row?.volume ?? null,
      openInterest: row?.openInterest ?? null,
      iv: row?.impliedVolatility ?? null,
      width,
      froPrice: fro?.price ?? chain.underlyingPrice,
      oilProxy: oil?.price ?? null,
      regime,
      read,
      source: chain.source,
    };
  } catch (err) {
    return {
      expiry: FOCUS_EXPIRY,
      strike: FOCUS_STRIKE,
      bid: null,
      ask: null,
      last: null,
      volume: null,
      openInterest: null,
      iv: null,
      width: null,
      froPrice: fro?.price ?? null,
      oilProxy: oil?.price ?? null,
      regime: "unknown",
      read: `Focus $46c unavailable: ${String(err).slice(0, 120)}`,
      source: null,
    };
  }
}

const IRONSIGHT_URL = process.env.IRONSIGHT_URL ?? "http://localhost:3170";

function isE6b(ac: AdsbAc): boolean {
  const t = (ac.t ?? "").toUpperCase();
  const desc = (ac.desc ?? "").toUpperCase();
  const cs = (ac.flight ?? "").trim().toUpperCase();
  const hex = (ac.hex ?? "").replace("~", "").toUpperCase();
  // Known tanker / non-Mercury types — never count as E-6B even on watched hex.
  if (/KC.?135|KC135|K35R|KC35|K35|KC-?46|KC46|R135/.test(t)) return false;
  if (desc.includes("STRATOTANKER") || desc.includes("PEGASUS")) return false;
  if (hex === "AE041D" || hex === "AE016E" || hex === "AE041C") {
    // Hex watch only if type is missing/unknown or actually E-6 — not K35R mis-tags.
    if (t && !/^E-?6B?$/.test(t) && t !== "E6" && !t.startsWith("E6")) {
      return false;
    }
    return true;
  }
  if (/^E-?6B?$/.test(t) || t === "E6" || t.startsWith("E6")) return true;
  if (desc.includes("MERCURY") || desc.includes("TACAMO") || desc.includes("E-6"))
    return true;
  // Start-anchored + US mil hex — rejects Canadian CGAZE substring hits
  if (/^(VAMPIRE|GAZE|MAYHEM|TACAMO|DOOM)(\d|\s|$)/.test(cs) && /^AE[0-9A-F]{4}$/.test(hex))
    return true;
  return false;
}

/** Per-hex E-6B sticky when mil/type feed drops TACAMO (~20m). */
const E6B_STICKY_TTL_MS = 20 * 60 * 1000;
type StickyE6b = KhargPickaxeCluster["e6b"]["samples"][number] & {
  lastSeenAt: string;
  hex: string;
};
const e6bStickyByHex = new Map<string, StickyE6b>();

function mergeE6bSticky(
  liveSamples: KhargPickaxeCluster["e6b"]["samples"],
  opts: { feedFullyFailed: boolean; sampledAt: string },
): KhargPickaxeCluster["e6b"]["samples"] {
  const now = Date.parse(opts.sampledAt) || Date.now();
  if (!opts.feedFullyFailed) {
    for (const s of liveSamples) {
      const hex = (s.hex ?? "").replace("~", "");
      if (!hex) continue;
      e6bStickyByHex.set(hex, {
        ...s,
        hex,
        stale: undefined,
        ageSec: undefined,
        lastSeenAt: opts.sampledAt,
      });
    }
  }
  const liveHexes = new Set(
    opts.feedFullyFailed
      ? []
      : liveSamples.map((s) => (s.hex ?? "").replace("~", "")).filter(Boolean),
  );
  const out: KhargPickaxeCluster["e6b"]["samples"] = opts.feedFullyFailed
    ? []
    : liveSamples.map((s) => ({ ...s, stale: false }));
  for (const [hex, snap] of [...e6bStickyByHex.entries()]) {
    const seenAt = Date.parse(snap.lastSeenAt) || 0;
    const ageMs = Math.max(0, now - seenAt);
    if (ageMs > E6B_STICKY_TTL_MS) {
      e6bStickyByHex.delete(hex);
      continue;
    }
    if (liveHexes.has(hex)) continue;
    out.push({
      callsign: snap.callsign,
      aircraftType: snap.aircraftType,
      lat: snap.lat,
      lon: snap.lon,
      altitude: snap.altitude,
      gs: snap.gs,
      hex: snap.hex,
      stale: true,
      ageSec: Math.max(0, Math.round(ageMs / 1000)),
      lastSeenAt: snap.lastSeenAt,
    });
  }
  return out.slice(0, 8);
}

async function fetchE6bMercury(): Promise<KhargPickaxeCluster["e6b"]> {
  const sampledAt = new Date().toISOString();
  try {
    const [mil, typeResult] = await Promise.all([
      fetchAdsbMil("e6b"),
      fetchAdsbLol("https://api.adsb.lol/v2/type/E6", {
        id: "type-E6",
        priority: "e6b",
      }).catch(
        () =>
          ({
            ok: false,
            status: 0,
            ac: [] as AdsbAc[],
          }) as const,
      ),
    ]);

    const seen = new Set<string>();
    const hits: AdsbAc[] = [];
    for (const list of [mil.ac, typeResult.ok ? typeResult.ac : []]) {
      for (const a of list) {
        if (!isE6b(a)) continue;
        if (a.lat == null || a.lon == null) continue;
        const hex = (a.hex ?? "").replace("~", "");
        if (!hex || seen.has(hex)) continue;
        seen.add(hex);
        hits.push(a);
      }
    }

    const liveSamples = hits.slice(0, 8).map((a) => {
      const alt =
        typeof a.alt_baro === "number"
          ? a.alt_baro
          : a.alt_baro === "ground"
            ? 0
            : Number(a.alt_baro) || 0;
      return {
        callsign: (a.flight ?? "").trim() || "—",
        aircraftType: a.t || a.desc || "E6?",
        lat: a.lat!,
        lon: a.lon!,
        altitude: alt,
        gs: typeof a.gs === "number" ? a.gs : null,
        hex: (a.hex ?? "").replace("~", "") || undefined,
      };
    });

    const feedFailed = !mil.ok && !typeResult.ok;
    const samples = mergeE6bSticky(liveSamples, {
      feedFullyFailed: feedFailed && liveSamples.length === 0,
      sampledAt,
    });

    const airborneCount = hits.length;
    const stickyCount = samples.filter((s) => s.stale).length;
    const regime: KhargPickaxeCluster["e6b"]["regime"] =
      airborneCount > 0 ? "airborne" : "quiet";
    const read =
      airborneCount > 0
        ? `${airborneCount} E-6B / TACAMO-ish track(s) on adsb.lol (callsigns VAMPIRE/GAZE or type E6). Elevated Looking-Glass / Doomsday posture — pair with ARG sprint before treating as Pickaxe go.`
        : stickyCount > 0
          ? `No live E-6B — ${stickyCount} LAST-KNOWN pin(s) within ~20m sticky TTL (often dark/ground). Quiet Doomsday on free ADS-B; sticky is awareness only.`
          : "No E-6B / VAMPIRE / GAZE / TACAMO visible on adsb.lol mil+type feed right now (often dark or ground). Quiet Doomsday posture on free ADS-B.";

    return {
      airborneCount,
      samples,
      regime,
      read,
      source: "adsb.lol shared mil + type/E6",
      error: feedFailed
        ? `mil:${mil.error ?? mil.status}`
        : undefined,
    };
  } catch (err) {
    const samples = mergeE6bSticky([], {
      feedFullyFailed: true,
      sampledAt,
    });
    return {
      airborneCount: 0,
      samples,
      regime: samples.length > 0 ? "quiet" : "unknown",
      read:
        samples.length > 0
          ? `E-6B ADS-B query failed — showing ${samples.length} LAST-KNOWN pin(s) (~20m TTL). Awareness only.`
          : "E-6B ADS-B query failed.",
      source: "adsb.lol",
      error: String(err),
    };
  }
}

async function fetchAmphibiousSprint(): Promise<
  KhargPickaxeCluster["amphibious"]
> {
  const vesselsSpec: Array<{
    key: "bataan" | "boxer" | "newYork";
    name: string;
    hull: string;
    role: string;
    mmsiHint: string | null;
    links: Array<{ label: string; href: string }>;
  }> = [
    {
      key: "bataan",
      name: "USS Bataan",
      hull: "LHD-5",
      role: "Primary ARG flagship / 26th MEU — main tell for Kharg amphibious seizure",
      mmsiHint: null,
      links: [
        {
          label: "CruisingEarth · Bataan (stale-risk)",
          href: "https://www.cruisingearth.com/ship-tracker/united-states-navy/uss-bataan/",
        },
        {
          label: "MarineTraffic · Bataan",
          href: "https://www.marinetraffic.com/en/ais/index/search/all?keyword=BATAAN",
        },
        {
          label: "VesselFinder · Bataan",
          href: "https://www.vesselfinder.com/vessels?name=BATAAN",
        },
        {
          label: "MyShipTracking · Bataan",
          href: "https://www.myshiptracking.com/vessels?name=BATAAN",
        },
      ],
    },
    {
      key: "boxer",
      name: "USS Boxer",
      hull: "LHD-4",
      role: "Sister Wasp-class LHD — dual-ARG / full invasion prep if also moving in Gulf/Red Sea with Bataan",
      mmsiHint: null,
      links: [
        {
          label: "CruisingEarth · Boxer (stale-risk)",
          href: "https://www.cruisingearth.com/ship-tracker/united-states-navy/uss-boxer/",
        },
        {
          label: "MarineTraffic · Boxer",
          href: "https://www.marinetraffic.com/en/ais/index/search/all?keyword=BOXER+LHD",
        },
        {
          label: "VesselFinder · Boxer",
          href: "https://www.vesselfinder.com/vessels?name=BOXER",
        },
        {
          label: "MyShipTracking · Boxer",
          href: "https://www.myshiptracking.com/vessels?name=BOXER",
        },
      ],
    },
    {
      key: "newYork",
      name: "USS New York",
      hull: "LPD-21",
      role: "ARG San Antonio-class LPD — part of Bataan ARG check (landing / transport leg)",
      mmsiHint: null,
      links: [
        {
          label: "CruisingEarth · New York LPD (stale-risk)",
          href: "https://www.cruisingearth.com/ship-tracker/united-states-navy/uss-new-york/",
        },
        {
          label: "MarineTraffic · New York LPD",
          href: "https://www.marinetraffic.com/en/ais/index/search/all?keyword=NEW+YORK+LPD",
        },
        {
          label: "VesselFinder · New York",
          href: "https://www.vesselfinder.com/vessels?name=NEW%20YORK",
        },
        {
          label: "MyShipTracking · New York",
          href: "https://www.myshiptracking.com/vessels?name=NEW+YORK",
        },
      ],
    },
  ];

  let ironsightShips: Array<{
    name: string;
    hull: string;
    lat: number;
    lon: number;
    status: string;
    region: string;
    lastReported: string | null;
    sogKt?: number | null;
    courseDeg?: number | null;
    headingDeg?: number | null;
    destination?: string | null;
    stale?: boolean;
    ageSec?: number;
  }> = [];
  let error: string | undefined;
  {
    // Shared IRONSIGHT ships helper — last-good cache; independent of ADS-B.
    const pack = await fetchIronsightShipStamps(
      /Bataan|Boxer|New York|LHD-5|LHD-4|LPD-21/i,
    );
    ironsightShips = pack.ships;
    if (pack.error && pack.ships.length === 0) {
      const raw = pack.error;
      error =
        /fetch failed|ECONNREFUSED|ETIMEDOUT|AbortError|TimeoutError|network/i.test(
          raw,
        )
          ? "IRONSIGHT naval stamp unavailable"
          : `IRONSIGHT naval stamp unavailable (${raw.slice(0, 80)})`;
    } else if (pack.error && pack.fromCache) {
      error = pack.error;
    }
  }

  const vessels = vesselsSpec.map((v) => {
    const match =
      ironsightShips.find(
        (s) =>
          s.hull.toUpperCase() === v.hull.toUpperCase() ||
          s.name
            .toLowerCase()
            .includes(v.name.toLowerCase().replace("uss ", "")),
      ) ?? null;
    return { ...v, ironsight: match };
  });

  const anyKin = vessels.some(
    (v) =>
      v.ironsight &&
      ((v.ironsight.sogKt != null && Number.isFinite(v.ironsight.sogKt)) ||
        (v.ironsight.courseDeg != null &&
          Number.isFinite(v.ironsight.courseDeg))),
  );

  return {
    context:
      "Bataan carries a Marine Expeditionary Unit for beach/port/island assault (Kharg thesis). A real seizure package also needs air cover (e.g. a CSG such as George Washington when present in IRONSIGHT/dossier naval data) and SSGN Tomahawk shooters (e.g. Florida) when those hulls appear in the same feeds. Free bulk AIS for ARG hulls is usually unavailable — use deep links + manual posture.",
    decisionTable: [
      {
        ship: "Bataan (LHD-5)",
        check: ">15 kts toward Strait vs anchored/loitering Bahrain box",
        bullishKharg: "Sprint = assault imminent (primary tell)",
        bearishDelay:
          "Anchored/loitering = not ready; expect 24–48h reposition before weekend launch",
      },
      {
        ship: "Boxer (LHD-4)",
        check: "Also in Gulf/Red Sea and moving with Bataan",
        bullishKharg:
          "Both present + moving = massive escalation / two-ARG full invasion prep",
        bearishDelay:
          "Absent, or only idle Bataan = tit-for-tat / raid scale only",
      },
      {
        ship: "New York (LPD-21)",
        check: "Co-moving with Bataan ARG vs left behind / AIS dark idle",
        bullishKharg: "LPD sprinting with flagship = ARG package assembling",
        bearishDelay: "LPD absent/idle while Bataan idle = ARG not stepping off",
      },
    ],
    vessels,
    readOptionA:
      "Option A (Pickaxe sprint): Bataan ≥15 kts SOG toward Strait / northern Gulf; New York co-moving; Boxer also in theater and moving → stacked amphibious go-signal (bullish FRO / Hold $46c vs deal hope).",
    readOptionB:
      "Option B (delay / tit-for-tat): Bataan anchored or loitering near Bahrain; Boxer absent or idle; New York not closing — ARG posture does not confirm weekend Kharg seizure; wait for E-6B + IRGC dispersal corroboration.",
    note: anyKin
      ? "IRONSIGHT ships payload includes SOG/course — 5-Lock L1 + Map stamps auto-refresh kinematics when present. Sticky last-known still applies when feed drops."
      : "IRONSIGHT /api/ships is static OSINT (lat/lon/status) — no live SOG/course today. L1 sprint stays unknown until IRONSIGHT enriches kinematics or you mark SOG from a fresh AIS UI. Do not invent sprint. Sticky last-known stamps refresh positions when IRONSIGHT has them.",
    source: anyKin
      ? "IRONSIGHT /api/ships (kinematics when present) + AIS deep-links backup"
      : "IRONSIGHT /api/ships (static OSINT stamps) + AIS deep-links backup — SOG not in feed",
    error,
  };
}

async function fetchIrgcBoatChatter(): Promise<KhargPickaxeCluster["irgcBoats"]> {
  const telegramLinks = [
    { label: "t.me/SaberinFa", href: "https://t.me/SaberinFa" },
    { label: "t.me/TasnimNewsEN", href: "https://t.me/TasnimNewsEN" },
    { label: "t.me/FotrosResistancee", href: "https://t.me/FotrosResistancee" },
    { label: "t.me/irgc_news_english", href: "https://t.me/irgc_news_english" },
  ];
  const queries = [
    "IRGC boats OR speedboats OR swarm (Kharg OR Hormuz OR \"Gulf of Oman\")",
    "IRGC (dispersal OR disperse OR massing OR reinforce) (Kharg OR Bushehr OR Bandar)",
    "FotrosResistance OR irgc_news (boat OR naval OR coastal)",
  ];
  try {
    const batches = await Promise.all(
      queries.map(async (q, idx) => {
        const items = await fetchGoogleNewsRss(q, 6).catch(() => [] as NewsItem[]);
        const source =
          idx === 0 ? "boats" : idx === 1 ? "posture" : "channel-ish";
        return items.map((i) => ({ ...i, source }));
      }),
    );

    // Pull IRONSIGHT telegram if up — keyword filter for boat/IRGC/Kharg.
    let tgItems: KhargPickaxeCluster["irgcBoats"]["items"] = [];
    try {
      const res = await fetchIfIronsightUp(
        `/api/telegram?conflict=${encodeURIComponent("iran-israel")}`,
        12_000,
      );
      if (res?.ok) {
        const json = (await res.json()) as {
          posts?: Array<Record<string, unknown>>;
        };
        for (const p of json.posts ?? []) {
          const text = String(p.text ?? "");
          if (
            !/IRGC|boat|swarm|speedboat|Kharg|Hormuz|coastal|dispers|naval|Fotros/i.test(
              text,
            )
          ) {
            continue;
          }
          tgItems.push({
            source: String(p.channelLabel ?? p.channel ?? "telegram"),
            title: text.replace(/\s+/g, " ").slice(0, 180),
            link: String(p.url ?? ""),
            pubDate: p.date != null ? String(p.date) : "",
          });
        }
      }
    } catch {
      /* IRONSIGHT optional */
    }

    const seen = new Set<string>();
    const items: KhargPickaxeCluster["irgcBoats"]["items"] = [];
    for (const batch of [...batches, tgItems]) {
      for (const item of batch) {
        const key = item.title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
      }
    }

    const dispersing = items
      .filter((i) =>
        /dispers(e|al|ing)|withdraw|evacuate|away from Kharg|leave Kharg/i.test(
          i.title,
        ),
      )
      .map((i) => i.title);
    const massingOman = items
      .filter((i) =>
        /Gulf of Oman|massing|swarm|gather(ing)?|concentrate/i.test(i.title),
      )
      .map((i) => i.title);
    const reinforcingKharg = items
      .filter((i) =>
        /reinforc|defend Kharg|Kharg.*(missile|battery|boat)|fortif/i.test(
          i.title,
        ),
      )
      .map((i) => i.title);

    let regime: KhargPickaxeCluster["irgcBoats"]["regime"] = "unknown";
    if (dispersing.length > 0 && reinforcingKharg.length === 0) {
      regime = "dispersing_from_kharg";
    } else if (massingOman.length > 0 && dispersing.length === 0) {
      regime = "massing_gulf_of_oman";
    } else if (reinforcingKharg.length > 0) {
      regime = "reinforcing_kharg";
    } else if (
      dispersing.length ||
      massingOman.length ||
      reinforcingKharg.length
    ) {
      regime = "mixed";
    } else if (items.length > 0) {
      regime = "quiet";
    }

    const read = (() => {
      switch (regime) {
        case "dispersing_from_kharg":
          return "IRGC boat / coastal chatter leans dispersal away from Kharg — consistent with expecting a strike package (Pickaxe corroboration).";
        case "massing_gulf_of_oman":
          return "Fast-boat / swarm chatter leans massing in Gulf of Oman — asymmetric interdiction posture, not necessarily Kharg defense.";
        case "reinforcing_kharg":
          return "Headlines lean reinforcing Kharg defenses — Iran preparing to hold the island, not clear for US amphibious move.";
        case "mixed":
          return "Mixed IRGC boat posture keywords — skim FotrosResistancee / irgc_news_english + IRONSIGHT telegram.";
        case "quiet":
          return "No clear dispersal/massing/reinforce keywords in free news/telegram sample — mark manually after checking t.me channels.";
        default:
          return "IRGC boat chatter unavailable.";
      }
    })();

    return {
      items: items.slice(0, 16),
      telegramLinks,
      keywordHits: { dispersing, massingOman, reinforcingKharg },
      regime,
      read,
      source: "Google News RSS + IRONSIGHT telegram + t.me links",
    };
  } catch (err) {
    return {
      items: [],
      telegramLinks,
      keywordHits: { dispersing: [], massingOman: [], reinforcingKharg: [] },
      regime: "unknown",
      read: "IRGC boat news fetch failed — open t.me channels manually.",
      source: "Google News RSS + t.me",
      error: String(err),
    };
  }
}

async function fetchVlccCapeDiversion(): Promise<KhargPickaxeCluster["vlccCape"]> {
  const links = [
    {
      label: "TankerMap · oil / VLCC (no signup)",
      href: "https://tankermap.com/oil-tanker-tracker",
    },
    {
      label: "MarineTraffic · S of Yemen / Bab el-Mandeb",
      href: "https://www.marinetraffic.com/en/ais/home/centerx:45.0/centery:12.5/zoom:7",
    },
    {
      label: "VesselFinder · Gulf of Aden",
      href: "https://www.vesselfinder.com/?latitude=12.5&longitude=45.0&zoom=7",
    },
    {
      label: "MarineTraffic · Cape of Good Hope approaches",
      href: "https://www.marinetraffic.com/en/ais/home/centerx:18.5/centery:-34.5/zoom:6",
    },
  ];
  const query =
    'VLCC (Cape OR "Good Hope" OR divert OR diversion OR reroute) (Yemen OR "Bab el-Mandeb" OR Hormuz OR laden)';
  try {
    const items = await fetchGoogleNewsRss(query, 10);
    const diversionHints = items
      .filter((i) =>
        /Cape|Good Hope|divert|diversion|reroute|avoid(ing)?\s+(Red Sea|Hormuz|Bab)/i.test(
          i.title,
        ),
      )
      .map((i) => i.title);
    let regime: KhargPickaxeCluster["vlccCape"]["regime"] = "unknown";
    if (diversionHints.length >= 2) regime = "cape_diversion";
    else if (diversionHints.length === 1) regime = "mixed";
    else if (items.length > 0) regime = "normal_transit";

    const read =
      regime === "cape_diversion"
        ? "Multiple Cape / diversion headlines — laden VLCCs pricing long-war routing (bullish freight / FRO)."
        : regime === "mixed"
          ? "Some Cape-diversion chatter — confirm on MarineTraffic south of Yemen (laden VLCCs heading SW vs Suez/Bab)."
          : regime === "normal_transit"
            ? "No strong Cape-diversion spike in news — still open AIS south of Yemen and mark posture manually."
            : "Cape diversion news unavailable.";

    return {
      links,
      items,
      diversionHints,
      regime,
      read,
      readOptionA:
        "Option A (diversion): Laden VLCCs south of Yemen heading SW toward Cape / avoiding Bab — long-war freight bullish.",
      readOptionB:
        "Option B (normal): Traffic still using Red Sea / Suez corridor or sitting Hormuz — no clear Cape sprint.",
      source: "Google News RSS + MarineTraffic deep links",
    };
  } catch (err) {
    return {
      links,
      items: [],
      diversionHints: [],
      regime: "unknown",
      read: "Cape diversion RSS failed — open MarineTraffic south of Yemen manually.",
      readOptionA:
        "Option A (diversion): Laden VLCCs south of Yemen heading SW toward Cape.",
      readOptionB:
        "Option B (normal): Red Sea / Suez still in use; no Cape sprint.",
      source: "Google News RSS + MarineTraffic deep links",
      error: String(err),
    };
  }
}

async function fetchEastAfricaCape(): Promise<EastAfricaCapeState> {
  try {
    const batches = await Promise.all(
      EAST_AFRICA_RSS_QUERIES.map((q) =>
        fetchGoogleNewsRss(q, 8).catch(() => [] as NewsItem[]),
      ),
    );
    const seen = new Set<string>();
    const items: NewsItem[] = [];
    for (const batch of batches) {
      for (const i of batch) {
        const key = i.title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(i);
      }
    }
    return buildEastAfricaCapeState(items);
  } catch (err) {
    return emptyEastAfricaCape(String(err));
  }
}

async function buildKhargPickaxe(): Promise<KhargPickaxeCluster> {
  const [amphibious, e6b, irgcBoats, vlccCape] = await Promise.all([
    fetchAmphibiousSprint(),
    fetchE6bMercury(),
    fetchIrgcBoatChatter(),
    fetchVlccCapeDiversion(),
  ]);
  return {
    thesis:
      "Weekend Kharg Island / amphibious Pickaxe validation — four free signals: ARG sprint (Bataan LHD-5 + Boxer LHD-4 + New York LPD-21), E-6B Mercury airborne, IRGC fast-boat dispersal, VLCC Cape diversion.",
    fetchedAt: new Date().toISOString(),
    amphibious,
    e6b,
    irgcBoats,
    vlccCape,
  };
}

async function fetchRomeTalks(): Promise<BibiSpoilerCluster["romeTalks"]> {
  /**
   * LIVE WALKOUT CLASSIFIER DISABLED (Aug 2026).
   * Prior Rome / "delegation returning" / spoiler-path-live arm is PAST.
   * Next Israel–Lebanon Rome round is September — not a same-day binary.
   * We still pull light context RSS; regime is ALWAYS calendar_gap.
   */
  const queries = [
    "Rome (Israel OR Israeli) (Lebanon OR Lebanese) (talks OR negotiations OR September OR Sept)",
    "Hezbollah (disarmament OR disarm OR \"weapons\") (precondition OR demand OR Netanyahu OR Israel)",
    '(N12 OR Walla OR Mako) (Rome OR Lebanon OR Hezbollah) (September OR Sept OR talks OR negotiations)',
  ];
  const links = [
    { label: "N12", href: "https://www.n12.co.il/" },
    { label: "Walla", href: "https://news.walla.co.il/" },
    { label: "Mako", href: "https://www.mako.co.il/news" },
    {
      label: "Google · Rome Israel Lebanon",
      href: `https://news.google.com/search?q=${encodeURIComponent("Rome Israel Lebanon talks September")}&hl=en-US&gl=US&ceid=US:en`,
    },
    {
      label: "Google · Hezbollah disarmament",
      href: `https://news.google.com/search?q=${encodeURIComponent("Hezbollah disarmament Israel Lebanon")}&hl=en-US&gl=US&ceid=US:en`,
    },
  ];
  const FIXED_READ =
    "Rome next: September — not a same-day binary. Prior walkout / 'delegation returning' / spoiler-path-live arm is PAST and DISABLED. Do not invent a Rome walkout clock. Residual Bibi risk = Shekel spike or Natanz/Fordow nuclear-news (plus Gaza/Lebanon ground), not Rome walkout.";

  try {
    const batches = await Promise.all(
      queries.map(async (q, idx) => {
        const items = await fetchGoogleNewsRss(q, 6).catch(() => [] as NewsItem[]);
        const source =
          idx === 0 ? "rome-talks" : idx === 1 ? "disarmament" : "il-media";
        return items.map((i) => ({ ...i, source }));
      }),
    );
    const seen = new Set<string>();
    const items: BibiSpoilerCluster["romeTalks"]["items"] = [];
    for (const batch of batches) {
      for (const item of batch) {
        const key = item.title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
      }
    }

    const ROME_CALENDAR_GAP_RE =
      /\b(September|Sept\.?|Oct(?:ober)?)\b.{0,48}\b(talks?|negotiations|round|resume|return|delegation)\b|\b(talks?|negotiations|round|delegation)\b.{0,48}\b(September|Sept\.?|Oct(?:ober)?)\b|\b(next\s+round|resume[sd]?\s+in|talks?\s+(?:to\s+)?resume|scheduled\s+for\s+Sept|return\s+in\s+Sept)/i;
    const ROME_CONCLUDED_RE =
      /\b(talks?|negotiations|delegation|round)\b.{0,40}\b(end|ends|ended|ending|conclude[sd]?|over|wrap(?:s|ped)?|finish(?:ed|es)?|conclude)\b|\b(end|ended|conclude[sd]?|wrapped\s+up|over)\b.{0,40}\b(Rome|talks?|negotiations)\b|Rome.{0,24}talks?.{0,16}\b(end|ended|over|conclude)/i;

    const calendarGapHits = items
      .filter((i) => ROME_CALENDAR_GAP_RE.test(i.title))
      .map((i) => i.title);
    const calendarGap =
      calendarGapHits.length > 0
        ? calendarGapHits
        : [
            "(product rule) Rome next round September — walkout classifier disabled",
          ];
    const concluded = items
      .filter((i) => ROME_CONCLUDED_RE.test(i.title))
      .map((i) => i.title);
    const disarmamentPrecondition = items
      .filter((i) =>
        /disarm(ament)?|full\s+disarm|weapons?\s+(as\s+)?precondition|Hezbollah.*(demand|precondition|insist)|Netanyahu.*(Hezbollah|disarm)/i.test(
          i.title,
        ),
      )
      .map((i) => i.title);
    // Context only — never a live walkout arm.
    const talksOngoing = items
      .filter((i) =>
        /\b(talks|negotiations|delegation|mediation|Rome)\b/i.test(i.title),
      )
      .map((i) => i.title);

    return {
      queries,
      items: items.slice(0, 16),
      keywordHits: {
        walkout: [], // intentionally empty — live walkout arm removed
        disarmamentPrecondition,
        talksOngoing,
        concluded,
        calendarGap,
      },
      regime: romeTalksRegime(),
      read: FIXED_READ,
      links,
      source: "Google News RSS + IL media portals (walkout arm disabled)",
    };
  } catch (err) {
    return {
      queries,
      items: [],
      keywordHits: {
        walkout: [],
        disarmamentPrecondition: [],
        talksOngoing: [],
        concluded: [],
        calendarGap: [
          "(product rule) Rome next round September — walkout classifier disabled",
        ],
      },
      regime: romeTalksRegime(),
      read: FIXED_READ,
      links,
      source: "Google News RSS + IL media portals (walkout arm disabled)",
      error: String(err),
    };
  }
}

const SHEKEL_THRESHOLD = 4.0;

async function fetchShekelUsdIls(): Promise<BibiSpoilerCluster["shekel"]> {
  const symbol = "ILS=X";
  try {
    let q = await getStockQuote(symbol).catch(() => null);
    if (q?.price == null) {
      q = await getStockQuote("USDILS=X").catch(() => null);
    }
    const price = q?.price ?? null;
    const changePct = q?.changePercent ?? null;
    let regime: BibiSpoilerCluster["shekel"]["regime"] = "unknown";
    if (price == null) {
      regime = "unknown";
    } else if (price >= 3.85 || (price >= 3.6 && (changePct ?? 0) >= 1.5)) {
      regime = "spike_toward_4";
    } else if (price >= 3.35 || (changePct != null && changePct >= 0.8)) {
      regime = "firm";
    } else {
      regime = "quiet";
    }

    const read = (() => {
      switch (regime) {
        case "spike_toward_4":
          return `USD/ILS ${price?.toFixed(4) ?? "—"} moving toward ~${SHEKEL_THRESHOLD.toFixed(2)} — Shekel stress = cabinet / strike / war-risk signal. Do not fade FRO stubs into a Shekel panic open.`;
        case "firm":
          return `USD/ILS ${price?.toFixed(4) ?? "—"} (${changePct != null ? `${changePct.toFixed(2)}%` : "—"}) firming — elevated war/coalition risk premium, not yet a full ~4.00 spike.`;
        case "quiet":
          return `USD/ILS ${price?.toFixed(4) ?? "—"} quiet below ~${SHEKEL_THRESHOLD.toFixed(2)} — no Shekel panic print. Rome talks are not the live watch; residual spoiler is Shekel / Natanz–Fordow / IDF border.`;
        default:
          return "USD/ILS quote unavailable — check Yahoo ILS=X / USDILS=X manually.";
      }
    })();

    return {
      symbol: q?.symbol ?? symbol,
      price,
      changePct,
      threshold: SHEKEL_THRESHOLD,
      regime,
      read,
      source: "yahoo-finance2 ILS=X (USD/ILS)",
    };
  } catch (err) {
    return {
      symbol,
      price: null,
      changePct: null,
      threshold: SHEKEL_THRESHOLD,
      regime: "unknown",
      read: "USD/ILS quote failed — open Yahoo ILS=X manually.",
      source: "yahoo-finance2 ILS=X (USD/ILS)",
      error: String(err),
    };
  }
}

async function fetchIdfGroundMovements(): Promise<
  BibiSpoilerCluster["idfGround"]
> {
  const links = [
    {
      label: "Google · IDF Lebanon border",
      href: `https://news.google.com/search?q=${encodeURIComponent("IDF troops Lebanon border OR redeployment Hezbollah")}&hl=en-US&gl=US&ceid=US:en`,
    },
    {
      label: "Google · IDF Gaza",
      href: `https://news.google.com/search?q=${encodeURIComponent("IDF Gaza redeployment OR division")}&hl=en-US&gl=US&ceid=US:en`,
    },
    { label: "N12", href: "https://www.n12.co.il/" },
    { label: "IRONSIGHT (local)", href: IRONSIGHT_URL },
  ];
  const newsQueries = [
    "IDF (Lebanon OR Lebanese) (border OR north OR redeploy OR troops OR division OR reserve)",
    "Israel (ground forces OR troops OR reservists) (Lebanon OR Hezbollah OR \"northern front\")",
    "IDF (Gaza OR \"southern front\") (redeploy OR withdraw OR focus OR offensive)",
  ];
  try {
    const batches = await Promise.all(
      newsQueries.map(async (q, idx) => {
        const items = await fetchGoogleNewsRss(q, 6).catch(() => [] as NewsItem[]);
        const source =
          idx === 0 ? "lebanon-border" : idx === 1 ? "northern-front" : "gaza";
        return items.map((i) => ({ ...i, source }));
      }),
    );

    let ironsightOnline = false;
    let isItems: BibiSpoilerCluster["idfGround"]["items"] = [];
    try {
      const [newsRes, tgRes, regionalRes] = await Promise.all([
        fetchIfIronsightUp(
          `/api/news?conflict=${encodeURIComponent("iran-israel")}`,
          12_000,
        ),
        fetchIfIronsightUp(
          `/api/telegram?conflict=${encodeURIComponent("iran-israel")}`,
          12_000,
        ),
        fetchIfIronsightUp(
          `/api/regional-alerts?conflict=${encodeURIComponent("iran-israel")}`,
          12_000,
        ),
      ]);
      if (newsRes?.ok || tgRes?.ok || regionalRes?.ok) ironsightOnline = true;

      const pushFiltered = (
        rows: Array<Record<string, unknown>>,
        source: string,
        textKey: "title" | "text",
      ) => {
        for (const row of rows) {
          const raw = String(row[textKey] ?? row.title ?? row.text ?? "");
          if (
            !/IDF|Israel|Lebanon|Lebanese|Hezbollah|Gaza|border|redeploy|ground|troops|reserv|northern|division/i.test(
              raw,
            )
          ) {
            continue;
          }
          isItems.push({
            source,
            title: raw.replace(/\s+/g, " ").slice(0, 180),
            link: String(row.url ?? row.link ?? ""),
            pubDate:
              row.pubDate != null
                ? String(row.pubDate)
                : row.date != null
                  ? String(row.date)
                  : "",
          });
        }
      };

      if (newsRes?.ok) {
        const json = (await newsRes.json()) as unknown;
        const articles = Array.isArray(json)
          ? json
          : ((json as { news?: unknown[] }).news ?? []);
        pushFiltered(
          articles as Array<Record<string, unknown>>,
          "ironsight-news",
          "title",
        );
      }
      if (tgRes?.ok) {
        const json = (await tgRes.json()) as { posts?: unknown[] };
        pushFiltered(
          (json.posts ?? []) as Array<Record<string, unknown>>,
          "ironsight-tg",
          "text",
        );
      }
      if (regionalRes?.ok) {
        const json = (await regionalRes.json()) as unknown;
        const alerts = Array.isArray(json)
          ? json
          : ((json as { alerts?: unknown[] }).alerts ??
            (json as { items?: unknown[] }).items ??
            []);
        pushFiltered(
          alerts as Array<Record<string, unknown>>,
          "ironsight-regional",
          "title",
        );
      }
    } catch {
      /* IRONSIGHT optional */
    }

    const seen = new Set<string>();
    const items: BibiSpoilerCluster["idfGround"]["items"] = [];
    for (const batch of [...batches, isItems]) {
      for (const item of batch) {
        const key = item.title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
      }
    }

    const lebaneseBorder = items
      .filter((i) =>
        /Leban(on|ese)|northern\s+front|Hezbollah|Blue\s+Line|Metulla|Kiryat Shmona|toward\s+(the\s+)?border|border\s+(build|mass|deploy|move)/i.test(
          i.title,
        ),
      )
      .map((i) => i.title);
    const gazaFocus = items
      .filter((i) =>
        /Gaza|Rafah|Khan Younis|southern\s+front|Strip/i.test(i.title) &&
        !/Leban(on|ese)|Hezbollah|northern/i.test(i.title),
      )
      .map((i) => i.title);

    let regime: BibiSpoilerCluster["idfGround"]["regime"] = "unknown";
    if (lebaneseBorder.length >= 2 && gazaFocus.length === 0) {
      regime = "troops_lebanon_border";
    } else if (lebaneseBorder.length > 0 && gazaFocus.length > 0) {
      regime = "mixed";
    } else if (gazaFocus.length >= 2 && lebaneseBorder.length === 0) {
      regime = "gaza_focus";
    } else if (items.length > 0) {
      regime = "quiet";
    } else {
      regime = "unknown";
    }

    const read = (() => {
      const offlineNote = ironsightOnline
        ? ""
        : " IRONSIGHT offline — degraded to Google News + IL portals.";
      switch (regime) {
        case "troops_lebanon_border":
          return `IDF / northern-front chatter leans troops toward Lebanese border — consistent with spoiler pressure on Hezbollah (Rome Trap or kinetic).${offlineNote}`;
        case "gaza_focus":
          return `Ground chatter leans Gaza / southern focus — less immediate Lebanon-border massing signal for Rome spoiler.${offlineNote}`;
        case "mixed":
          return `Both Lebanon-border and Gaza keywords in the sample — skim IRONSIGHT telegram/news; dual-front posture can still support Bibi spoiler narrative.${offlineNote}`;
        case "quiet":
          return `No clear Lebanon-border redeployment spike in free news/telegram sample.${offlineNote}`;
        default:
          return `IDF ground signal unavailable.${offlineNote}`;
      }
    })();

    return {
      items: items.slice(0, 16),
      keywordHits: { lebaneseBorder, gazaFocus },
      regime,
      read,
      links,
      ironsightOnline,
      source: ironsightOnline
        ? "Google News RSS + IRONSIGHT news/telegram/regional"
        : "Google News RSS (IRONSIGHT offline)",
    };
  } catch (err) {
    return {
      items: [],
      keywordHits: { lebaneseBorder: [], gazaFocus: [] },
      regime: "unknown",
      read: "IDF ground RSS failed — open Google / N12 / IRONSIGHT manually.",
      links,
      ironsightOnline: false,
      source: "Google News RSS",
      error: String(err),
    };
  }
}

async function buildBibiSpoiler(): Promise<BibiSpoilerCluster> {
  const [romeTalks, shekel, idfGround] = await Promise.all([
    fetchRomeTalks(),
    fetchShekelUsdIls(),
    fetchIdfGroundMovements(),
  ]);
  // Rome live walkout arm is PAST — always calendar-gap framing.
  return {
    thesis:
      "Rome Israel–Lebanon next round is September — not a same-day walkout binary. Prior Rome walkout / spoiler-path-live watch is PAST and disabled. Residual Bibi risk = Shekel spike, Natanz/Fordow nuclear-news, or Gaza/Lebanon ground — not Rome walkout timing.",
    scenarios: {
      romeTrap:
        "Rome Trap (historical archive only): past Israel–Lebanon Rome rounds could look like de-escalation then collapse on disarmament preconditions. LIVE walkout clock DISABLED — next round September. Do not trade stubs off Rome walkout chatter.",
      nuclearBreakout:
        "Nuclear breakout excuse: if a Hormuz deal leaves enrichment/breakout capacity, Bibi may strike Natanz/Fordow (often Friday-night framed as defensive) → shatters deal.",
    },
    tradeImplication:
      "FRO: Rome walkout timing OFF. Hold lottery stubs as low-cost insurance vs Shekel ≥~3.85–4.0, fresh Natanz/Fordow strike headlines, or Gaza/Lebanon ground escalation — not Rome 'delegation returning' / same-day walkout.",
    fetchedAt: new Date().toISOString(),
    romeTalks,
    shekel,
    idfGround,
  };
}

type IronsightShipStamp = {
  name: string;
  hull: string;
  lat: number;
  lon: number;
  status: string;
  region: string;
  lastReported: string | null;
  /**
   * Optional kinematics when IRONSIGHT ships payload includes them.
   * Current IRONSIGHT /api/ships is static OSINT (lat/lon/status only) —
   * these stay null until the sibling enriches the feed. Never invent SOG.
   */
  sogKt?: number | null;
  courseDeg?: number | null;
  headingDeg?: number | null;
  /** AIS / voyage destination when present — never invented. */
  destination?: string | null;
  /** Dropped from live IRONSIGHT layer — map awareness only (not doctrine). */
  stale?: boolean;
  ageSec?: number;
  lastSeenAt?: string;
};

/**
 * Per-hull sticky IRONSIGHT stamps — warships go AIS/feed-dark for hours.
 * TTL 4h (within 2–6h desk window); never invent GPS for never-seen hulls.
 * Persisted so Map still shows last-known after app reopen within TTL.
 */
type StickyIronsightShip = IronsightShipStamp & { lastSeenAt: string };
const ironsightStickyByKey = new Map<string, StickyIronsightShip>();
/** Bundle age for full-pack fallback when feed errors. */
let ironsightShipsLastGood: {
  ships: IronsightShipStamp[];
  at: number;
} | null = null;
const IRONSIGHT_SHIPS_STICKY_TTL_MS = 4 * 60 * 60 * 1000;
let ironsightStickyHydrated = false;

function ironsightStickyDataDir(): string {
  if (process.env.TRADEHOLE_DATA_DIR) return process.env.TRADEHOLE_DATA_DIR;
  return path.join(os.homedir(), "Library", "Application Support", "Tradehole");
}

function ironsightStickyStorePath(): string {
  return path.join(ironsightStickyDataDir(), "ironsight-ships-sticky.json");
}

function hydrateIronsightStickyFromDisk(): void {
  if (ironsightStickyHydrated) return;
  ironsightStickyHydrated = true;
  try {
    const raw = fs.readFileSync(ironsightStickyStorePath(), "utf8");
    const json = JSON.parse(raw) as {
      at?: number;
      ships?: Array<StickyIronsightShip>;
    };
    const now = Date.now();
    const ships = Array.isArray(json.ships) ? json.ships : [];
    for (const s of ships) {
      if (!s?.lastSeenAt || !stampHasCoords(s)) continue;
      const seenAt = Date.parse(s.lastSeenAt) || 0;
      if (now - seenAt > IRONSIGHT_SHIPS_STICKY_TTL_MS) continue;
      const key = ironsightShipKey(s);
      if (!key) continue;
      ironsightStickyByKey.set(key, {
        name: String(s.name ?? ""),
        hull: String(s.hull ?? ""),
        lat: s.lat,
        lon: s.lon,
        status: String(s.status ?? ""),
        region: String(s.region ?? ""),
        lastReported: s.lastReported != null ? String(s.lastReported) : null,
        sogKt: s.sogKt ?? null,
        courseDeg: s.courseDeg ?? null,
        headingDeg: s.headingDeg ?? null,
        destination: s.destination ?? null,
        lastSeenAt: s.lastSeenAt,
      });
    }
    if (ironsightStickyByKey.size > 0) {
      ironsightShipsLastGood = {
        ships: [...ironsightStickyByKey.values()].map((s) => ({
          name: s.name,
          hull: s.hull,
          lat: s.lat,
          lon: s.lon,
          status: s.status,
          region: s.region,
          lastReported: s.lastReported,
          sogKt: s.sogKt ?? null,
          courseDeg: s.courseDeg ?? null,
          headingDeg: s.headingDeg ?? null,
          destination: s.destination ?? null,
        })),
        at: typeof json.at === "number" ? json.at : now,
      };
    }
  } catch {
    /* missing / corrupt — start empty */
  }
}

function persistIronsightStickyToDisk(): void {
  try {
    const now = Date.now();
    const ships = [...ironsightStickyByKey.values()].filter((s) => {
      const seenAt = Date.parse(s.lastSeenAt) || 0;
      return now - seenAt <= IRONSIGHT_SHIPS_STICKY_TTL_MS && stampHasCoords(s);
    });
    fs.mkdirSync(ironsightStickyDataDir(), { recursive: true });
    fs.writeFileSync(
      ironsightStickyStorePath(),
      JSON.stringify({ at: now, ships }, null, 2),
      "utf8",
    );
  } catch (err) {
    console.warn("[tradehole] ironsight sticky persist failed:", err);
  }
}

function ironsightShipKey(s: Pick<IronsightShipStamp, "hull" | "name">): string {
  const h = String(s.hull ?? "")
    .replace(/\s+/g, "")
    .toLowerCase();
  if (h) return `hull:${h}`;
  const n = String(s.name ?? "")
    .replace(/^u\.?s\.?s\.?\s+/i, "")
    .replace(/\s+/g, "")
    .toLowerCase();
  return n ? `name:${n}` : "";
}

function parseShipCoord(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function parseOptionalShipNum(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Pull SOG / course / heading from whatever field names IRONSIGHT (or a
 * future enrichment) may use. Returns null when absent — do not invent.
 */
function parseShipKinematics(s: Record<string, unknown>): {
  sogKt: number | null;
  courseDeg: number | null;
  headingDeg: number | null;
} {
  const motion = s.motion as Record<string, unknown> | undefined;
  const ais = s.ais as Record<string, unknown> | undefined;
  const nav = s.nav as Record<string, unknown> | undefined;
  const kinematics = s.kinematics as Record<string, unknown> | undefined;
  const sog =
    parseOptionalShipNum(s.sog) ??
    parseOptionalShipNum(s.SOG) ??
    parseOptionalShipNum(s.speed) ??
    parseOptionalShipNum(s.speedKt) ??
    parseOptionalShipNum(s.speedKts) ??
    parseOptionalShipNum(s.sogKt) ??
    parseOptionalShipNum(s.Speed) ??
    parseOptionalShipNum(motion?.sog) ??
    parseOptionalShipNum(motion?.speed) ??
    parseOptionalShipNum(ais?.sog) ??
    parseOptionalShipNum(ais?.speed) ??
    parseOptionalShipNum(nav?.sog) ??
    parseOptionalShipNum(nav?.speed) ??
    parseOptionalShipNum(kinematics?.sog) ??
    parseOptionalShipNum(kinematics?.speed);
  const course =
    parseOptionalShipNum(s.course) ??
    parseOptionalShipNum(s.cog) ??
    parseOptionalShipNum(s.COG) ??
    parseOptionalShipNum(s.courseDeg) ??
    parseOptionalShipNum(s.courseOverGround) ??
    parseOptionalShipNum(motion?.course) ??
    parseOptionalShipNum(motion?.cog) ??
    parseOptionalShipNum(ais?.course) ??
    parseOptionalShipNum(ais?.cog) ??
    parseOptionalShipNum(nav?.course) ??
    parseOptionalShipNum(nav?.cog) ??
    parseOptionalShipNum(kinematics?.course) ??
    parseOptionalShipNum(kinematics?.cog);
  const heading =
    parseOptionalShipNum(s.heading) ??
    parseOptionalShipNum(s.hdg) ??
    parseOptionalShipNum(s.trueHeading) ??
    parseOptionalShipNum(s.headingDeg) ??
    parseOptionalShipNum(s.Heading) ??
    parseOptionalShipNum(motion?.heading) ??
    parseOptionalShipNum(ais?.heading) ??
    parseOptionalShipNum(nav?.heading) ??
    parseOptionalShipNum(kinematics?.heading);
  return {
    sogKt: sog,
    courseDeg: course ?? heading,
    headingDeg: heading,
  };
}

function parseShipDestination(s: Record<string, unknown>): string | null {
  const ais = s.ais as Record<string, unknown> | undefined;
  const voyage = s.voyage as Record<string, unknown> | undefined;
  const raw =
    s.destination ??
    s.dest ??
    s.destinationName ??
    s.etaDestination ??
    s.nextPort ??
    s.portOfDestination ??
    ais?.destination ??
    ais?.dest ??
    voyage?.destination ??
    voyage?.dest;
  if (raw == null) return null;
  const str = String(raw).trim();
  if (!str || /^n\/?a$/i.test(str) || str === "-" || str === "—") return null;
  return str.slice(0, 80);
}

function parseShipLastReported(s: Record<string, unknown>): string | null {
  const ais = s.ais as Record<string, unknown> | undefined;
  const position = s.position as Record<string, unknown> | undefined;
  const candidates = [
    s.lastReported,
    s.updatedAt,
    s.updated,
    s.timestamp,
    s.time,
    s.lastSeen,
    s.last_seen,
    s.seenAt,
    s.lastUpdate,
    s.lastUpdated,
    s.positionUpdatedAt,
    s.aisUpdatedAt,
    s.reportedAt,
    s.ts,
    ais?.updatedAt,
    ais?.timestamp,
    ais?.lastSeen,
    position?.updatedAt,
    position?.timestamp,
  ];
  for (const c of candidates) {
    if (c == null) continue;
    if (typeof c === "number" && Number.isFinite(c)) {
      // Seconds vs ms heuristic
      const ms = c < 1e12 ? c * 1000 : c;
      const iso = new Date(ms).toISOString();
      if (iso !== "Invalid Date") return iso;
    }
    const str = String(c).trim();
    if (!str) continue;
    const parsed = Date.parse(str);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
    // Keep opaque feed strings (e.g. "2026-08-01 OSINT")
    return str.slice(0, 64);
  }
  return null;
}

function mapIronsightShipRecord(
  s: Record<string, unknown>,
): IronsightShipStamp {
  const pos = s.position as
    | { lat?: unknown; lon?: unknown; lng?: unknown; latitude?: unknown; longitude?: unknown }
    | undefined;
  const latRaw =
    s.lat ??
    s.latitude ??
    s.Lat ??
    pos?.lat ??
    pos?.latitude;
  const lonRaw =
    s.lon ??
    s.lng ??
    s.longitude ??
    s.Lon ??
    pos?.lon ??
    pos?.lng ??
    pos?.longitude;
  const kin = parseShipKinematics(s);
  return {
    name: String(s.name ?? s.label ?? ""),
    hull: String(s.hull ?? s.pennant ?? ""),
    lat: parseShipCoord(latRaw),
    lon: parseShipCoord(lonRaw),
    status: String(s.status ?? s.posture ?? ""),
    region: String(s.region ?? s.theater ?? ""),
    lastReported: parseShipLastReported(s),
    sogKt: kin.sogKt,
    courseDeg: kin.courseDeg,
    headingDeg: kin.headingDeg,
    destination: parseShipDestination(s),
  };
}

/** Approx FIR / operating boxes for Gulf radio_hole NOTAM titles (RSS — not official geometry). */
const GULF_NOTAM_GEO_ZONES: Array<{
  id: string;
  label: string;
  match: RegExp;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}> = [
  {
    id: "gulf-notam-bahrain",
    label: "Bahrain FIR",
    match: /Bahrain|OBBI|Fifth\s+Fleet|Manama/i,
    latMin: 25.0,
    latMax: 27.5,
    lonMin: 49.5,
    lonMax: 52.0,
  },
  {
    id: "gulf-notam-n-gulf",
    label: "Northern Persian Gulf",
    match:
      /Northern\s+(Persian\s+)?Gulf|Persian\s+Gulf|Arabian\s+Gulf|CENTCOM|Qatar/i,
    latMin: 27.0,
    latMax: 30.2,
    lonMin: 48.5,
    lonMax: 52.5,
  },
  {
    id: "gulf-notam-hormuz",
    label: "Hormuz / Strait",
    match: /Hormuz|Strait\s+of\s+Hormuz|Gulf\s+of\s+Oman|Bandar\s+Abbas/i,
    latMin: 24.8,
    latMax: 27.4,
    lonMin: 55.0,
    lonMax: 58.2,
  },
];

/**
 * Soft Iraq / Mesopotamia NOTAM FIR approximations (RSS title geo — not official).
 * Map + desk awareness only; does not print Israel AER-02 High-go peer.
 * Same honesty as Cyprus/LLBG boxes: keyword → rough FIR rect.
 */
const IRAQ_NOTAM_GEO_ZONES: Array<{
  id: string;
  label: string;
  match: RegExp;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}> = [
  {
    id: "iraq-notam-baghdad",
    label: "Baghdad FIR / ORBB",
    match: /Baghdad|\bORBB\b|Iraq\s+FIR|Iraqi\s+airspace/i,
    latMin: 31.5,
    latMax: 35.5,
    lonMin: 42.0,
    lonMax: 47.0,
  },
  {
    id: "iraq-notam-mesopotamia",
    label: "Iraq / Mesopotamia",
    match: /Iraq|Mesopotamia|Basra|\bORMM\b|Erbil|\bORER\b|Mosul|Kirkuk/i,
    latMin: 29.5,
    latMax: 37.2,
    lonMin: 39.0,
    lonMax: 48.5,
  },
];

const GULF_NAVWARN_GEO_ZONES: Array<{
  id: string;
  label: string;
  match: RegExp;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}> = [
  {
    id: "gulf-navwarn-n-gulf",
    label: "NAVWARN · N. Persian Gulf",
    match: /Northern\s+(Persian\s+)?Gulf|Persian\s+Gulf|Arabian\s+Gulf|Bahrain/i,
    latMin: 27.2,
    latMax: 30.0,
    lonMin: 48.8,
    lonMax: 52.2,
  },
  {
    id: "gulf-navwarn-kharg",
    label: "NAVWARN · Kharg approach",
    match: /Kharg/i,
    latMin: 28.5,
    latMax: 30.0,
    lonMin: 49.5,
    lonMax: 51.2,
  },
  {
    id: "gulf-navwarn-hormuz",
    label: "NAVWARN · Hormuz / Strait",
    match: /Hormuz|Strait|Gulf\s+of\s+Oman/i,
    latMin: 25.0,
    latMax: 27.2,
    lonMin: 55.2,
    lonMax: 57.8,
  },
];

function stampHasCoords(s: IronsightShipStamp): boolean {
  return (
    Number.isFinite(s.lat) &&
    Number.isFinite(s.lon) &&
    !(s.lat === 0 && s.lon === 0)
  );
}

function classifyTheaterStampKind(
  s: IronsightShipStamp,
): TheaterMapStamp["kind"] {
  const blob = `${s.name} ${s.hull} ${s.region}`;
  if (
    /Bataan|Boxer|New\s*York|LHD-5|LHD-4|LPD-21|\bARG\b|amphib|Wasp.?class|San\s+Antonio/i.test(
      blob,
    )
  ) {
    return "arg";
  }
  if (
    /Florida|SSGN|Ohio.?class|Georgia\b|Michigan\b|Tomahawk|guided.?missile\s+sub/i.test(
      blob,
    )
  ) {
    return "ssgn";
  }
  if (
    /Philippine\s+Sea|George\s+Washington|Carl\s+Vinson|Theodore\s+Roosevelt|CVN-?\d|Nimitz|Gerald\s+R\.?\s*Ford|carrier\s+strike|\bCSG\b/i.test(
      blob,
    )
  ) {
    return "csg";
  }
  // IRGC / auxiliaries / bases / other hulls with coords stay "naval" — plot all.
  return "naval";
}

function stampReportedMs(lastReported: string | null | undefined): number {
  if (!lastReported) return 0;
  const t = Date.parse(lastReported);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Dedupe IRONSIGHT stamps by hull/name (+ near-duplicate positions).
 * Keeps the freshest lastReported; never invents GPS.
 */
function dedupeIronsightStamps(
  ships: IronsightShipStamp[],
): IronsightShipStamp[] {
  const kept: IronsightShipStamp[] = [];

  const isSameHull = (a: IronsightShipStamp, b: IronsightShipStamp): boolean => {
    const ah = String(a.hull ?? "")
      .replace(/\s+/g, "")
      .toLowerCase();
    const bh = String(b.hull ?? "")
      .replace(/\s+/g, "")
      .toLowerCase();
    if (ah && bh && ah === bh) return true;
    const an = String(a.name ?? "")
      .replace(/^u\.?s\.?s\.?\s+/i, "")
      .replace(/\s+/g, "")
      .toLowerCase();
    const bn = String(b.name ?? "")
      .replace(/^u\.?s\.?s\.?\s+/i, "")
      .replace(/\s+/g, "")
      .toLowerCase();
    if (an && bn && (an === bn || an.includes(bn) || bn.includes(an))) return true;
    return false;
  };

  for (const s of ships) {
    if (!stampHasCoords(s)) continue;
    const idx = kept.findIndex((prev) => {
      if (isSameHull(prev, s)) return true;
      // Same identity-ish name within ~0.35° → treat as duplicate stamp.
      if (
        isSameHull(prev, s) === false &&
        Math.abs(prev.lat - s.lat) < 0.35 &&
        Math.abs(prev.lon - s.lon) < 0.35
      ) {
        const an = String(s.name ?? "")
          .replace(/^u\.?s\.?s\.?\s+/i, "")
          .toLowerCase();
        const bn = String(prev.name ?? "")
          .replace(/^u\.?s\.?s\.?\s+/i, "")
          .toLowerCase();
        if (an && bn && (an.includes(bn.slice(0, 5)) || bn.includes(an.slice(0, 5)))) {
          return true;
        }
      }
      return false;
    });
    if (idx < 0) {
      kept.push(s);
      continue;
    }
    if (
      stampReportedMs(s.lastReported) >=
      stampReportedMs(kept[idx]!.lastReported)
    ) {
      kept[idx] = s;
    }
  }
  return kept;
}

function shortAdsbWatchLabel(box: TheaterAdsbBoxDef): string {
  const id = box.id.replace(/^adsb-/, "");
  const map: Record<string, string> = {
    gulf: "Gulf",
    iraq: "Iraq",
    "syria-jazira": "Syria",
    saudi: "Saudi",
    iran: "Iran",
    redsea: "Red Sea",
    bab: "Bab",
    somali: "Somali",
    arabian: "Arabian",
  };
  return map[id] ?? box.label.replace(/^ADS-B\s+/i, "");
}

function buildTheaterMapOverlays(args: {
  radioStatus: BataanGhostSignStatus;
  notamTitles: string[];
  /** Soft Iraq / Baghdad FIR NOTAM titles (map only — not AER-02 High-go). */
  iraqNotamTitles?: string[];
  iraqNotamStatus?: BataanGhostSignStatus;
  navStatus: BataanGhostSignStatus;
  navTitles: string[];
  /** All IRONSIGHT hulls that already have lat/lon (no invented GPS). */
  navalShips: IronsightShipStamp[];
  /** ADS-B box fetch status from sequential multi-box sample. */
  adsbBoxesOk?: string[];
  adsbBoxesFailed?: string[];
  /** Live tanker/AWACS/mil counts per box id (adsb-iraq → N). Empty ≠ not watching. */
  adsbBoxTrackCounts?: Record<string, number>;
}): TheaterMapOverlays {
  const zones: TheaterMapZone[] = [];
  const stamps: TheaterMapStamp[] = [];

  const failedKeys = new Set(
    (args.adsbBoxesFailed ?? []).map((f) => {
      const id = f.split(":")[0] ?? f;
      return id.startsWith("adsb-") ? id : `adsb-${id}`;
    }),
  );
  const trackCounts = args.adsbBoxTrackCounts ?? {};

  // Always show where wide-theater ADS-B samples are drawn from — even at 0 tracks.
  for (const box of THEATER_ADSB_BOXES) {
    const key = box.id;
    const short = box.id.replace(/^adsb-/, "");
    const failed = failedKeys.has(key) || failedKeys.has(`adsb-${short}`);
    const live =
      trackCounts[key] ??
      trackCounts[`adsb-${short}`] ??
      trackCounts[short] ??
      0;
    const shortName = shortAdsbWatchLabel(box);
    const watchLabel = `ADS-B ${shortName} · watching · ${live}`;
    zones.push({
      id: box.id,
      kind: "adsb_box",
      label: watchLabel,
      status: failed ? "failed" : "info",
      latMin: box.latMin,
      latMax: box.latMax,
      lonMin: box.lonMin,
      lonMax: box.lonMax,
      titles: [
        `${box.label} · watching · ${live} live`,
        box.countsForGulfRegime
          ? "Gulf regime counts (mass_stack / 5-Lock)"
          : box.region === "iraq_bridge"
            ? "Iraq / Levant–Gulf bridge plot-only — not Gulf mass_stack, not Israel High-go"
            : "Wider theater plot-only — not Gulf mass_stack, not Israel High-go",
      ],
    });
  }

  const theaterAis = getTheaterAisSnapshot();
  for (const box of theaterAis.boxes) {
    const live = box.militaryCount + box.interestCount + box.tankerCount;
    const aisStatus: TheaterMapZone["status"] =
      !theaterAis.enabled || theaterAis.status === "disabled"
        ? "unknown"
        : theaterAis.status === "live" && live >= 2
          ? "hot"
          : theaterAis.status === "live" && live >= 1
            ? "warm"
            : theaterAis.status === "live"
              ? "info"
              : theaterAis.status === "empty" || theaterAis.status === "stale"
                ? "unknown"
                : "failed";
    zones.push({
      id: `ais-${box.id}`,
      kind: "ais_box",
      label: !theaterAis.enabled
        ? `${box.label} · KEY UNSET`
        : theaterAis.status === "live"
          ? `${box.label} · LIVE · ${live}`
          : `${box.label} · ${theaterAis.status}`,
      status: aisStatus,
      latMin: box.latMin,
      latMax: box.latMax,
      lonMin: box.lonMin,
      lonMax: box.lonMax,
      titles: [
        theaterAis.note,
        `mil ${box.militaryCount} · tanker ${box.tankerCount} · interest ${box.interestCount} · plot-only (not NAV-01)`,
      ],
    });
  }

  if (args.radioStatus === "warm" || args.radioStatus === "hot") {
    const matched = new Set<string>();
    for (const title of args.notamTitles) {
      let hit = false;
      for (const geo of GULF_NOTAM_GEO_ZONES) {
        if (!geo.match.test(title)) continue;
        hit = true;
        matched.add(geo.id);
        const existing = zones.find((z) => z.id === geo.id);
        if (existing) {
          existing.titles = [...(existing.titles ?? []), title].slice(0, 4);
          if (
            args.radioStatus === "hot" ||
            (args.radioStatus === "warm" && existing.status !== "hot")
          ) {
            existing.status = args.radioStatus;
          }
        } else {
          zones.push({
            id: geo.id,
            kind: "notam",
            label: `NOTAM · ${geo.label}`,
            status: args.radioStatus,
            latMin: geo.latMin,
            latMax: geo.latMax,
            lonMin: geo.lonMin,
            lonMax: geo.lonMax,
            titles: [title],
          });
        }
      }
      if (!hit && !matched.has("gulf-notam-n-gulf")) {
        const fallback = GULF_NOTAM_GEO_ZONES.find(
          (g) => g.id === "gulf-notam-n-gulf",
        )!;
        matched.add(fallback.id);
        zones.push({
          id: fallback.id,
          kind: "notam",
          label: `NOTAM · ${fallback.label}`,
          status: args.radioStatus,
          latMin: fallback.latMin,
          latMax: fallback.latMax,
          lonMin: fallback.lonMin,
          lonMax: fallback.lonMax,
          titles: [title],
        });
      } else if (!hit) {
        const z = zones.find((x) => x.id === "gulf-notam-n-gulf");
        if (z) z.titles = [...(z.titles ?? []), title].slice(0, 4);
      }
    }
  }

  // Soft Iraq / Baghdad FIR NOTAM zones — map awareness only (not AER-02).
  const iraqTitles = args.iraqNotamTitles ?? [];
  const iraqStatus = args.iraqNotamStatus ?? "quiet";
  if (iraqTitles.length > 0 && (iraqStatus === "warm" || iraqStatus === "hot")) {
    const matched = new Set<string>();
    for (const title of iraqTitles) {
      let hit = false;
      for (const geo of IRAQ_NOTAM_GEO_ZONES) {
        if (!geo.match.test(title)) continue;
        hit = true;
        matched.add(geo.id);
        const existing = zones.find((z) => z.id === geo.id);
        if (existing) {
          existing.titles = [...(existing.titles ?? []), title].slice(0, 4);
          if (
            iraqStatus === "hot" ||
            (iraqStatus === "warm" && existing.status !== "hot")
          ) {
            existing.status = iraqStatus;
          }
        } else {
          zones.push({
            id: geo.id,
            kind: "notam",
            label: `NOTAM · ${geo.label}`,
            status: iraqStatus,
            latMin: geo.latMin,
            latMax: geo.latMax,
            lonMin: geo.lonMin,
            lonMax: geo.lonMax,
            titles: [title],
          });
        }
      }
      if (!hit && !matched.has("iraq-notam-mesopotamia")) {
        const fallback = IRAQ_NOTAM_GEO_ZONES.find(
          (g) => g.id === "iraq-notam-mesopotamia",
        )!;
        matched.add(fallback.id);
        zones.push({
          id: fallback.id,
          kind: "notam",
          label: `NOTAM · ${fallback.label}`,
          status: iraqStatus,
          latMin: fallback.latMin,
          latMax: fallback.latMax,
          lonMin: fallback.lonMin,
          lonMax: fallback.lonMax,
          titles: [title],
        });
      } else if (!hit) {
        const z = zones.find((x) => x.id === "iraq-notam-mesopotamia");
        if (z) z.titles = [...(z.titles ?? []), title].slice(0, 4);
      }
    }
  }

  if (args.navStatus === "warm" || args.navStatus === "hot") {
    const matched = new Set<string>();
    for (const title of args.navTitles) {
      let hit = false;
      for (const geo of GULF_NAVWARN_GEO_ZONES) {
        if (!geo.match.test(title)) continue;
        hit = true;
        matched.add(geo.id);
        const existing = zones.find((z) => z.id === geo.id);
        if (existing) {
          existing.titles = [...(existing.titles ?? []), title].slice(0, 4);
          if (
            args.navStatus === "hot" ||
            (args.navStatus === "warm" && existing.status !== "hot")
          ) {
            existing.status = args.navStatus;
          }
        } else {
          zones.push({
            id: geo.id,
            kind: "nav_watch",
            label: geo.label,
            status: args.navStatus,
            latMin: geo.latMin,
            latMax: geo.latMax,
            lonMin: geo.lonMin,
            lonMax: geo.lonMax,
            titles: [title],
          });
        }
      }
      if (!hit && !matched.has("gulf-navwarn-n-gulf")) {
        const fallback = GULF_NAVWARN_GEO_ZONES.find(
          (g) => g.id === "gulf-navwarn-n-gulf",
        )!;
        matched.add(fallback.id);
        zones.push({
          id: fallback.id,
          kind: "nav_watch",
          label: fallback.label,
          status: args.navStatus,
          latMin: fallback.latMin,
          latMax: fallback.latMax,
          lonMin: fallback.lonMin,
          lonMax: fallback.lonMax,
          titles: [title],
        });
      } else if (!hit) {
        const z = zones.find((x) => x.id === "gulf-navwarn-n-gulf");
        if (z) z.titles = [...(z.titles ?? []), title].slice(0, 4);
      }
    }
  }

  // Exhaust every IRONSIGHT hull/asset/base with real lat/lon — dedupe freshest.
  const dedupedShips = dedupeIronsightStamps(args.navalShips);
  for (const s of dedupedShips) {
    const kind = classifyTheaterStampKind(s);
    const id = `${kind}-${s.hull || s.name}`.replace(/\s+/g, "-");
    const ageBit =
      s.stale && s.ageSec != null ? ` · ${ageLabelFromSec(s.ageSec)}` : "";
    const kinBits: string[] = [];
    if (s.sogKt != null && Number.isFinite(s.sogKt)) {
      kinBits.push(`${s.sogKt.toFixed(1)} kt`);
    }
    const course = s.courseDeg ?? s.headingDeg;
    if (course != null && Number.isFinite(course)) {
      kinBits.push(`crs ${Math.round(course)}°`);
    }
    if (s.destination) kinBits.push(`→ ${s.destination}`);
    const kinBit = kinBits.length ? ` · ${kinBits.join(" · ")}` : "";
    stamps.push({
      id,
      kind,
      label: s.name || s.hull || kind.toUpperCase(),
      lat: s.lat,
      lon: s.lon,
      status: s.status,
      region: s.region,
      lastReported: s.lastReported,
      sogKt: s.sogKt ?? null,
      courseDeg: course ?? null,
      destination: s.destination ?? null,
      stale: s.stale === true,
      ageSec: s.ageSec,
      lastSeenAt: s.lastSeenAt,
      meta: `${s.stale ? "DARK / LAST-KNOWN" : "LIVE"} · ${s.status} · ${s.region}${kinBit}${s.lastReported ? ` · ${s.lastReported}` : ""}${ageBit}`,
    });
  }

  const aisPoints = theaterAis.vessels.map((v) => ({
    id: `ais-${v.boxId}-${v.mmsi}`,
    kind: "ais_vessel" as const,
    label: v.name || v.mmsi,
    category: v.category,
    lat: v.lat,
    lon: v.lon,
    sog: v.sog,
    cog: v.cog,
    boxId: v.boxId,
  }));

  return {
    zones,
    stamps,
    aisPoints,
    radioHoleStatus: args.radioStatus,
    navwarnStatus: args.navStatus,
  };
}

function ageLabelFromSec(ageSec: number): string {
  if (ageSec < 60) return `${ageSec}s`;
  if (ageSec < 3600) return `${Math.round(ageSec / 60)}m`;
  const h = Math.floor(ageSec / 3600);
  const m = Math.round((ageSec % 3600) / 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

export function carryForwardTheaterStamps(
  next: TheaterMapStamp[],
  prev: TheaterMapStamp[] | undefined,
  prevAt?: number,
): TheaterMapStamp[] {
  if (next.length > 0) return next;
  if (!prev?.length) return next;
  const ageSec = prevAt
    ? Math.max(0, Math.round((Date.now() - prevAt) / 1000))
    : undefined;
  return prev.map((s) => ({
    ...s,
    stale: true,
    ageSec: s.ageSec ?? ageSec,
    meta: s.meta?.includes("DARK")
      ? s.meta
      : `DARK / LAST-KNOWN · ${s.status} · ${s.region}`,
  }));
}

/** Merge live IRONSIGHT stamps with per-hull sticky last-known (map awareness). */
function mergeIronsightSticky(
  liveWithCoords: IronsightShipStamp[],
  opts: { feedFailed: boolean; nameRe?: RegExp; now?: number },
): IronsightShipStamp[] {
  hydrateIronsightStickyFromDisk();
  const now = opts.now ?? Date.now();
  const sampledAt = new Date(now).toISOString();

  if (!opts.feedFailed && liveWithCoords.length > 0) {
    for (const s of liveWithCoords) {
      const key = ironsightShipKey(s);
      if (!key) continue;
      ironsightStickyByKey.set(key, {
        ...s,
        stale: undefined,
        ageSec: undefined,
        lastSeenAt: sampledAt,
      });
    }
    ironsightShipsLastGood = {
      ships: liveWithCoords.map((s) => ({
        name: s.name,
        hull: s.hull,
        lat: s.lat,
        lon: s.lon,
        status: s.status,
        region: s.region,
        lastReported: s.lastReported,
        sogKt: s.sogKt ?? null,
        courseDeg: s.courseDeg ?? null,
        headingDeg: s.headingDeg ?? null,
        destination: s.destination ?? null,
      })),
      at: now,
    };
    persistIronsightStickyToDisk();
  }

  const liveKeys = new Set(
    opts.feedFailed
      ? []
      : liveWithCoords.map((s) => ironsightShipKey(s)).filter(Boolean),
  );

  const out: IronsightShipStamp[] = opts.feedFailed
    ? []
    : liveWithCoords
        .filter((s) =>
          opts.nameRe ? opts.nameRe.test(`${s.name} ${s.hull}`) : true,
        )
        .map((s) => ({ ...s, stale: false }));

  for (const [key, snap] of [...ironsightStickyByKey.entries()]) {
    const seenAt = Date.parse(snap.lastSeenAt) || 0;
    const ageMs = Math.max(0, now - seenAt);
    if (ageMs > IRONSIGHT_SHIPS_STICKY_TTL_MS) {
      ironsightStickyByKey.delete(key);
      continue;
    }
    if (opts.nameRe && !opts.nameRe.test(`${snap.name} ${snap.hull}`)) {
      continue;
    }
    if (liveKeys.has(key)) continue;
    if (!stampHasCoords(snap)) continue;
    out.push({
      name: snap.name,
      hull: snap.hull,
      lat: snap.lat,
      lon: snap.lon,
      status: snap.status,
      region: snap.region,
      lastReported: snap.lastReported,
      sogKt: snap.sogKt ?? null,
      courseDeg: snap.courseDeg ?? null,
      headingDeg: snap.headingDeg ?? null,
      destination: snap.destination ?? null,
      stale: true,
      ageSec: Math.max(0, Math.round(ageMs / 1000)),
      lastSeenAt: snap.lastSeenAt,
    });
  }

  if (
    opts.feedFailed &&
    out.length === 0 &&
    ironsightShipsLastGood &&
    now - ironsightShipsLastGood.at <= IRONSIGHT_SHIPS_STICKY_TTL_MS
  ) {
    const ageSec = Math.max(0, Math.round((now - ironsightShipsLastGood.at) / 1000));
    for (const s of ironsightShipsLastGood.ships) {
      if (!stampHasCoords(s)) continue;
      if (opts.nameRe && !opts.nameRe.test(`${s.name} ${s.hull}`)) continue;
      out.push({
        ...s,
        stale: true,
        ageSec,
      });
    }
  }

  return out;
}

async function fetchIronsightShipStamps(
  nameRe?: RegExp,
): Promise<{ ships: IronsightShipStamp[]; error?: string; fromCache?: boolean }> {
  try {
    const res = await fetchIfIronsightUp(
      `/api/ships?conflict=${encodeURIComponent("iran-israel")}`,
      12_000,
    );
    if (!res) throw new Error("IRONSIGHT down — fail-fast");
    if (!res.ok) throw new Error(`IRONSIGHT ships HTTP ${res.status}`);
    const json = (await res.json()) as {
      ships?: Array<Record<string, unknown>>;
    };
    const withCoords = (json.ships ?? [])
      .map(mapIronsightShipRecord)
      .filter((s) => stampHasCoords(s));

    // Empty 200 / no coords — do not wipe sticky; serve last-known.
    if (withCoords.length === 0) {
      const merged = mergeIronsightSticky([], { feedFailed: true, nameRe });
      if (merged.length > 0) {
        return {
          ships: merged,
          error:
            "IRONSIGHT ships empty/no-coords · serving last-known stamps (DARK)",
          fromCache: true,
        };
      }
      return { ships: [] };
    }

    // Always refresh sticky from full coord set; filter applied in merge.
    const ships = mergeIronsightSticky(withCoords, {
      feedFailed: false,
      nameRe,
    });
    return { ships };
  } catch (err) {
    const merged = mergeIronsightSticky([], { feedFailed: true, nameRe });
    if (merged.length > 0) {
      return {
        ships: merged,
        error: `${String(err).slice(0, 80)} · serving last-known IRONSIGHT stamps (DARK)`,
        fromCache: true,
      };
    }
    return { ships: [], error: String(err) };
  }
}

function ghostScore(status: BataanGhostSignStatus): number {
  if (status === "hot") return 1;
  if (status === "warm") return 0.5;
  return 0;
}

function formationFromScore(
  score: number,
): BataanGhostCluster["formationRegime"] {
  if (score >= 4) return "tight";
  if (score >= 2.5) return "forming";
  if (score >= 1) return "loose";
  return "quiet";
}

async function buildBataanGhost(deps: {
  aerial: TheaterWatch["aerial"];
  khargPickaxe: KhargPickaxeCluster;
  warRiskInsurance: TheaterWatch["warRiskInsurance"];
  /** Prefetched IRONSIGHT ships — stamps must not wait on ADS-B. */
  navalPack?: { ships: IronsightShipStamp[]; error?: string; fromCache?: boolean };
}): Promise<{
  ghost: BataanGhostCluster;
  mapOverlays: TheaterMapOverlays;
}> {
  const { aerial, khargPickaxe, warRiskInsurance } = deps;

  const [navalPack, notamItemsRaw, unrepItems, navwarnItems] =
    await Promise.all([
      deps.navalPack
        ? Promise.resolve(deps.navalPack)
        : fetchIronsightShipStamps(),
      Promise.all([
        fetchGoogleNewsRss(
          'NOTAM OR "notice to airmen" OR "flight restriction" OR TFR ("Persian Gulf" OR Hormuz OR Bahrain OR "Northern Gulf" OR CENTCOM OR Iraq OR Baghdad OR ORBB OR Mesopotamia)',
          10,
        ).catch(() => [] as NewsItem[]),
        fetchGoogleNewsRss(
          '(NOTAM OR TFR) ("Fifth Fleet" OR OBBI OR "Arabian Gulf" OR Qatar OR "US Navy") (restriction OR closed OR prohibited)',
          6,
        ).catch(() => [] as NewsItem[]),
        ...EXTRA_NOTAM_RSS_QUERIES_GULF.map((q) =>
          fetchGoogleNewsRss(q, 5).catch(() => [] as NewsItem[]),
        ),
        fetchEurocontrolAviationRss(6).catch(() => [] as NewsItem[]),
        fetchAwcMeSigmetItems(8).catch(() => [] as NewsItem[]),
      ]).then((batches) => mergeAviationNews(batches, 20)),
      fetchGoogleNewsRss(
        'USNS OR UNREP OR "underway replenishment" OR "Military Sealift" OR "Lewis and Clark" OR "dry cargo" (Gulf OR Hormuz OR Bahrain OR Fifth Fleet)',
        8,
      ).catch(() => [] as NewsItem[]),
      Promise.all([
        fetchGoogleNewsRss(
          'NAVWARN OR "navigation warning" OR "maritime security advisory" OR "exclusion zone" OR "dangerous operations" (Hormuz OR "Persian Gulf" OR Kharg OR Bahrain)',
          8,
        ).catch(() => [] as NewsItem[]),
        ...EXTRA_NAVWARN_RSS_QUERIES.map((q) =>
          fetchGoogleNewsRss(q, 6).catch(() => [] as NewsItem[]),
        ),
      ]).then((batches) => mergeAviationNews(batches, 18)),
    ]);
  const notamItems = notamItemsRaw;
  const floridaRe =
    /Florida|SSGN|Ohio.?class|Tomahawk|Georgia|Ohio\b|Michigan/i;
  // Doctrine uses LIVE stamps only — sticky last-known is map awareness, not High-go/5-Lock.
  const liveNavalShips = navalPack.ships.filter((s) => !s.stale);
  const floridaPack = {
    ships: liveNavalShips.filter((s) =>
      floridaRe.test(`${s.name} ${s.hull}`),
    ),
    error: navalPack.error,
  };
  const csgRe =
    /Philippine\s+Sea|George\s+Washington|Carl\s+Vinson|Theodore\s+Roosevelt|CVN-?\d|carrier\s+strike/i;
  const csgPack = {
    ships: liveNavalShips.filter((s) => csgRe.test(`${s.name} ${s.hull}`)),
    error: navalPack.error,
  };

  const notamRejectRe =
    /rocket\s+launch|missile\s+launch|February\s+19|Pakistan|completely available|space\s+launch|ballistic\s+missile\s+test|Iran\s+issues\s+Notam\s+over\s+planned/i;
  const notamTheaterRe =
    /Persian\s+Gulf|Arabian\s+Gulf|Northern\s+Gulf|Hormuz|Bahrain|Qatar|CENTCOM|Fifth\s+Fleet|US\s+Navy|U\.?S\.?\s+Navy|TFR|no-?fly|restricted\s+airspace|flight\s+restriction/i;
  const notamIraqRe =
    /Iraq|Baghdad|\bORBB\b|Mesopotamia|Basra|\bORMM\b|Erbil|\bORER\b|Mosul|Kirkuk|Iraqi\s+airspace/i;
  const notamKeywordRe =
    /NOTAM|notice to airmen|flight restriction|TFR|no-?fly|restricted airspace/i;
  const notamRejected = notamItems
    .filter((i) => notamKeywordRe.test(i.title) || notamTheaterRe.test(i.title))
    .filter((i) => notamRejectRe.test(i.title))
    .map((i) => i.title);
  const notamHits = notamItems.filter(
    (i) =>
      notamKeywordRe.test(i.title) &&
      notamTheaterRe.test(i.title) &&
      !notamRejectRe.test(i.title),
  );
  // Soft Iraq / Baghdad FIR sky-seal titles — map overlay only (not AER-02, not Gulf radio_hole score).
  const iraqNotamHits = notamItems.filter(
    (i) =>
      notamKeywordRe.test(i.title) &&
      notamIraqRe.test(i.title) &&
      !notamRejectRe.test(i.title) &&
      !notamHits.some((g) => g.title === i.title),
  );
  const iraqNotamStatus: BataanGhostSignStatus =
    iraqNotamHits.length >= 2
      ? "hot"
      : iraqNotamHits.length === 1
        ? "warm"
        : "quiet";
  const radioStatus: BataanGhostSignStatus =
    notamHits.length >= 2 ? "hot" : notamHits.length === 1 ? "warm" : "quiet";
  const radioHole: BataanGhostSign = {
    id: "radio_hole",
    label: "Communication blackout (radio hole / EMCON proxy)",
    lookFor:
      "US Navy NOTAMs / TFRs restricting flight zones over the Northern Persian Gulf — sky closed → boat about to move underneath.",
    sourceHint: "Google News RSS + EUROCONTROL + AWC SIGMET · map auto-plots approx FIR — not official FAA/NOTAM geometry",
    status: radioStatus,
    read:
      radioStatus === "hot"
        ? `${notamHits.length} Gulf/Bahrain FIR NOTAM/TFR hits (Iran rocket-launch / Pakistan / stale reprints filtered) — treat as EMCON / operating-box sky seal. Map zones auto-lit.`
        : radioStatus === "warm"
          ? "One Gulf/Bahrain FIR NOTAM/TFR hit — map zone auto-lit; watch for a second corroborating US/CENTCOM restriction."
          : `No clear US/CENTCOM Gulf NOTAM/TFR chatter${notamRejected.length ? ` (${notamRejected.length} Iran-rocket/Pakistan/stale filtered)` : ""} — EMCON itself is invisible; sky restrictions are the proxy.`,
    evidence: [
      ...notamHits.slice(0, 5).map((i) => i.title),
      ...notamRejected.slice(0, 4).map((t) => `filtered: ${t}`),
    ],
    links: [
      {
        label: "Google · Gulf NOTAM / TFR",
        href: `https://news.google.com/search?q=${encodeURIComponent('NOTAM OR TFR "Persian Gulf" OR Bahrain OR Hormuz CENTCOM OR "Fifth Fleet"')}&hl=en-US&gl=US&ceid=US:en`,
      },
      {
        label: "FAA NOTAM Search (backup)",
        href: "https://notams.aim.faa.gov/notamSearch/nsapp.html",
      },
    ],
  };

  const aerialStatus: BataanGhostSignStatus =
    aerial.regime === "mass_stack"
      ? "hot"
      : aerial.regime === "elevated"
        ? "warm"
        : aerial.regime === "unknown"
          ? "unknown"
          : "quiet";
  const rchSamples = aerial.samples.filter(
    (s) => !s.stale && /^RCH|^REACH/i.test(s.callsign),
  );
  const aerialTaxis: BataanGhostSign = {
    id: "aerial_taxis",
    label: "Aerial taxi fleet (KC-135 / KC-46 · AWACS)",
    lookFor:
      "Surge of aerial tankers / E-3 AWACS over Gulf or N. Saudi — RCH/Reach orbits gassing escorts before ARG sprint. Wider Iraq/Syria/Saudi/Iran/Red Sea/Horn/Arabian samples are plot-only.",
    sourceHint:
      "adsb.lol sequential multi-box — Gulf regime counts only (free ADS-B; mil often dark)",
    status: aerialStatus,
    read:
      aerial.error != null
        ? `ADS-B fetch degraded: ${aerial.error}`
        : `${aerial.tankerCount} tanker(s) · ${aerial.awacsCount} AWACS · regime=${aerial.regime}${rchSamples.length ? ` · ${rchSamples.length} RCH/Reach callsign(s)` : ""}${aerial.widerTheater ? ` · wider ${aerial.widerTheater.tankerCount}t/${aerial.widerTheater.awacsCount}a plot-only` : ""}. ${aerial.read}`,
    evidence: [
      ...aerial.samples.slice(0, 8).map(
        (s) =>
          `${s.callsign} ${s.type || s.aircraftType} @ ${s.lat.toFixed(2)},${s.lon.toFixed(2)}${s.boxId ? ` · ${s.boxId}` : ""}`,
      ),
      ...(aerial.widerTheater
        ? [`widerTheater: ${aerial.widerTheater.read}`]
        : []),
      ...(aerial.error ? [`error: ${aerial.error}`] : []),
    ],
    links: [
      {
        label: "ADS-B Exchange · Hormuz",
        href: "https://globe.adsbexchange.com/?lat=26.5&lon=54.0&zoom=6",
      },
      {
        label: "ADS-B Exchange · Bab",
        href: "https://globe.adsbexchange.com/?lat=12.5&lon=46.0&zoom=6",
      },
      {
        label: "adsb.lol mil",
        href: "https://api.adsb.lol/v2/mil",
      },
    ],
  };

  const florida = floridaPack.ships[0] ?? null;
  const floridaText = florida
    ? `${florida.name} ${florida.hull} ${florida.status} ${florida.region}`
    : "";
  const floridaDark =
    florida != null &&
    /unknown|missing|off.?station|deep.?water|dark|silent|lost|unlocated/i.test(
      floridaText,
    );
  const floridaOnStation =
    florida != null &&
    /Hormuz|Persian Gulf|Arabian Gulf|Gulf of Oman|Bahrain|CENTCOM/i.test(
      floridaText,
    ) &&
    !floridaDark;
  const subStatus: BataanGhostSignStatus = floridaPack.error
    ? "unknown"
    : florida == null
      ? "warm"
      : floridaDark
        ? "hot"
        : floridaOnStation
          ? "quiet"
          : "warm";
  const subShuffle: BataanGhostSign = {
    id: "sub_shuffle",
    label: "Submarine shuffle (Florida / SSGN dark)",
    lookFor:
      "USS Florida (or sister SSGN) IRONSIGHT stamp flips Hormuz → Unknown/Deep Water/Missing — Tomahawk shooter clearing path for Bataan.",
    sourceHint: "IRONSIGHT naval stamps",
    status: subStatus,
    read:
      floridaPack.error != null
        ? `IRONSIGHT ships unavailable: ${floridaPack.error}`
        : florida == null
          ? "No Florida/SSGN stamp in IRONSIGHT layer — treat absence as possible dark posture (not proof of quiet)."
          : floridaDark
            ? `SSGN stamp looks dark/off-station: ${florida.name} (${florida.hull}) · ${florida.status} · ${florida.region}. Attack-posture candidate.`
            : `SSGN stamp present: ${florida.name} (${florida.hull}) · ${florida.status} @ ${florida.lat.toFixed(2)},${florida.lon.toFixed(2)} (${florida.region}).`,
    evidence: floridaPack.ships.slice(0, 4).map(
      (s) =>
        `${s.name}${s.hull ? ` (${s.hull})` : ""} · ${s.status} · ${s.region}${s.lastReported ? ` · last=${s.lastReported}` : ""}`,
    ),
    links: [
      {
        label: "IRONSIGHT (local)",
        href: IRONSIGHT_URL,
      },
      {
        label: "Google · USS Florida SSGN",
        href: `https://news.google.com/search?q=${encodeURIComponent("USS Florida SSGN OR Tomahawk")}&hl=en-US&gl=US&ceid=US:en`,
      },
    ],
  };

  const unrepNoiseRe =
    /deliver(s|ed|y)|christen|keel|shipyard|NASSCO|commission|welcomes|joins the fleet|launch(ed|ing)\s+(of\s+)?(the\s+)?USNS|new\s+fleet\s+oiler|construction|Bath Iron|Huntington Ingalls/i;
  const unrepOpsRe =
    /UNREP|underway replenishment|replenishment at sea|Military Sealift|MSC\b|alongside|Fifth Fleet|Bahrain|Hormuz|Persian Gulf|Arabian Gulf|sprint|intercept|resupply|oiler.*Gulf|Gulf.*oiler/i;
  const unrepKeywordRe =
    /USNS|UNREP|underway replenishment|Military Sealift|Lewis and Clark|dry cargo|oiler|replenishment/i;
  const unrepRejected = unrepItems
    .filter((i) => unrepKeywordRe.test(i.title))
    .filter((i) => unrepNoiseRe.test(i.title) || !unrepOpsRe.test(i.title))
    .map((i) => i.title);
  const unrepHits = unrepItems.filter(
    (i) =>
      unrepKeywordRe.test(i.title) &&
      unrepOpsRe.test(i.title) &&
      !unrepNoiseRe.test(i.title),
  );
  const unrepStatus: BataanGhostSignStatus =
    unrepHits.length >= 2 ? "hot" : unrepHits.length === 1 ? "warm" : "quiet";
  const unrep: BataanGhostSign = {
    id: "unrep",
    label: "Logistics tail (UNREP / USNS sprint)",
    lookFor:
      "MSC dry-cargo / oiler (Lewis and Clark-class etc.) AIS sprint toward Bataan last known — ARG stages fuel/ammo before the gas.",
    sourceHint: "MarineTraffic USNS + Google News",
    status: unrepStatus,
    read:
      unrepStatus === "hot"
        ? `${unrepHits.length} Gulf/UNREP ops headlines (shipyard deliveries filtered) — logistics tail may be assembling.`
        : unrepStatus === "warm"
          ? "One Gulf/UNREP ops headline — open USNS AIS deep-links and compare to Bataan last fix."
          : `No clear Gulf UNREP/MSC sprint chatter${unrepRejected.length ? ` (${unrepRejected.length} shipyard/delivery filtered)` : ""} — still eyeball USNS AIS manually.`,
    evidence: [
      ...unrepHits.slice(0, 5).map((i) => i.title),
      ...unrepRejected.slice(0, 4).map((t) => `filtered: ${t}`),
    ],
    links: [
      {
        label: "MarineTraffic · USNS",
        href: "https://www.marinetraffic.com/en/ais/index/search/all?keyword=USNS",
      },
      {
        label: "MarineTraffic · Lewis and Clark",
        href: "https://www.marinetraffic.com/en/ais/index/search/all?keyword=LEWIS+AND+CLARK",
      },
      {
        label: "VesselFinder · USNS",
        href: "https://www.vesselfinder.com/vessels?name=USNS",
      },
    ],
  };

  const capeHot = khargPickaxe.vlccCape.regime === "cape_diversion";
  const capeWarm = khargPickaxe.vlccCape.regime === "mixed";
  const warHot = warRiskInsurance.regime === "spike_chatter";
  const warWarm = warRiskInsurance.regime === "mixed";
  const commercialStatus: BataanGhostSignStatus =
    capeHot || warHot
      ? "hot"
      : capeWarm || warWarm
        ? "warm"
        : khargPickaxe.vlccCape.regime === "unknown" &&
            warRiskInsurance.regime === "unknown"
          ? "unknown"
          : "quiet";
  const commercialCanary: BataanGhostSign = {
    id: "commercial_canary",
    label: "Commercial shipping panic (canary)",
    lookFor:
      "VLCC Cape diversions south of Yemen + war-risk premium spike — underwriters pricing assault while Bataan is AIS-dark.",
    sourceHint: "Theater VLCC Cape + war-risk news",
    status: commercialStatus,
    read: `Cape=${khargPickaxe.vlccCape.regime} · war-risk=${warRiskInsurance.regime}. ${khargPickaxe.vlccCape.read} ${warRiskInsurance.read}`,
    evidence: [
      ...khargPickaxe.vlccCape.diversionHints.slice(0, 4),
      ...warRiskInsurance.spikeHints.slice(0, 4),
    ],
    links: [
      ...khargPickaxe.vlccCape.links.slice(0, 2),
      {
        label: "War-risk search",
        href: warRiskInsurance.searchUrl,
      },
    ],
  };

  const irgc = khargPickaxe.irgcBoats;
  const irgcStatus: BataanGhostSignStatus =
    irgc.regime === "dispersing_from_kharg" ||
    irgc.regime === "massing_gulf_of_oman"
      ? "hot"
      : irgc.regime === "reinforcing_kharg" || irgc.regime === "mixed"
        ? "warm"
        : irgc.regime === "unknown"
          ? "unknown"
          : "quiet";
  const irgcSquirrel: BataanGhostSign = {
    id: "irgc_squirrel",
    label: "IRGC squirrel dispersal (L3)",
    lookFor:
      "IRGC fast boats leaving Bandar Abbas / coastal hideouts; Saberin stops boasting and warns 'stay alert' — adversary radar already sees the ghost.",
    sourceHint: "IRGC boat cluster + Saberin Telegram",
    status: irgcStatus,
    read: irgc.read,
    evidence: [
      ...irgc.keywordHits.dispersing.slice(0, 3),
      ...irgc.keywordHits.massingOman.slice(0, 2),
      ...irgc.items.slice(0, 3).map((i) => i.title),
    ],
    links: irgc.telegramLinks.slice(0, 4),
  };

  const navClassified = classifyNavwarnItems(navwarnItems);
  const navStatus: BataanGhostSignStatus = navClassified.ghostStatus;
  const navwarnBox: BataanGhostSign = {
    id: "navwarn_box",
    label: "NAVWARN administrative trace (L4)",
    lookFor:
      "NAVWARN for Northern Persian Gulf 'dangerous operations' with vague timeline — operating box for Bataan being drawn. Expansion west toward Kharg = escalate.",
    sourceHint: "Shared NAVWARN classifier · Google News · NAVCEN · 5-Lock L4",
    status: navStatus,
    read:
      navStatus === "hot"
        ? `${navClassified.hardHits.length} hard / ${navClassified.softHits.length} soft NAVWARN hit(s) ≤${navClassified.windowHours}h${navClassified.lock4Triggered ? " · Lock 4 would FIRE" : ""} — treat L4 operating-box as live.`
        : navStatus === "warm"
          ? `Warm NAVWARN sample (${navClassified.hardHits.length} hard / ${navClassified.softHits.length} soft) — confirm on NAVCEN; Lock 4 ${navClassified.lock4Triggered ? "FIRE" : "quiet"}.`
          : `No fresh ≤${navClassified.windowHours}h NAVWARN/exclusion in shared classifier — L4 may still be forced manually from NAVCEN.`,
    evidence: navClassified.softHits.slice(0, 5).map((i) => i.title),
    links: [
      {
        label: "Google · NAVWARN Persian Gulf",
        href: `https://news.google.com/search?q=${encodeURIComponent('NAVWARN OR "maritime security advisory" ("Persian Gulf" OR Hormuz OR Kharg)')}&hl=en-US&gl=US&ceid=US:en`,
      },
      {
        label: "NAVCEN MSI",
        href: "https://msi.nga.mil/NavWarnings",
      },
    ],
  };

  const signs: BataanGhostSign[] = [
    radioHole,
    aerialTaxis,
    subShuffle,
    unrep,
    commercialCanary,
    irgcSquirrel,
    navwarnBox,
  ];
  const formationScore = signs.reduce((n, s) => n + ghostScore(s.status), 0);
  const formationRegime = formationFromScore(formationScore);
  const hotLabels = signs
    .filter((s) => s.status === "hot" || s.status === "warm")
    .map((s) => s.label.split("(")[0].trim());

  const read =
    formationRegime === "tight"
      ? `Ghost formation TIGHT (${formationScore}/${signs.length}): ${hotLabels.join(" · ")}. Treat Bataan as sprinting even with zero AIS — air + logistics + sub + enemy snapping together.`
      : formationRegime === "forming"
        ? `Ghost formation FORMING (${formationScore}/${signs.length}): ${hotLabels.join(" · ") || "partial"}. Do not wait for L1 AIS; escalate watch next 12h.`
        : formationRegime === "loose"
          ? `Ghost formation LOOSE (${formationScore}/${signs.length}). Isolated footprints only — not yet a sprint signature.`
          : `Ghost formation QUIET (${formationScore}/${signs.length}). No multi-domain footprint cluster — Bataan AIS-dark alone is not a go-signal.`;

  const mapOverlays = buildTheaterMapOverlays({
    radioStatus,
    notamTitles: notamHits.map((i) => i.title),
    iraqNotamTitles: iraqNotamHits.map((i) => i.title),
    iraqNotamStatus,
    navStatus,
    navTitles: navClassified.softHits.map((i) => i.title),
    navalShips: navalPack.ships,
    adsbBoxesOk: aerial.boxesOk,
    adsbBoxesFailed: aerial.boxesFailed,
    adsbBoxTrackCounts: aerial.boxTrackCounts,
  });

  return {
    ghost: {
      thesis:
        "Stop looking for Bataan on a map. Watch the wake: EMCON/NOTAM sky seals, aerial tankers/AWACS, Florida/SSGN going dark, USNS UNREP sprint, commercial Cape + war-risk canary, IRGC dispersal, NAVWARN operating box. If those snap into a tight formation, the ARG is sprinting even with zero AIS pings.",
      oneLiner:
        "If air + Florida + IRGC + NAVWARN tighten while Bataan is dark → sprint posture; L1 AIS is last, not first.",
      fetchedAt: new Date().toISOString(),
      formationScore,
      formationMax: signs.length,
      formationRegime,
      read,
      signs,
    },
    mapOverlays,
  };
}

/** Soft TTL so Map polls (~60s) reuse a warm pack instead of re-queueing ADS-B. */
let theaterWatchLastGood: { watch: TheaterWatch; at: number } | null = null;
const THEATER_WATCH_CACHE_TTL_MS = 45_000;
/** Cap ADS-B wait so IRONSIGHT stamps / adsb_box overlays return under Map timeout. */
/** mil + pinned geos + fringe can exceed ~25s behind Levant AER on the shared queue. */
const THEATER_AERIAL_BUDGET_MS = 42_000;

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function hydrateTheaterLastGood(): void {
  if (theaterWatchLastGood) return;
  const disk = readLastGood<TheaterWatch>("theater-watch");
  if (disk) theaterWatchLastGood = { watch: disk.value, at: disk.at };
}

export function getLastGoodTheaterWatch(): TheaterWatch | null {
  hydrateTheaterLastGood();
  return theaterWatchLastGood?.watch ?? null;
}

/** Live rebuild (single-flight) — internals that must wait, not HTTP first paint. */
export function warmTheaterWatch(): Promise<TheaterWatch> {
  return singleFlight("buildTheaterWatch", rebuildTheaterWatch);
}

const REBUILDING_READ = "Rebuilding after launch — last-good missing. Stamps/overlays fill in shortly.";

function emptyProductLeg(
  root: "HO" | "RB",
  label: string,
  near: string,
  far: string,
): ProductCurveLeg {
  return {
    root,
    label,
    near: { symbol: near, label: "front", price: null, changePct: null },
    far: { symbol: far, label: "back", price: null, changePct: null },
    spread: null,
    spreadChangePctApprox: null,
    regime: "unknown",
    read: REBUILDING_READ,
  };
}

/** Quiet shell so /api/theater-watch never hangs first paint past the client abort. */
export function emptyTheaterWatch(): TheaterWatch {
  const now = new Date().toISOString();
  return {
    fetchedAt: now,
    ais: {
      note: "Theater rebuilding after launch — AIS / stamps fill in shortly.",
      links: [],
      readAnchored: REBUILDING_READ,
      readCapeDiversion: REBUILDING_READ,
    },
    brentCurve: {
      near: { symbol: "BZ=F", label: "front", price: null },
      far: { symbol: "BZ=F", label: "back", price: null },
      spread: null,
      regime: "unknown",
      read: REBUILDING_READ,
      source: "rebuilding",
    },
    wtiCurve: {
      near: { symbol: "CL=F", label: "front", price: null, changePct: null },
      far: { symbol: "CLZ26.NYM", label: "back", price: null, changePct: null },
      spread: null,
      regime: "unknown",
      read: REBUILDING_READ,
      source: "rebuilding",
    },
    bdti: {
      latest: null,
      prev: null,
      changePct1d: null,
      changePct5d: null,
      risingVsOil: null,
      read: REBUILDING_READ,
      sourceUrl: "",
    },
    peers: { fro: null, rows: [], regime: "unknown", read: REBUILDING_READ },
    polymarket: {
      ceasefire: null,
      hormuz: null,
      top: [],
      read: REBUILDING_READ,
      source: "rebuilding",
    },
    insiders: { rows: [], read: REBUILDING_READ, sourceUrl: "" },
    aerial: {
      tankerCount: 0,
      awacsCount: 0,
      otherMilCount: 0,
      regime: "unknown",
      read: REBUILDING_READ,
      samples: [],
      source: "rebuilding",
      boxesOk: [],
      boxesFailed: [],
    },
    focus46c: {
      expiry: "2026-09-18",
      strike: 46,
      bid: null,
      ask: null,
      last: null,
      volume: null,
      openInterest: null,
      iv: null,
      width: null,
      froPrice: null,
      oilProxy: null,
      regime: "unknown",
      read: REBUILDING_READ,
      source: null,
    },
    warRiskInsurance: {
      query: "",
      items: [],
      spikeHints: [],
      regime: "unknown",
      read: REBUILDING_READ,
      searchUrl: "",
      source: "rebuilding",
    },
    stateMedia: {
      queries: [],
      items: [],
      feeDisputeHits: [],
      dealHits: [],
      kineticHits: [],
      regime: "unknown",
      read: REBUILDING_READ,
      links: [],
      source: "rebuilding",
    },
    productCurves: {
      heatingOil: emptyProductLeg("HO", "Heating oil", "HO=F", "HO=F"),
      gasoline: emptyProductLeg("RB", "RBOB", "RB=F", "RB=F"),
      regime: "unknown",
      read: REBUILDING_READ,
      source: "rebuilding",
    },
    khargPickaxe: {
      thesis: "Kharg / amphibious pickaxe — rebuilding.",
      fetchedAt: now,
      amphibious: {
        context: REBUILDING_READ,
        decisionTable: [],
        vessels: [],
        readOptionA: REBUILDING_READ,
        readOptionB: REBUILDING_READ,
        note: REBUILDING_READ,
        source: "rebuilding",
      },
      e6b: {
        airborneCount: 0,
        samples: [],
        regime: "unknown",
        read: REBUILDING_READ,
        source: "rebuilding",
      },
      irgcBoats: {
        items: [],
        telegramLinks: [],
        keywordHits: { dispersing: [], massingOman: [], reinforcingKharg: [] },
        regime: "unknown",
        read: REBUILDING_READ,
        source: "rebuilding",
      },
      vlccCape: {
        links: [],
        items: [],
        diversionHints: [],
        regime: "unknown",
        read: REBUILDING_READ,
        readOptionA: REBUILDING_READ,
        readOptionB: REBUILDING_READ,
        source: "rebuilding",
      },
    },
    eastAfricaCape: emptyEastAfricaCape("rebuilding after launch"),
    bataanGhost: {
      thesis: "Ghost formation — rebuilding.",
      oneLiner: REBUILDING_READ,
      fetchedAt: now,
      formationScore: 0,
      formationMax: 7,
      formationRegime: "unknown",
      read: REBUILDING_READ,
      signs: [],
    },
    mapOverlays: {
      zones: [],
      stamps: [],
      aisPoints: [],
      radioHoleStatus: "unknown",
      navwarnStatus: "unknown",
    },
    bibiSpoiler: {
      thesis: "Bibi spoiler — rebuilding.",
      scenarios: { romeTrap: REBUILDING_READ, nuclearBreakout: REBUILDING_READ },
      tradeImplication: REBUILDING_READ,
      fetchedAt: now,
      romeTalks: {
        queries: [],
        items: [],
        keywordHits: {
          walkout: [],
          disarmamentPrecondition: [],
          talksOngoing: [],
          concluded: [],
          calendarGap: [],
        },
        regime: "unknown",
        read: REBUILDING_READ,
        links: [],
        source: "rebuilding",
      },
      shekel: {
        symbol: "USDILS=X",
        price: null,
        changePct: null,
        threshold: 3.7,
        regime: "unknown",
        read: REBUILDING_READ,
        source: "rebuilding",
      },
      idfGround: {
        items: [],
        keywordHits: { lebaneseBorder: [], gazaFocus: [] },
        regime: "unknown",
        read: REBUILDING_READ,
        links: [],
        ironsightOnline: false,
        source: "rebuilding",
      },
    },
    politicsCalendar: buildPoliticsCalendarChip(),
  };
}

async function rebuildTheaterWatch(): Promise<TheaterWatch> {
  // IRONSIGHT stamps start immediately — never blocked behind ADS-B queue.
  const navalPackPromise = fetchIronsightShipStamps();
  // Live aerial continues in background even if we hit the budget (updates last-good).
  const aerialPromise = fetchGulfAerial();
  const [
    brentCurve,
    wtiCurve,
    fro,
    oil,
    bdtiRaw,
    peers,
    polymarket,
    insiders,
    warRiskInsurance,
    stateMedia,
    productCurves,
    khargPickaxe,
    eastAfricaCape,
    bibiSpoiler,
    navalPack,
    aerialRace,
  ] = await Promise.all([
    fetchBrentCurve(),
    fetchWtiCurve(),
    getStockQuote("FRO").catch(() => null),
    getStockQuote("BZ=F").catch(() => null),
    fetchBdtiSeries().catch(() => null),
    fetchPeers(),
    fetchPolymarketSignals(),
    fetchOpenInsiderFro(),
    fetchWarRiskInsurance(),
    fetchStateMedia(),
    fetchProductCurves(),
    buildKhargPickaxe(),
    fetchEastAfricaCape(),
    buildBibiSpoiler(),
    navalPackPromise,
    Promise.race([
      aerialPromise.then((a) => ({ timedOut: false as const, aerial: a })),
      sleepMs(THEATER_AERIAL_BUDGET_MS).then(() => ({
        timedOut: true as const,
        aerial: null as TheaterWatch["aerial"] | null,
      })),
    ]),
  ]);

  const aerial: TheaterWatch["aerial"] = aerialRace.timedOut
    ? staleGulfAerial(
        "ADS-B queue budget — stamps/overlays not blocked; serving last-good / degraded aerial",
      )
    : aerialRace.aerial;

  // Keep warming last-good when live aerial finishes after the budget.
  if (aerialRace.timedOut) {
    void aerialPromise.catch(() => undefined);
  }

  const focus46c = await fetchFocus46c(fro, oil);
  const bdti = shapeBdti(bdtiRaw, oil?.changePercent ?? null);
  const { ghost: bataanGhost, mapOverlays: overlaysRaw } = await buildBataanGhost({
    aerial,
    khargPickaxe,
    warRiskInsurance,
    navalPack,
  });
  const mapOverlays = {
    ...overlaysRaw,
    stamps: carryForwardTheaterStamps(
      overlaysRaw.stamps,
      theaterWatchLastGood?.watch.mapOverlays?.stamps,
      theaterWatchLastGood?.at,
    ),
  };
  const theaterAis = getTheaterAisSnapshot();

  const watch: TheaterWatch = {
    fetchedAt: new Date().toISOString(),
    ais: {
      note: theaterAis.enabled
        ? `AISStream ${theaterAis.status} — Cyprus (NAV-01) + Hormuz/Bab plot. ${theaterAis.note} Warships often AIS-dark.`
        : "AISSTREAM_API_KEY unset — Cyprus/Hormuz/Bab AISStream off. Decision Footprint stays primary. TankerMap / MT / VF deep links backup.",
      links: [
        {
          label: "TankerMap · oil / VLCC (no signup)",
          href: "https://tankermap.com/oil-tanker-tracker",
        },
        {
          label: "TankerMap · Hormuz watch",
          href: "https://tankermap.com/",
        },
        {
          label: "MarineTraffic · Hormuz",
          href: "https://www.marinetraffic.com/en/ais/home/centerx:56.25/centery:26.56/zoom:8",
        },
        {
          label: "VesselFinder · Hormuz",
          href: "https://www.vesselfinder.com/?latitude=26.56&longitude=56.25&zoom=8",
        },
        {
          label: "Fujairah anchorage",
          href: "https://www.marinetraffic.com/en/ais/home/centerx:56.35/centery:25.15/zoom:10",
        },
      ],
      readAnchored:
        "Anchored / loitering VLCCs → market expects a deal / all-clear soon (bearish for $46c gamma, equity less panicked).",
      readCapeDiversion:
        "Turning back toward Arabian Sea / Cape route → long-war priced; massively bullish for FRO rates / $46c.",
    },
    brentCurve,
    wtiCurve,
    bdti,
    peers,
    polymarket,
    insiders,
    aerial,
    focus46c,
    warRiskInsurance,
    stateMedia,
    productCurves,
    khargPickaxe,
    eastAfricaCape,
    bataanGhost,
    mapOverlays,
    bibiSpoiler,
    politicsCalendar: buildPoliticsCalendarChip(),
  };

  try {
    const ts = watch.fetchedAt;
    if (aerial.samples?.length) {
      archiveTheaterAerial({ ts, samples: aerial.samples });
    }
    const e6bSamples = khargPickaxe?.e6b?.samples ?? [];
    if (e6bSamples.length > 0) {
      archiveE6bSamples({
        ts,
        samples: e6bSamples.map((s) => ({
          callsign: s.callsign,
          lat: s.lat,
          lon: s.lon,
          altitude: s.altitude,
          hex: s.hex,
          stale: s.stale,
        })),
      });
    }
    if (mapOverlays.stamps?.length) {
      archiveNavalStamps({
        ts,
        stamps: mapOverlays.stamps.map((s) => ({
          id: s.id,
          kind: s.kind,
          label: s.label,
          lat: s.lat,
          lon: s.lon,
          status: s.status,
          region: s.region,
          sogKt: s.sogKt,
          courseDeg: s.courseDeg,
          stale: s.stale,
          meta: s.meta,
        })),
      });
    }
    if (mapOverlays.zones?.length) {
      archiveMapZones({
        ts,
        zones: mapOverlays.zones.map((z) => ({
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
    }
  } catch (err) {
    console.warn("[tradehole] theater osint archive failed:", err);
  }

  theaterWatchLastGood = { watch, at: Date.now() };
  writeLastGood("theater-watch", watch, theaterWatchLastGood.at);
  return watch;
}

export async function buildTheaterWatch(opts?: {
  force?: boolean;
}): Promise<TheaterWatch> {
  hydrateTheaterLastGood();
  return serveLastGood({
    flightKey: opts?.force === true ? "buildTheaterWatch:force" : "buildTheaterWatch",
    force: opts?.force === true,
    freshTtlMs: THEATER_WATCH_CACHE_TTL_MS,
    label: "theater-watch",
    persistKey: "theater-watch",
    get: () =>
      theaterWatchLastGood
        ? { value: theaterWatchLastGood.watch, at: theaterWatchLastGood.at }
        : null,
    set: (snap) => {
      theaterWatchLastGood = { watch: snap.value, at: snap.at };
    },
    build: rebuildTheaterWatch,
    empty: emptyTheaterWatch,
  });
}

async function fetchWtiCurve(): Promise<TheaterWatch["wtiCurve"]> {
  const [near, far] = await Promise.all([
    getStockQuote("CL=F").catch(() => null),
    getStockQuote("CLZ26.NYM").catch(() => null),
  ]);
  const nearPx = near?.price ?? null;
  const farPx = far?.price ?? null;
  const spread = nearPx != null && farPx != null ? nearPx - farPx : null;
  const nearChg = near?.changePercent ?? null;
  const farChg = far?.changePercent ?? null;
  let regime: TheaterWatch["wtiCurve"]["regime"] = "unknown";
  if (nearChg != null && farChg != null) {
    if (nearChg <= -3 && farChg > -1.5) regime = "front_crash_back_hold";
    else if (nearChg <= -3 && farChg <= -3) regime = "both_crash";
    else if (nearChg >= -1 && farChg >= -1) regime = "both_firm";
    else regime = "mixed";
  }
  const read = (() => {
    switch (regime) {
      case "front_crash_back_hold":
        return `Front WTI dumping (${nearChg?.toFixed(1)}%) while Dec '26 holds (${farChg?.toFixed(1)}%) — market treating this as a short-term diplomatic blip, not permanent Iran risk removal.`;
      case "both_crash":
        return `Front and Dec '26 both crashing — Iran risk premium being priced out of the curve (bad for tanker call convexity if sustained).`;
      case "both_firm":
        return `Curve holding — risk premium still in the tape.`;
      case "mixed":
        return `WTI Sep−Dec spread $${spread?.toFixed(2) ?? "—"} · front ${nearChg?.toFixed(1) ?? "—"}% / back ${farChg?.toFixed(1) ?? "—"}%.`;
      default:
        return "WTI calendar quotes unavailable.";
    }
  })();
  return {
    near: {
      symbol: "CL=F",
      label: "WTI front",
      price: nearPx,
      changePct: nearChg,
    },
    far: {
      symbol: "CLZ26.NYM",
      label: "WTI Dec '26",
      price: farPx,
      changePct: farChg,
    },
    spread,
    regime,
    read,
    source: "yahoo-finance2",
  };
}

async function fetchPeers(): Promise<TheaterWatch["peers"]> {
  // EURN NYSE ticker retired into CMB.TECH (CMBT); keep both labels clear.
  const specs = [
    { symbol: "FRO", label: "Frontline" },
    { symbol: "DHT", label: "DHT" },
    { symbol: "NAT", label: "Nordic American" },
    { symbol: "TNK", label: "Teekay Tankers" },
    { symbol: "CMBT", label: "CMB.TECH (ex-EURN)" },
    { symbol: "INSW", label: "Intl Seaways" },
  ];
  const quotes = await Promise.all(
    specs.map(async (s) => {
      const q = await getStockQuote(s.symbol).catch(() => null);
      return {
        symbol: s.symbol,
        label: s.label,
        price: q?.price ?? null,
        changePct: q?.changePercent ?? null,
      } satisfies PeerRow;
    }),
  );
  const fro = quotes.find((r) => r.symbol === "FRO") ?? null;
  const peersOnly = quotes.filter((r) => r.symbol !== "FRO");
  const froChg = fro?.changePct ?? null;
  const peerChgs = peersOnly
    .map((p) => p.changePct)
    .filter((v): v is number => v != null);
  const peerAvg =
    peerChgs.length > 0
      ? peerChgs.reduce((a, b) => a + b, 0) / peerChgs.length
      : null;
  let regime: TheaterWatch["peers"]["regime"] = "unknown";
  let read = "Peer tape unavailable.";
  if (froChg != null && peerAvg != null) {
    const gap = froChg - peerAvg;
    if (Math.abs(gap) >= 2.5 && Math.sign(froChg) !== Math.sign(peerAvg)) {
      regime = "fro_idiosyncratic";
      read = `FRO ${froChg.toFixed(1)}% vs peers avg ${peerAvg.toFixed(1)}% — FRO looking idiosyncratic (company/flow), not pure geo macro.`;
    } else if (Math.abs(gap) < 1.5) {
      regime = "macro_tape";
      read = `FRO ${froChg.toFixed(1)}% ≈ peers ${peerAvg.toFixed(1)}% — macro/geo tape is driving the group.`;
    } else {
      regime = "mixed";
      read = `FRO ${froChg.toFixed(1)}% vs peers ${peerAvg.toFixed(1)}% (gap ${gap.toFixed(1)} pts) — mixed idiosyncratic + macro.`;
    }
  }
  return { fro, rows: quotes, regime, read };
}

function shapeBdti(
  bdti: Awaited<ReturnType<typeof fetchBdtiSeries>> | null,
  oilChangePct: number | null,
): TheaterWatch["bdti"] {
  if (!bdti) {
    return {
      latest: null,
      prev: null,
      changePct1d: null,
      changePct5d: null,
      risingVsOil: null,
      read: "BDTI proxy unavailable.",
      sourceUrl: "https://en.stockq.org/index/BDTI.php",
    };
  }
  const risingVsOil =
    bdti.changePct1d != null && oilChangePct != null
      ? bdti.changePct1d >= 5 && oilChangePct < 0
      : null;
  const read =
    risingVsOil
      ? `BDTI ${bdti.latest?.value ?? "—"} (${bdti.changePct1d?.toFixed(1)}% d/d) rising while oil soft — physical tankers disconnected from paper (bullish freight).`
      : `BDTI ${bdti.latest?.value ?? "—"} @ ${bdti.latest?.date ?? "—"} · d/d ${bdti.changePct1d?.toFixed(1) ?? "—"}% · 5d ${bdti.changePct5d?.toFixed(1) ?? "—"}%. ${bdti.biasNote}`;
  return {
    latest: bdti.latest,
    prev: bdti.prev,
    changePct1d: bdti.changePct1d,
    changePct5d: bdti.changePct5d,
    risingVsOil,
    read,
    sourceUrl: bdti.sourceUrl,
  };
}

async function fetchPolymarketSignals(): Promise<TheaterWatch["polymarket"]> {
  try {
    const res = await fetch(
      "https://gamma-api.polymarket.com/markets?limit=200&closed=false&active=true&order=volume24hr&ascending=false",
      {
        headers: { "User-Agent": "Tradehole/0.1" },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as Array<{
      question?: string;
      slug?: string;
      outcomes?: string;
      outcomePrices?: string;
      volume24hr?: number;
      oneDayPriceChange?: number;
      endDate?: string;
      closed?: boolean;
    }>;
    const nowMs = Date.now();
    const mapped: PolyRow[] = [];
    for (const m of data) {
      const q = String(m.question ?? "");
      if (!/ceasefire|hormuz|iran|israel|blockade|strait/i.test(q)) continue;
      if (/ukraine|russia|trump|election|nba|nfl/i.test(q) && !/iran|hormuz|israel|ceasefire/i.test(q))
        continue;
      // Gamma sometimes leaves past-endDate markets active/closed=false (e.g. "by July 31").
      if (m.closed === true) continue;
      const endMs = m.endDate ? Date.parse(m.endDate) : NaN;
      if (Number.isFinite(endMs) && endMs < nowMs - 6 * 3600_000) continue;
      let yesPct: number | null = null;
      try {
        const outcomes = JSON.parse(String(m.outcomes ?? "[]")) as string[];
        const prices = JSON.parse(String(m.outcomePrices ?? "[]")) as string[];
        const yesIdx = outcomes.findIndex((o) => /^yes$/i.test(o));
        const idx = yesIdx >= 0 ? yesIdx : 0;
        const p = Number(prices[idx]);
        if (Number.isFinite(p)) yesPct = Math.round(p * 100);
      } catch {
        /* skip */
      }
      mapped.push({
        question: q,
        yesPct,
        oneDayChange:
          typeof m.oneDayPriceChange === "number" ? m.oneDayPriceChange : null,
        volume24hr: typeof m.volume24hr === "number" ? m.volume24hr : null,
        slug: m.slug ?? null,
      });
    }
    mapped.sort((a, b) => (b.volume24hr ?? 0) - (a.volume24hr ?? 0));
    const ceasefire =
      mapped.find((m) => /ceasefire/i.test(m.question) && /iran|us|israel/i.test(m.question)) ??
      mapped.find((m) => /ceasefire/i.test(m.question)) ??
      null;
    const hormuz =
      mapped.find((m) => /hormuz/i.test(m.question) && /august|aug\b|september|sep\b/i.test(m.question)) ??
      mapped.find((m) => /hormuz/i.test(m.question)) ??
      null;
    const cf = ceasefire?.yesPct;
    const read =
      cf != null
        ? `Ceasefire-ish market ~${cf}%${ceasefire?.oneDayChange != null ? ` (1d Δ ${ceasefire.oneDayChange >= 0 ? "+" : ""}${(ceasefire.oneDayChange * 100).toFixed(1)}¢)` : ""}. Hormuz normal ${hormuz?.yesPct ?? "—"}%.`
        : "No clear ceasefire market in top Polymarket volume set.";
    return {
      ceasefire,
      hormuz,
      top: mapped.slice(0, 6),
      read,
      source: "polymarket gamma-api",
    };
  } catch (err) {
    return {
      ceasefire: null,
      hormuz: null,
      top: [],
      read: "Polymarket fetch failed.",
      source: "polymarket gamma-api",
      error: String(err),
    };
  }
}

async function fetchOpenInsiderFro(): Promise<TheaterWatch["insiders"]> {
  const sourceUrl = "http://openinsider.com/screener?s=FRO&fd=90&td=0&xp=1&xs=1&cnt=15";
  try {
    const res = await fetch(sourceUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Tradehole/0.1; personal research)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const rows: InsiderRow[] = [];
    // OpenInsider tables: filing date, trade date, ticker, insider, title, trade type, price, qty, value
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let tr: RegExpExecArray | null;
    while ((tr = trRe.exec(html)) && rows.length < 8) {
      const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
        m[1]
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      );
      if (cells.length < 10) continue;
      if (!cells.some((c) => /\bFRO\b/i.test(c))) continue;
      // Typical columns vary; search for Buy/Sale tokens
      const tradeType =
        cells.find((c) => /^(P|S|A|D|M|P - Purchase|S - Sale)/i.test(c)) ??
        cells.find((c) => /purchase|sale|buy|sell/i.test(c)) ??
        null;
      rows.push({
        date: cells[1] || cells[0] || null,
        insider: cells[3] || cells[4] || null,
        title: cells[4] || cells[5] || null,
        tradeType,
        price: cells.find((c) => /^\$?\d+\.\d{2}$/.test(c)) ?? null,
        qty: cells.find((c) => /^[+-]?[\d,]+$/.test(c) && c.length >= 3) ?? null,
        value: cells.find((c) => /^\$[\d,]+/.test(c) && c.includes(",")) ?? null,
      });
    }
    const buys = rows.filter((r) => /P|purchase|buy/i.test(String(r.tradeType)));
    const sells = rows.filter((r) => /S|sale|sell/i.test(String(r.tradeType)));
    const read =
      rows.length === 0
        ? "No recent OpenInsider Form 4 rows parsed for FRO (check link)."
        : `${rows.length} recent Form 4 row(s): ${buys.length} buy-ish / ${sells.length} sell-ish. Insider buys into weakness change the calculus; heavy selling warns the rally may be done.`;
    return { rows, read, sourceUrl };
  } catch (err) {
    return {
      rows: [],
      read: "OpenInsider scrape failed — open the link manually.",
      sourceUrl,
      error: String(err),
    };
  }
}

type NewsItem = { title: string; link: string; pubDate: string };

async function fetchGoogleNewsRss(query: string, limit = 8): Promise<NewsItem[]> {
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
    const link = block.match(/<link>(.*?)<\/link>/)?.[1] ?? "";
    const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? "";
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

async function fetchWarRiskInsurance(): Promise<TheaterWatch["warRiskInsurance"]> {
  const query = 'war risk insurance Hormuz OR "Middle East shipping insurance" OR "war risk premium" tanker';
  const searchUrl = `https://news.google.com/search?q=${encodeURIComponent("war risk insurance Hormuz")}&hl=en-US&gl=US&ceid=US:en`;
  try {
    const items = await fetchGoogleNewsRss(query, 10);
    const spikeRe =
      /\b(spike|soar|surge|jump|rise|hike|climb|premiums?\s+(up|rise|jump)|rates?\s+(up|rise|jump)|underwriter|Lloyd'?s|war\s*risk)\b/i;
    const spikeHints = items
      .filter((i) => spikeRe.test(i.title))
      .map((i) => i.title);
    let regime: TheaterWatch["warRiskInsurance"]["regime"] = "unknown";
    if (items.length === 0) regime = "unknown";
    else if (spikeHints.length >= 2) regime = "spike_chatter";
    else if (spikeHints.length === 1) regime = "mixed";
    else regime = "quiet";

    const read =
      regime === "spike_chatter"
        ? "War-risk / shipping-insurance headlines look hot — underwriters pricing collapse of talks. Treat as Hold-all-3 vs Polymarket deal hope."
        : regime === "mixed"
          ? "Some war-risk insurance chatter — skim headlines; a sharp premium spike in next 12h overrides soft Polymarket."
          : regime === "quiet"
            ? "No clear war-risk premium spike in Google News right now. Keep watching next 12–24h."
            : "War-risk insurance news unavailable.";

    return {
      query,
      items,
      spikeHints,
      regime,
      read,
      searchUrl,
      source: "Google News RSS",
    };
  } catch (err) {
    return {
      query,
      items: [],
      spikeHints: [],
      regime: "unknown",
      read: "War-risk news RSS failed — open Google News search manually.",
      searchUrl,
      source: "Google News RSS",
      error: String(err),
    };
  }
}

async function fetchStateMedia(): Promise<TheaterWatch["stateMedia"]> {
  const queries = [
    'Tasnim (deal OR agreement OR ceasefire OR Hormuz OR "transit fee") Iran',
    '"Oman News Agency" OR ONA (Iran OR Hormuz OR ceasefire OR deal OR mediation)',
    'Iran "transit fee" OR "passage fee" OR toll Hormuz (US OR Oman OR deal)',
  ];
  const links = [
    { label: "Tasnim News", href: "https://www.tasnimnews.com/en" },
    { label: "Oman News Agency", href: "https://omannews.gov.om/eng" },
    {
      label: "Google · Tasnim Hormuz/deal",
      href: `https://news.google.com/search?q=${encodeURIComponent("site:tasnimnews.com Hormuz OR ceasefire OR deal")}&hl=en-US&gl=US&ceid=US:en`,
    },
    {
      label: "Google · Oman mediation",
      href: `https://news.google.com/search?q=${encodeURIComponent('"Oman News Agency" Iran deal OR Hormuz')}&hl=en-US&gl=US&ceid=US:en`,
    },
  ];
  try {
    const batches = await Promise.all(
      queries.map(async (q, idx) => {
        const items = await fetchGoogleNewsRss(q, 6).catch(() => [] as NewsItem[]);
        const source =
          idx === 0 ? "Tasnim-ish" : idx === 1 ? "Oman-ish" : "fee-dispute";
        return items.map((i) => ({ ...i, source }));
      }),
    );
    /** Oman News Agency (ONA) query also matches OpenAI/Arsenal "Ona" sports/tech deals. */
    const OMAN_DEAL_NOISE_RE =
      /Ona\s+Batlle|OpenAI|Anthropic|Arsenal|Codex|LIV\s+Golf|Barcelona|Gartner|Techzine|football|soccer|methamphetamine/i;

    const seen = new Set<string>();
    const items: TheaterWatch["stateMedia"]["items"] = [];
    for (const batch of batches) {
      for (const item of batch) {
        if (OMAN_DEAL_NOISE_RE.test(item.title)) continue;
        const key = item.title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
      }
    }

    const feeDisputeHits = items
      .filter((i) =>
        /transit\s*fee|passage\s*fee|toll|no\s+deal\s+without|reject(s|ed)?\s+(the\s+)?fee|fee\s+dispute/i.test(
          i.title,
        ),
      )
      .map((i) => i.title);
    const dealHits = items
      .filter((i) =>
        /\b(deal|agreement|ceasefire|truce|mediation|brokered|announces?\s+deal)\b/i.test(
          i.title,
        ),
      )
      .map((i) => i.title);
    // US/CENTCOM or reciprocal kinetic on Hormuz islands (Larak etc.) — not Israel AER.
    const KINETIC_HORMUZ_RE =
      /\b(US|U\.S\.|American|CENTCOM|Fifth\s+Fleet)\b.{0,60}\b(strike|struck|strikes|hit|bomb|missile)\b.{0,80}\b(Hormuz|Larak|Kharg|Iranian?\s+(launcher|rocket|missile|base|island))|\b(Larak|Kharg)\b.{0,40}\b(strike|struck|attack|hit)\b|\b(strike|struck|attack).{0,40}\b(Larak|Kharg)\b/i;
    const kineticHits = items
      .filter((i) => KINETIC_HORMUZ_RE.test(i.title))
      .map((i) => i.title);

    let regime: TheaterWatch["stateMedia"]["regime"] = "unknown";
    if (feeDisputeHits.length > 0 && dealHits.length === 0) {
      regime = "no_deal_fees";
    } else if (feeDisputeHits.length > 0 && dealHits.length > 0) {
      regime = "fee_dispute_live";
    } else if (dealHits.length >= 2) {
      regime = "deal_announced";
    } else if (items.length > 0) {
      regime = "quiet";
    } else {
      regime = "unknown";
    }

    const baseRead = (() => {
      switch (regime) {
        case "no_deal_fees":
          return "State-media / fee headlines lean 'no deal without fees' — Hold trigger vs high Polymarket deal %. Read the text, not the yes%.";
        case "fee_dispute_live":
          return "Deal chatter AND fee-dispute language both in the tape — announcement text matters. Oman deal without fees = Trim; Iran no-fees refusal + US reject = Hold.";
        case "deal_announced":
          return "Multiple deal/ceasefire headlines — if Oman announces without addressing fees, market likely rallies (Trim more). Verify on Tasnim / ONA.";
        case "quiet":
          return "No clear Oman/Iran state-media confirmation yet. Polymarket % ≠ signed text — watch Tasnim + Oman News Agency.";
        default:
          return "State-media news unavailable — open Tasnim / ONA links manually.";
      }
    })();
    const kineticPrefix =
      kineticHits.length > 0
        ? `KINETIC LIVE — ${kineticHits.length} US/Hormuz strike headline(s) (e.g. Larak) in tape. Not Israel AER; fee/deal regime below still applies. `
        : "";
    const read = `${kineticPrefix}${baseRead}`;

    return {
      queries,
      items: items.slice(0, 16),
      feeDisputeHits,
      dealHits,
      kineticHits,
      regime,
      read,
      links,
      source: "Google News RSS + official portals",
    };
  } catch (err) {
    return {
      queries,
      items: [],
      feeDisputeHits: [],
      dealHits: [],
      kineticHits: [],
      regime: "unknown",
      read: "State-media RSS failed — open Tasnim / ONA manually.",
      links,
      source: "Google News RSS + official portals",
      error: String(err),
    };
  }
}

/** NYMEX month codes in calendar order. */
const NYMEX_MONTHS = ["F", "G", "H", "J", "K", "M", "N", "Q", "U", "V", "X", "Z"] as const;

function nymexCandidates(root: "HO" | "RB", count = 8): string[] {
  const now = new Date();
  let mi = now.getUTCMonth(); // 0-11 maps to F..Z index
  let year = now.getUTCFullYear();
  const out: string[] = [`${root}=F`];
  for (let i = 0; i < count; i++) {
    const code = NYMEX_MONTHS[mi]!;
    const yy = String(year).slice(-2);
    out.push(`${root}${code}${yy}.NYM`);
    mi += 1;
    if (mi >= 12) {
      mi = 0;
      year += 1;
    }
  }
  return out;
}

async function resolveFrontSecond(
  root: "HO" | "RB",
  label: string,
): Promise<ProductCurveLeg> {
  const candidates = nymexCandidates(root);
  const quotes = await Promise.all(
    candidates.map(async (symbol) => {
      try {
        const q = await getStockQuote(symbol);
        if (q.price == null) return null;
        return {
          symbol,
          label: q.shortName ?? symbol,
          price: q.price,
          changePct: q.changePercent,
        };
      } catch {
        return null;
      }
    }),
  );
  // Prefer specific month contracts over continuous for the pair; fall back to =F + first month.
  const specific = quotes.filter(
    (q): q is NonNullable<typeof q> => q != null && !q.symbol.endsWith("=F"),
  );
  const continuous = quotes.find((q) => q?.symbol.endsWith("=F")) ?? null;
  let near = specific[0] ?? continuous;
  let far = specific[1] ?? null;
  if (near && continuous && near.symbol === continuous.symbol && specific[0]) {
    near = specific[0];
    far = specific[1] ?? null;
  }
  if (!near) {
    return {
      root,
      label,
      near: { symbol: `${root}=F`, label: "front", price: null, changePct: null },
      far: { symbol: "—", label: "2nd", price: null, changePct: null },
      spread: null,
      spreadChangePctApprox: null,
      regime: "unknown",
      read: `${label} calendar quotes unavailable.`,
    };
  }
  if (!far && continuous && near.symbol !== continuous.symbol) {
    far = continuous;
  }

  const spread =
    near.price != null && far?.price != null ? near.price - far.price : null;
  // Approx: if front dumping harder than back while spread still >0, backwardation eroding.
  const nearChg = near.changePct;
  const farChg = far?.changePct ?? null;
  let regime: ProductCurveLeg["regime"] = "unknown";
  if (spread != null) {
    if (spread > 0.02) {
      if (
        nearChg != null &&
        farChg != null &&
        nearChg < farChg - 0.75 &&
        nearChg < -1.5
      ) {
        regime = "backwardation_eroding";
      } else if (nearChg != null && nearChg <= -2.5 && spread < 0.08) {
        regime = "backwardation_eroding";
      } else {
        regime = "backwardation_firm";
      }
    } else if (spread < -0.02) {
      regime = "contango";
    } else {
      regime = "flat";
    }
  }

  const spreadChangePctApprox =
    nearChg != null && farChg != null ? nearChg - farChg : null;

  const read = (() => {
    const spr =
      spread != null ? `$${spread.toFixed(4)}/gal front−2nd` : "spread —";
    switch (regime) {
      case "backwardation_firm":
        return `${label}: ${spr} holding — downstream still pricing physical tightness (supports FRO freight convexity).`;
      case "backwardation_eroding":
        return `${label}: ${spr} but front weaker than 2nd — backwardation eroding; Hormuz-reopen / soft product demand priced downstream.`;
      case "contango":
        return `${label}: ${spr} contango — product scarcity not the story right now.`;
      case "flat":
        return `${label}: ${spr} flat — no clear product-curve signal.`;
      default:
        return `${label}: calendar incomplete.`;
    }
  })();

  return {
    root,
    label,
    near: {
      symbol: near.symbol,
      label: near.label,
      price: near.price,
      changePct: near.changePct,
    },
    far: far
      ? {
          symbol: far.symbol,
          label: far.label,
          price: far.price,
          changePct: far.changePct,
        }
      : { symbol: "—", label: "2nd", price: null, changePct: null },
    spread,
    spreadChangePctApprox,
    regime,
    read,
  };
}

async function fetchProductCurves(): Promise<TheaterWatch["productCurves"]> {
  const [heatingOil, gasoline] = await Promise.all([
    resolveFrontSecond("HO", "Heating Oil (HO)"),
    resolveFrontSecond("RB", "RBOB Gasoline (RB)"),
  ]);
  const regimes = [heatingOil.regime, gasoline.regime];
  let regime: TheaterWatch["productCurves"]["regime"] = "unknown";
  if (regimes.every((r) => r === "backwardation_firm")) {
    regime = "backwardation_firm";
  } else if (regimes.some((r) => r === "backwardation_eroding")) {
    regime = "backwardation_eroding";
  } else if (regimes.every((r) => r === "contango")) {
    regime = "contango";
  } else if (regimes.every((r) => r === "unknown")) {
    regime = "unknown";
  } else {
    regime = "mixed";
  }

  const read = (() => {
    switch (regime) {
      case "backwardation_firm":
        return "HO + RB front−2nd backwardation holding — refined-product tightness still real despite WTI moves; supportive for FRO if Hormuz risk stays.";
      case "backwardation_eroding":
        return "Product calendar backwardation eroding (HO and/or RB) — downstream pricing Hormuz reopen / softer cracks. Pair with WTI Sep−Dec.";
      case "contango":
        return "HO/RB in contango — no product-scarcity premium in the curve.";
      case "mixed":
        return `HO: ${heatingOil.regime.replace(/_/g, " ")} · RB: ${gasoline.regime.replace(/_/g, " ")}. ${heatingOil.read} ${gasoline.read}`;
      default:
        return "Refined product calendars unavailable.";
    }
  })();

  return {
    heatingOil,
    gasoline,
    regime,
    read,
    source: "yahoo-finance2",
  };
}
