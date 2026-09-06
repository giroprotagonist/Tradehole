/**
 * Ultimate 5-Lock Intel Alarm — Kharg / Hormuz assault stacked-footprint trigger.
 *
 * Level rules (priority):
 * - L1+L2+L3 (Bataan + E-6B + IRGC) → RED — critical three-lock stack (even if L4/L5 false)
 * - ALL 5 locks → RED — full 5-lock
 * - Bibi secondary + any 2 of 5 locks → RED
 * - 3–4 locks without three-lock / Bibi+2 → YELLOW
 * - Bibi trigger alone → at least YELLOW
 * - ≤2 without Bibi → green / posturing
 *
 * Bibi trigger: USD/ILS Shekel spike toward/at ~3.9–4.0 (lagging market-panic
 * arm — often ON/AFTER kinetic pricing) OR fresh corroborated
 * Israel Natanz/Fordow/nuclear-site strike news (≤48h pubDate, ≥2 same-day sources;
 * recycled war-wave reprints hard-excluded). Mechanics only — ignore Polymarket fluff
 * (Bibi path is the intentional exception).
 *
 * Limits (honest):
 * - Lock 1 (Bataan AIS): IRONSIGHT ships kinematics when present; else manual SOG/course.
 *   Current IRONSIGHT /api/ships is static OSINT (no SOG) — L1 stays unknown without enrichment/manual.
 * - Lock 3 (IRGC Telegram): no GramJS; IRONSIGHT telegram panels + Google News RSS keyword approx.
 * - Lock 4 (NAVWARN): RSS/news classifier + optional manual override; not a live NAVCEN parse.
 * - Lock 5 (VLCC Cape): news diversion hints + manual VLCC count (no free bulk AIS).
 */

import { getHistoryDb } from "./history/db";
import { getStockQuote } from "./market";
import { classifyNavwarnItems } from "./analytics/navwarnClassifier";

const IRONSIGHT_URL = process.env.IRONSIGHT_URL ?? "http://localhost:3170";
export const INTEL_ALARM_POLL_MS = 60_000;

export type IntelAlarmLevel = "green" | "yellow" | "red";

/** Why overall level is red; null when not red. */
export type IntelAlarmRedReason =
  | "five_lock"
  | "three_lock_stack"
  | "bibi_plus_locks"
  | null;

/** USD/ILS Shekel spike snapshot — shared by Bibi secondary + dashboard Shekel alarm. */
export type ShekelAlarmSnapshot = {
  symbol: string;
  price: number | null;
  changePct: number | null;
  /** Crisis band target (~4.00 ILS per USD). */
  threshold: number;
  /** Documented Bibi band floor (~3.9). */
  spikeFloor: number;
  /** Hard fire level (aligns theaterWatch spike_toward_4). */
  spikeHard: number;
  /** Rate-of-change path: price ≥ this AND d/d ≥ rocPct. */
  rocFloor: number;
  rocPct: number;
  spiked: boolean;
  regime: "quiet" | "firm" | "spiked" | "unknown";
  /** Human-readable fire rule for UI / Export. */
  rule: string;
  /** FX-only read (no nuclear leg). */
  read: string;
};

export type BibiTriggerEvidence = {
  shekel: ShekelAlarmSnapshot;
  nuclearStrikeNews: {
    hit: boolean;
    /** Fresh titles that passed age + anti-reprint filters (may be <2 → hit false). */
    titles: string[];
    /** Recycled / undated / older-than-window headlines excluded from the arm. */
    rejectedStale: string[];
    /** Hours of pubDate freshness required. */
    windowHours: number;
    /** How nuclear leg armed (or none). */
    corroboration: "multi_source" | "none";
  };
  read: string;
};

export type IntelAlarmManualInputs = {
  /** USS Bataan SOG knots from AIS UI */
  bataanSog: number | null;
  /** Course degrees true */
  bataanCourse: number | null;
  /** Latitude °N */
  bataanLat: number | null;
  /** Longitude °E — required with lat to plot manual ARG pin */
  bataanLon: number | null;
  /** Force Lock 1 true/false; null = auto from numbers */
  bataanLockForce: boolean | null;
  /** Sister ARG hulls — optional manual lat/lon for Map (not Lock 1). */
  boxerSog: number | null;
  boxerCourse: number | null;
  boxerLat: number | null;
  boxerLon: number | null;
  newYorkSog: number | null;
  newYorkCourse: number | null;
  newYorkLat: number | null;
  newYorkLon: number | null;
  /** Manual VLCC count diverting SW south of Yemen */
  vlccDivertCount: number | null;
  /** Force Lock 4 (NAVWARN) */
  navwarnForce: boolean | null;
  /** Force Lock 3 (IRGC pulse) */
  irgcForce: boolean | null;
  /** Force Lock 5 */
  capeForce: boolean | null;
  note: string | null;
  updatedAt: string | null;
};

export type IntelLockId = 1 | 2 | 3 | 4 | 5;

export type IntelLock = {
  id: IntelLockId;
  name: string;
  short: string;
  triggered: boolean;
  source: "auto" | "manual" | "mixed" | "unknown";
  read: string;
  evidence: Record<string, unknown>;
  links: Array<{ label: string; href: string }>;
  limit: string;
};

export type IntelAlarmState = {
  locks: IntelLock[];
  lockCount: number;
  level: IntelAlarmLevel;
  /** L1 ∧ L2 ∧ L3 — unmistakable Kharg/Hormuz signature. */
  threeLockStack: boolean;
  /** Shekel ≥~3.9–4.0 or fresh corroborated Natanz/Fordow strike news. */
  bibiTrigger: boolean;
  bibi: BibiTriggerEvidence;
  /**
   * Dedicated Shekel (USD/ILS) spike alarm — same FX rules as Bibi shekel leg.
   * Exposed for StatusBar / ShekelSpikeAlarm / Export / OSINT without nuclear noise.
   */
  shekelAlarm: ShekelAlarmSnapshot;
  /** Populated when level === red. */
  redReason: IntelAlarmRedReason;
  reads: string[];
  evaluatedAt: string;
  manual: IntelAlarmManualInputs;
  previousLevel: IntelAlarmLevel | null;
  transitioned: boolean;
  limits: string[];
  rule: string;
};

type NewsItem = { title: string; link: string; pubDate: string };

type AdsbAc = {
  hex?: string;
  flight?: string;
  t?: string;
  desc?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | string;
  gs?: number;
  dbFlags?: number;
};

const EMPTY_MANUAL: IntelAlarmManualInputs = {
  bataanSog: null,
  bataanCourse: null,
  bataanLat: null,
  bataanLon: null,
  bataanLockForce: null,
  boxerSog: null,
  boxerCourse: null,
  boxerLat: null,
  boxerLon: null,
  newYorkSog: null,
  newYorkCourse: null,
  newYorkLat: null,
  newYorkLon: null,
  vlccDivertCount: null,
  navwarnForce: null,
  irgcForce: null,
  capeForce: null,
  note: null,
  updatedAt: null,
};

const E6B_HEXES = new Set(
  ["AE041D", "AE016E", "AE041C"].map((h) => h.toUpperCase()),
);
/** Start-anchored — avoids Canadian CGAZE / substring pollution. */
const E6B_CALLSIGN_RE = /^(VAMPIRE|GAZE|MAYHEM)(\d|\s|$)/i;
/** US military ICAO allocation (AE****) — callsign-only hits must be US mil. */
function isUsMilHex(hex: string): boolean {
  return /^AE[0-9A-F]{4}$/i.test(hex.replace("~", ""));
}

/** CONUS rough box */
const CONUS = { latMin: 24, latMax: 50, lonMin: -125, lonMax: -66 };
/** Eastern Med / approaches */
const MED = { latMin: 30, latMax: 42, lonMin: 10, lonMax: 37 };

let manualInputs: IntelAlarmManualInputs = { ...EMPTY_MANUAL };
let latestState: IntelAlarmState | null = null;
let previousLevel: IntelAlarmLevel | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let evalInFlight = false;

export function getIntelAlarmManual(): IntelAlarmManualInputs {
  return { ...manualInputs };
}

export function setIntelAlarmManual(
  patch: Partial<IntelAlarmManualInputs>,
): IntelAlarmManualInputs {
  const num = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const bool = (v: unknown): boolean | null => {
    if (v == null || v === "") return null;
    if (typeof v === "boolean") return v;
    if (v === "true" || v === "1") return true;
    if (v === "false" || v === "0") return false;
    return null;
  };
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : v === null ? null : null;

  if ("bataanSog" in patch) manualInputs.bataanSog = num(patch.bataanSog);
  if ("bataanCourse" in patch)
    manualInputs.bataanCourse = num(patch.bataanCourse);
  if ("bataanLat" in patch) manualInputs.bataanLat = num(patch.bataanLat);
  if ("bataanLon" in patch) manualInputs.bataanLon = num(patch.bataanLon);
  if ("bataanLockForce" in patch)
    manualInputs.bataanLockForce = bool(patch.bataanLockForce);
  if ("boxerSog" in patch) manualInputs.boxerSog = num(patch.boxerSog);
  if ("boxerCourse" in patch) manualInputs.boxerCourse = num(patch.boxerCourse);
  if ("boxerLat" in patch) manualInputs.boxerLat = num(patch.boxerLat);
  if ("boxerLon" in patch) manualInputs.boxerLon = num(patch.boxerLon);
  if ("newYorkSog" in patch) manualInputs.newYorkSog = num(patch.newYorkSog);
  if ("newYorkCourse" in patch)
    manualInputs.newYorkCourse = num(patch.newYorkCourse);
  if ("newYorkLat" in patch) manualInputs.newYorkLat = num(patch.newYorkLat);
  if ("newYorkLon" in patch) manualInputs.newYorkLon = num(patch.newYorkLon);
  if ("vlccDivertCount" in patch)
    manualInputs.vlccDivertCount = num(patch.vlccDivertCount);
  if ("navwarnForce" in patch)
    manualInputs.navwarnForce = bool(patch.navwarnForce);
  if ("irgcForce" in patch) manualInputs.irgcForce = bool(patch.irgcForce);
  if ("capeForce" in patch) manualInputs.capeForce = bool(patch.capeForce);
  if ("note" in patch) manualInputs.note = str(patch.note);
  manualInputs.updatedAt = new Date().toISOString();
  return { ...manualInputs };
}

export function getLatestIntelAlarm(): IntelAlarmState | null {
  return latestState;
}

/** Match theaterWatch Shekel crisis threshold (~4.00 ILS per USD). */
export const SHEKEL_THRESHOLD = 4.0;
/** Documented Bibi band floor (~3.9–4.0). */
export const SHEKEL_SPIKE_FLOOR = 3.9;
/** Hard fire — aligns theaterWatch `spike_toward_4` (≥3.85). */
export const SHEKEL_SPIKE_HARD = 3.85;
/** Rate-of-change path: price ≥ floor AND d/d ≥ rocPct. */
export const SHEKEL_ROC_FLOOR = 3.6;
export const SHEKEL_ROC_PCT = 1.5;
/** Firm (elevated, not spiked) — align theaterWatch. */
const SHEKEL_FIRM_FLOOR = 3.35;
const SHEKEL_FIRM_PCT = 0.8;

export const SHEKEL_SPIKE_RULE = `SPIKE if USD/ILS ≥ ${SHEKEL_SPIKE_HARD} (band ~${SHEKEL_SPIKE_FLOOR}–${SHEKEL_THRESHOLD}) OR (USD/ILS ≥ ${SHEKEL_ROC_FLOOR} AND d/d ≥ +${SHEKEL_ROC_PCT}%). Crisis threshold ~${SHEKEL_THRESHOLD.toFixed(2)}. Lagging market-panic arm for Bibi secondary → YELLOW alone / RED with ≥2 locks (often ON/AFTER kinetic pricing — not a pre-launch lead).`;

/** Nuclear-site strike RSS must carry a parseable pubDate within this window. */
const NUCLEAR_NEWS_WINDOW_HOURS = 48;
const NUCLEAR_NEWS_MAX_AGE_MS = NUCLEAR_NEWS_WINDOW_HOURS * 60 * 60 * 1000;
/** Need ≥2 distinct fresh same-UTC-day sources before nuclear news alone arms Bibi. */
const NUCLEAR_CORROBORATION_MIN = 2;

/** Past/confirm kinetic language near Natanz/Fordow — not mere threat chatter. */
const NUCLEAR_STRIKE_RE =
  /(Natanz|Fordow|Fordu|nuclear\s+(site|facility|plant)|enrichment\s+(site|facility)).{0,50}(struck|bombed|raided|airstrikes?|air\s*strikes?|missile\s+strikes?|(?:joint\s+)?strike|attack|bomb|hit|raid)|(?:Israel|IDF|IAF|US|U\.?S\.?).{0,50}(struck|bombed|raided|airstrikes?|air\s*strikes?|(?:joint\s+)?strike|attack|bomb).{0,50}(Natanz|Fordow|Fordu|nuclear)|(struck|bombed|raided|airstrikes?|air\s*strikes?|(?:joint\s+)?strike|attack).{0,40}(on\s+(?:its\s+)?)?(Natanz|Fordow|Fordu)/i;

/**
 * Speculative / denial / pure allegation — must not corroborate Bibi nuclear leg.
 * Applied after NUCLEAR_STRIKE_RE candidate match.
 */
const NUCLEAR_NON_EVENT_RE =
  /\b(threaten(?:ing|s|ed)?\s+to\s+(?:strike|attack|bomb|hit)|threat(?:ens?)?\s+to\s+(?:strike|attack)|considering\s+(?:a\s+)?(?:strike|attack)|may\s+(?:strike|attack)|could\s+(?:strike|attack)|plans?\s+to\s+(?:strike|attack)|did\s+not\s+(?:strike|attack|bomb|hit)|denies?\s+(?:striking|attacking|hitting|any\s+strike)|no\s+(?:strike|attack)\s+(?:on|at|against)|alleges?\s+that|allegation(?:s)?\s+(?:of|that)|what\s+to\s+know\s+about)\b/i;

/**
 * SEO-recycled war-wave reprints
 * ("Iran confirms US-Israel / US and Israel joint strike on (its) Natanz").
 * Google often resurfaces these with a fresh RSS pubDate even when no new kinetic.
 */
const STALE_NATANZ_REPRINT_RE =
  /Iran\s+confirms?.{0,100}(U\.?S\.?\s*(?:and|&|[-–\/])\s*Israel|US[-–\/]?Israel|American[-–]?Israeli|Israel\s*(?:and|&|[-–\/])\s*U\.?S\.?|Israel[-–\/]?US).{0,80}(joint\s+)?strike.{0,60}(on\s+(its\s+)?)?Natanz|confirms?.{0,50}(joint\s+)?strike\s+on\s+(its\s+)?Natanz|(U\.?S\.?\s*(?:and|&|[-–\/])\s*Israel|US[-–\/]Israel|Israel[-–\/]US).{0,50}(joint\s+)?strike.{0,50}(on\s+(its\s+)?)?Natanz/i;

function parseRssPubDate(pubDate: string): Date | null {
  if (!pubDate?.trim()) return null;
  const d = new Date(pubDate);
  return Number.isFinite(d.getTime()) ? d : null;
}

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function resolveAlarmLevel(opts: {
  lockCount: number;
  threeLockStack: boolean;
  bibiTrigger: boolean;
}): { level: IntelAlarmLevel; redReason: IntelAlarmRedReason } {
  const { lockCount, threeLockStack, bibiTrigger } = opts;
  const bibiPlusLocks = bibiTrigger && lockCount >= 2;

  let level: IntelAlarmLevel;
  if (threeLockStack || lockCount >= 5 || bibiPlusLocks) {
    level = "red";
  } else if (lockCount >= 3 || bibiTrigger) {
    level = "yellow";
  } else {
    level = "green";
  }

  let redReason: IntelAlarmRedReason = null;
  if (level === "red") {
    if (lockCount >= 5) redReason = "five_lock";
    else if (threeLockStack) redReason = "three_lock_stack";
    else redReason = "bibi_plus_locks";
  }

  return { level, redReason };
}

/** Pure Shekel spike/regime classifier for tests + Bibi secondary. */
export function classifyShekelSpike(
  price: number | null,
  changePct: number | null,
): { spiked: boolean; regime: ShekelAlarmSnapshot["regime"] } {
  if (price == null) return { spiked: false, regime: "unknown" };
  const spiked =
    price >= SHEKEL_SPIKE_HARD ||
    (price >= SHEKEL_ROC_FLOOR && (changePct ?? 0) >= SHEKEL_ROC_PCT);
  if (spiked) return { spiked: true, regime: "spiked" };
  if (
    price >= SHEKEL_FIRM_FLOOR ||
    (changePct != null && changePct >= SHEKEL_FIRM_PCT)
  ) {
    return { spiked: false, regime: "firm" };
  }
  return { spiked: false, regime: "quiet" };
}

function buildShekelSnapshot(
  symbol: string,
  price: number | null,
  changePct: number | null,
): ShekelAlarmSnapshot {
  const { spiked, regime } = classifyShekelSpike(price, changePct);

  const read = (() => {
    switch (regime) {
      case "spiked":
        return `SHEKEL SPIKE (lagging market-panic arm) — USD/ILS ${price?.toFixed(4) ?? "—"} (≥${SHEKEL_SPIKE_HARD} band ~${SHEKEL_SPIKE_FLOOR}–${SHEKEL_THRESHOLD}${
          changePct != null ? ` · d/d ${changePct.toFixed(2)}%` : ""
        }). Arms Bibi secondary — often ON/AFTER kinetic pricing, not a pre-launch lead.`;
      case "firm":
        return `USD/ILS ${price?.toFixed(4) ?? "—"} firming (${
          changePct != null ? `${changePct.toFixed(2)}%` : "—"
        }) — elevated premium, not yet spike (≥${SHEKEL_SPIKE_HARD} or ≥${SHEKEL_ROC_FLOOR}+${SHEKEL_ROC_PCT}% d/d).`;
      case "quiet":
        return `USD/ILS ${price?.toFixed(4) ?? "—"} quiet · need ≥${SHEKEL_SPIKE_HARD} (band ~${SHEKEL_SPIKE_FLOOR}–${SHEKEL_THRESHOLD}) or ≥${SHEKEL_ROC_FLOOR}+${SHEKEL_ROC_PCT}% d/d.`;
      default:
        return "USD/ILS quote unavailable — check Yahoo ILS=X / USDILS=X.";
    }
  })();

  return {
    symbol,
    price,
    changePct,
    threshold: SHEKEL_THRESHOLD,
    spikeFloor: SHEKEL_SPIKE_FLOOR,
    spikeHard: SHEKEL_SPIKE_HARD,
    rocFloor: SHEKEL_ROC_FLOOR,
    rocPct: SHEKEL_ROC_PCT,
    spiked,
    regime,
    rule: SHEKEL_SPIKE_RULE,
    read,
  };
}

async function evalBibiTrigger(): Promise<{
  bibiTrigger: boolean;
  bibi: BibiTriggerEvidence;
  shekelAlarm: ShekelAlarmSnapshot;
}> {
  let shekelPrice: number | null = null;
  let shekelChangePct: number | null = null;
  let shekelSymbol = "ILS=X";
  try {
    let q = await getStockQuote("ILS=X").catch(() => null);
    if (q?.price == null) {
      q = await getStockQuote("USDILS=X").catch(() => null);
    }
    shekelPrice = q?.price ?? null;
    shekelChangePct = q?.changePercent ?? null;
    shekelSymbol = q?.symbol ?? shekelSymbol;
  } catch {
    /* quote optional */
  }

  const shekel = buildShekelSnapshot(
    shekelSymbol,
    shekelPrice,
    shekelChangePct,
  );
  const shekelSpiked = shekel.spiked;

  const now = Date.now();
  const fresh: Array<{ title: string; pubMs: number; day: string }> = [];
  const rejectedStale: string[] = [];
  try {
    const queries = [
      'Israel (strike OR attack OR bomb) (Natanz OR Fordow OR "nuclear site" OR "nuclear facility")',
      '(Natanz OR Fordow OR Fordu) (Israel OR IAF OR IDF) (strike OR attack OR raid)',
    ];
    const batches = await Promise.all(
      queries.map((q) => fetchGoogleNewsRss(q, 6).catch(() => [] as NewsItem[])),
    );
    const seen = new Set<string>();
    for (const item of batches.flat()) {
      if (!NUCLEAR_STRIKE_RE.test(item.title)) continue;
      const key = item.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      // Hard-exclude known recycled war-wave reprints regardless of Google's pubDate.
      if (STALE_NATANZ_REPRINT_RE.test(item.title)) {
        rejectedStale.push(item.title);
        continue;
      }
      // Denials / "threatening to" / pure speculation are not kinetic corroboration.
      if (NUCLEAR_NON_EVENT_RE.test(item.title)) {
        rejectedStale.push(item.title);
        continue;
      }

      const pub = parseRssPubDate(item.pubDate);
      if (!pub) {
        rejectedStale.push(item.title);
        continue;
      }
      const ageMs = now - pub.getTime();
      if (ageMs < 0 || ageMs > NUCLEAR_NEWS_MAX_AGE_MS) {
        rejectedStale.push(item.title);
        continue;
      }

      fresh.push({
        title: item.title,
        pubMs: pub.getTime(),
        day: utcDayKey(pub),
      });
    }
  } catch {
    /* RSS optional */
  }

  // Nuclear-alone arm requires ≥2 distinct fresh titles on the same UTC day.
  const byDay = new Map<string, string[]>();
  for (const f of fresh) {
    const list = byDay.get(f.day) ?? [];
    list.push(f.title);
    byDay.set(f.day, list);
  }
  let bestDayTitles: string[] = [];
  for (const titles of byDay.values()) {
    if (titles.length > bestDayTitles.length) bestDayTitles = titles;
  }
  const multiSource = bestDayTitles.length >= NUCLEAR_CORROBORATION_MIN;
  const nuclearHit = multiSource;
  const corroboration: BibiTriggerEvidence["nuclearStrikeNews"]["corroboration"] =
    multiSource ? "multi_source" : "none";

  const bibiTrigger = shekelSpiked || nuclearHit;

  const freshTitles = fresh.map((f) => f.title);
  const nuclearNote = nuclearHit
    ? `nuclear-site strike news corroborated (${bestDayTitles.length} same-day ≤${NUCLEAR_NEWS_WINDOW_HOURS}h): ${bestDayTitles[0]}`
    : freshTitles.length > 0
      ? `nuclear RSS ${freshTitles.length} fresh ≤${NUCLEAR_NEWS_WINDOW_HOURS}h but need ≥${NUCLEAR_CORROBORATION_MIN} same-day sources (not armed)`
      : rejectedStale.length > 0
        ? `nuclear RSS ${rejectedStale.length} stale/recycled/undated/non-event filtered (not armed)`
        : `nuclear strike headlines 0`;

  const read = bibiTrigger
    ? [
        "Bibi secondary FIRED —",
        shekelSpiked
          ? `lagging market-panic arm · USD/ILS ${shekelPrice?.toFixed(4) ?? "—"} ≥~${SHEKEL_SPIKE_FLOOR.toFixed(1)} / toward ~${SHEKEL_THRESHOLD.toFixed(2)}`
          : null,
        nuclearHit ? nuclearNote : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : `Bibi secondary quiet — USD/ILS ${shekelPrice?.toFixed(4) ?? "—"} (need ≥~${SHEKEL_SPIKE_FLOOR.toFixed(1)} lagging FX arm) · ${nuclearNote}.`;

  return {
    bibiTrigger,
    bibi: {
      shekel,
      nuclearStrikeNews: {
        hit: nuclearHit,
        titles: (nuclearHit ? bestDayTitles : freshTitles).slice(0, 8),
        rejectedStale: rejectedStale.slice(0, 8),
        windowHours: NUCLEAR_NEWS_WINDOW_HOURS,
        corroboration,
      },
      read,
    },
    shekelAlarm: shekel,
  };
}

async function fetchGoogleNewsRss(
  query: string,
  limit = 8,
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
    const link = block.match(/<link>(.*?)<\/link>/)?.[1] ?? "";
    const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? "";
    if (title) {
      items.push({
        title: title
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'"),
        link,
        pubDate,
      });
    }
  }
  return items;
}

function altOf(a: AdsbAc): number | null {
  if (typeof a.alt_baro === "number") return a.alt_baro;
  if (a.alt_baro === "ground") return 0;
  if (a.alt_baro == null) return null;
  const n = Number(a.alt_baro);
  return Number.isFinite(n) ? n : null;
}

function inBox(
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

function isE6TypeOrDesc(a: AdsbAc): boolean {
  const t = (a.t ?? "").toUpperCase();
  const desc = (a.desc ?? "").toUpperCase();
  return (
    /^E-?6B?$/.test(t) ||
    t === "E6" ||
    t.startsWith("E6") ||
    desc.includes("MERCURY") ||
    desc.includes("TACAMO") ||
    desc.includes("E-6")
  );
}

/** Tanker / non-Mercury types that pollute hex watch (e.g. AE041D typed K35R). */
function isClearlyNotE6(a: AdsbAc): boolean {
  const t = (a.t ?? "").toUpperCase();
  const desc = (a.desc ?? "").toUpperCase();
  if (/KC.?135|KC135|K35R|KC35|K35|KC-?46|KC46|R135/.test(t)) return true;
  if (desc.includes("STRATOTANKER") || desc.includes("PEGASUS")) return true;
  if (isE6TypeOrDesc(a)) return false;
  // Concrete non-E6 type on a watched hex → not confirmed Mercury
  if (t && !/^E-?6/.test(t) && t !== "E6" && !t.startsWith("E6")) return true;
  return false;
}

function isE6bCandidate(a: AdsbAc): boolean {
  const hex = (a.hex ?? "").replace("~", "").toUpperCase();
  const cs = (a.flight ?? "").trim().toUpperCase();
  if (hex && E6B_HEXES.has(hex)) {
    // Hex watch still surfaces in evidence; qualifyAirborne rejects tankers.
    return true;
  }
  if (isE6TypeOrDesc(a)) return true;
  // Callsign-only: start-anchored TACAMO names + US mil hex (rejects CGAZE etc.)
  if (E6B_CALLSIGN_RE.test(cs) && isUsMilHex(hex)) return true;
  return false;
}

function qualifiesAirborneCommand(a: AdsbAc): boolean {
  const hex = (a.hex ?? "").replace("~", "").toUpperCase();
  const cs = (a.flight ?? "").trim().toUpperCase();
  const hexHit = Boolean(hex && E6B_HEXES.has(hex));
  const csHit = E6B_CALLSIGN_RE.test(cs) && isUsMilHex(hex);
  const typeHit = isE6TypeOrDesc(a);
  if (!hexHit && !csHit && !typeHit) return false;
  // AE041D typed K35R etc. — hex alone is NOT confirmed Mercury
  if (isClearlyNotE6(a)) return false;
  // Alt/speed gates only when fields are present
  const alt = altOf(a);
  const gs = typeof a.gs === "number" ? a.gs : null;
  if (alt != null && alt < 1000) return false;
  if (gs != null && gs < 100) return false;
  // Prefer hex/callsign; type-only still counts if kinematics ok (or missing)
  return true;
}

/** Hex-watch hit that is NOT confirmed E-6 (for NOISY labeling). Exported for tests. */
export function isNoisyHexWatch(a: {
  hex?: string | null;
  t?: string | null;
  desc?: string | null;
  flight?: string | null;
}): boolean {
  const hex = (a.hex ?? "").replace("~", "").toUpperCase();
  if (!hex || !E6B_HEXES.has(hex)) return false;
  return isClearlyNotE6(a as AdsbAc);
}

async function evalLock1Amphib(
  manual: IntelAlarmManualInputs,
): Promise<IntelLock> {
  const links = [
    {
      label: "CruisingEarth · Bataan (stale-risk)",
      href: "https://www.cruisingearth.com/ship-tracker/united-states-navy/uss-bataan/",
    },
    {
      label: "VesselFinder · Bataan LHD-5",
      href: "https://www.vesselfinder.com/vessels?name=BATAAN",
    },
    {
      label: "MarineTraffic · Bataan",
      href: "https://www.marinetraffic.com/en/ais/index/search/all?keyword=BATAAN",
    },
    {
      label: "MyShipTracking · Bataan",
      href: "https://www.myshiptracking.com/vessels?name=BATAAN",
    },
  ];

  let ironsight: {
    name: string;
    hull: string;
    lat: number;
    lon: number;
    status: string;
    sogKt: number | null;
    courseDeg: number | null;
    kinematicsSource: "ironsight" | "none";
  } | null = null;
  let ironsightError: string | undefined;
  try {
    const base = IRONSIGHT_URL.replace(/\/$/, "");
    const res = await fetch(
      `${base}/api/ships?conflict=${encodeURIComponent("iran-israel")}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!res.ok) throw new Error(`IRONSIGHT ships HTTP ${res.status}`);
    const json = (await res.json()) as { ships?: Array<Record<string, unknown>> };
    const hit = (json.ships ?? []).find((s) =>
      /Bataan|LHD-5/i.test(`${String(s.name ?? "")} ${String(s.hull ?? "")}`),
    );
    if (hit) {
      const motion = hit.motion as Record<string, unknown> | undefined;
      const ais = hit.ais as Record<string, unknown> | undefined;
      const nav = hit.nav as Record<string, unknown> | undefined;
      const kinematics = hit.kinematics as Record<string, unknown> | undefined;
      const pos = hit.position as Record<string, unknown> | undefined;
      const num = (raw: unknown): number | null => {
        if (typeof raw === "number" && Number.isFinite(raw)) return raw;
        if (typeof raw === "string" && raw.trim()) {
          const n = Number(raw);
          return Number.isFinite(n) ? n : null;
        }
        return null;
      };
      const sogKt =
        num(hit.sog) ??
        num(hit.SOG) ??
        num(hit.speed) ??
        num(hit.speedKt) ??
        num(hit.speedKts) ??
        num(hit.sogKt) ??
        num(hit.Speed) ??
        num(motion?.sog) ??
        num(motion?.speed) ??
        num(ais?.sog) ??
        num(ais?.speed) ??
        num(nav?.sog) ??
        num(kinematics?.sog);
      const courseDeg =
        num(hit.course) ??
        num(hit.cog) ??
        num(hit.COG) ??
        num(hit.courseDeg) ??
        num(hit.courseOverGround) ??
        num(hit.heading) ??
        num(hit.hdg) ??
        num(hit.trueHeading) ??
        num(motion?.course) ??
        num(motion?.cog) ??
        num(ais?.course) ??
        num(ais?.heading) ??
        num(nav?.course) ??
        num(kinematics?.course);
      const lat =
        num(hit.lat) ??
        num(hit.latitude) ??
        num(pos?.lat) ??
        num(pos?.latitude) ??
        NaN;
      const lon =
        num(hit.lon) ??
        num(hit.lng) ??
        num(hit.longitude) ??
        num(pos?.lon) ??
        num(pos?.lng) ??
        num(pos?.longitude) ??
        NaN;
      ironsight = {
        name: String(hit.name ?? "USS Bataan"),
        hull: String(hit.hull ?? "LHD-5"),
        lat,
        lon,
        status: String(hit.status ?? hit.posture ?? ""),
        sogKt,
        courseDeg,
        kinematicsSource: sogKt != null || courseDeg != null ? "ironsight" : "none",
      };
    }
  } catch (err) {
    ironsightError = String(err);
  }

  // Manual operator marks win; else use IRONSIGHT kinematics when present.
  const sog = manual.bataanSog ?? ironsight?.sogKt ?? null;
  const course = manual.bataanCourse ?? ironsight?.courseDeg ?? null;
  const lat =
    manual.bataanLat ??
    (ironsight && Number.isFinite(ironsight.lat) ? ironsight.lat : null);
  const usedIronsightKin =
    (manual.bataanSog == null && ironsight?.sogKt != null) ||
    (manual.bataanCourse == null && ironsight?.courseDeg != null);

  const limit = usedIronsightKin
    ? "L1 SOG/course from IRONSIGHT ships kinematics (auto). Manual marks still override. Sticky lat from IRONSIGHT when present."
    : ironsight
      ? "IRONSIGHT has Bataan lat/lon stamp but NO SOG/course in /api/ships (static OSINT today). L1 sprint stays unknown until IRONSIGHT enriches kinematics or you mark SOG from a fresh AIS UI — do not invent sprint."
      : "Free AIS (CruisingEarth/VesselFinder/MT) for warships is often STALE or homeport-ghost. Prefer IRONSIGHT naval stamp for theater presence; enter live SOG/course only from a fresh AIS UI or wait for IRONSIGHT kinematics enrichment.";

  let autoTriggered = false;
  if (sog != null && sog > 15) {
    const towardStrait = course != null && course > 310;
    const northEnough = lat != null && lat > 26.5;
    autoTriggered = towardStrait || northEnough;
  }

  let triggered: boolean;
  let source: IntelLock["source"];
  if (manual.bataanLockForce === true) {
    triggered = true;
    source = "manual";
  } else if (manual.bataanLockForce === false) {
    triggered = false;
    source = "manual";
  } else if (sog != null || course != null || manual.bataanLat != null) {
    triggered = autoTriggered;
    source =
      usedIronsightKin && manual.bataanSog == null && manual.bataanCourse == null
        ? "auto"
        : ironsight
          ? "mixed"
          : "manual";
  } else if (ironsight && lat != null && lat > 26.5) {
    // IRONSIGHT stamp north of 26.5 alone is weak without SOG — do not auto-fire
    triggered = false;
    source = "auto";
  } else {
    triggered = false;
    source =
      sog == null && course == null && manual.bataanLat == null
        ? "unknown"
        : "manual";
  }

  const kinBit = usedIronsightKin ? " · IRONSIGHT kinematics" : "";
  const read = triggered
    ? `Lock 1 FIRED — Bataan SOG ${sog ?? "—"} kts · course ${course ?? "—"}° · lat ${lat?.toFixed(2) ?? "—"}°N (need SOG>15 AND (course>310 OR lat>26.5)).${kinBit}`
    : sog == null && course == null && manual.bataanLat == null
      ? ironsight
        ? `Lock 1 idle — IRONSIGHT stamp @ ${lat?.toFixed(2) ?? "—"}°N but SOG/course unavailable (static OSINT). Sprint unknown until IRONSIGHT enriches kinematics or manual SOG mark. Deep links are backup.`
        : "Lock 1 idle — IRONSIGHT stamp unavailable; mark SOG / course / lat from a fresh AIS UI (backup deep links). Do not invent sprint."
      : `Lock 1 quiet — SOG ${sog ?? "—"} · course ${course ?? "—"}° · lat ${lat?.toFixed(2) ?? "—"}°N (need SOG>15 AND (course>310 OR lat>26.5)).${kinBit}`;

  return {
    id: 1,
    name: "Amphibious Sprint (USS Bataan LHD-5)",
    short: "Bataan sprint",
    triggered,
    source,
    read,
    evidence: {
      sog,
      course,
      lat,
      threshold: { sogGt: 15, courseGt: 310, latGt: 26.5 },
      ironsight,
      ironsightError,
      usedIronsightKin,
      force: manual.bataanLockForce,
    },
    links,
    limit,
  };
}

async function evalLock2Airborne(): Promise<IntelLock> {
  const links = [
    { label: "adsb.lol mil", href: "https://api.adsb.lol/v2/mil" },
    { label: "adsb.lol type/E6", href: "https://api.adsb.lol/v2/type/E6" },
  ];
  const limit =
    "Free ADS-B only (adsb.lol). Military often dark; missing tracks ≠ quiet posture.";

  try {
    const [milRes, typeRes, conusRes, medRes] = await Promise.all([
      fetch("https://api.adsb.lol/v2/mil", {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      }),
      fetch("https://api.adsb.lol/v2/type/E6", {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null),
      // CONUS sample center Kansas
      fetch("https://api.adsb.lol/v2/lat/39.0/lon/-98.0/dist/2500", {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      }).catch(() => null),
      // Eastern Med
      fetch("https://api.adsb.lol/v2/lat/35.0/lon/25.0/dist/1200", {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      }).catch(() => null),
    ]);

    const lists: AdsbAc[][] = [];
    for (const res of [milRes, typeRes, conusRes, medRes]) {
      if (res && res.ok) {
        const json = (await res.json()) as { ac?: AdsbAc[] };
        lists.push(json.ac ?? []);
      }
    }

    const seen = new Set<string>();
    const hits: AdsbAc[] = [];
    for (const list of lists) {
      for (const a of list) {
        if (!isE6bCandidate(a)) continue;
        const hex = (a.hex ?? "").replace("~", "").toUpperCase();
        if (!hex || seen.has(hex)) continue;
        // Prefer CONUS / Med / known hex / US-mil TACAMO callsign
        const cs = (a.flight ?? "").trim().toUpperCase();
        const regionOk =
          inBox(a, CONUS) ||
          inBox(a, MED) ||
          E6B_HEXES.has(hex) ||
          (E6B_CALLSIGN_RE.test(cs) && isUsMilHex(hex));
        if (!regionOk && a.lat != null) {
          // Still allow global mil type-E6 with kinematics
          if (!qualifiesAirborneCommand(a)) continue;
        }
        seen.add(hex);
        hits.push(a);
      }
    }

    const triggeredHits = hits.filter(qualifiesAirborneCommand);
    const noisyHits = hits.filter(isNoisyHexWatch);
    const samples = triggeredHits.slice(0, 8).map((a) => ({
      hex: (a.hex ?? "").replace("~", "").toUpperCase(),
      callsign: (a.flight ?? "").trim() || "—",
      type: a.t || a.desc || "E6?",
      lat: a.lat ?? null,
      lon: a.lon ?? null,
      alt: altOf(a),
      gs: typeof a.gs === "number" ? a.gs : null,
      region:
        a.lat != null && a.lon != null
          ? inBox(a, CONUS)
            ? "CONUS"
            : inBox(a, MED)
              ? "Med"
              : "other"
          : "unknown",
      confidence: "confirmed" as const,
    }));
    const noisySamples = noisyHits.slice(0, 4).map((a) => ({
      hex: (a.hex ?? "").replace("~", "").toUpperCase(),
      callsign: (a.flight ?? "").trim() || "—",
      type: a.t || a.desc || "?",
      lat: a.lat ?? null,
      lon: a.lon ?? null,
      alt: altOf(a),
      gs: typeof a.gs === "number" ? a.gs : null,
      confidence: "noisy_hex_watch" as const,
    }));

    const triggered = triggeredHits.length > 0;
    const sampleBits = [...samples, ...noisySamples]
      .slice(0, 6)
      .map((s) => {
        const pos =
          s.lat != null && s.lon != null
            ? `@${s.lat.toFixed(2)},${s.lon.toFixed(2)}`
            : "@?—?—";
        const reg =
          "region" in s && typeof (s as { region?: string }).region === "string"
            ? ` · ${(s as { region: string }).region}`
            : "";
        return `${s.hex}/${s.callsign}/type=${s.type}${pos}${reg}${s.confidence === "noisy_hex_watch" ? " [NOISY]" : ""}`;
      });
    const noisyNote =
      noisyHits.length > 0
        ? ` NOISY / hex-watch — not confirmed Mercury: ${noisyHits
            .slice(0, 3)
            .map((a) => {
              const h = (a.hex ?? "").replace("~", "").toUpperCase();
              const cs = (a.flight ?? "").trim() || "—";
              const typ = a.t || a.desc || "?";
              const pos =
                a.lat != null && a.lon != null
                  ? ` @${a.lat.toFixed(2)},${a.lon.toFixed(2)}`
                  : "";
              return `${h} ${cs} type=${typ}${pos}`;
            })
            .join("; ")}.`
        : "";
    return {
      id: 2,
      name: "Airborne Command Node (E-6B / AWACS)",
      short: "E-6B node",
      triggered,
      source: "auto",
      read: triggered
        ? `Lock 2 FIRED — ${triggeredHits.length} confirmed E-6B/command track(s) (VAMPIRE/GAZE/MAYHEM or type E6 + kinematics). Evidence: ${sampleBits.join(" · ") || "—"}.${noisyNote} L2 is Hormuz/5-Lock C2 — NOT Israel High-go (High-go = AER ≥3 + peer). Theater ghost aerial may still show 0 (different box).`
        : noisyHits.length > 0
          ? `Lock 2 quiet — NOISY / hex-watch only (not confirmed Mercury).${noisyNote} Theater 9b may show 0 E-6B airborne. Do not say Doomsday plane up.`
          : "Lock 2 quiet — no qualifying E-6B / VAMPIRE / GAZE / MAYHEM on adsb.lol mil+type+CONUS/Med sample.",
      evidence: {
        airborneCandidates: hits.length,
        triggeredCount: triggeredHits.length,
        noisyHexWatchCount: noisyHits.length,
        samples: [...samples, ...noisySamples],
        hexWatch: [...E6B_HEXES],
        callsignWatch: ["VAMPIRE", "GAZE", "MAYHEM"],
        note: "Lat/lon included when ADS-B has them. L2 ≠ Israel AER High-go.",
      },
      links,
      limit,
    };
  } catch (err) {
    return {
      id: 2,
      name: "Airborne Command Node (E-6B / AWACS)",
      short: "E-6B node",
      triggered: false,
      source: "unknown",
      read: "Lock 2 unknown — adsb.lol query failed.",
      evidence: { error: String(err) },
      links,
      limit,
    };
  }
}

/** Go-order / dispersal pulse — not bare "operation" (pollutes every IRGC news item). */
const IRGC_KW =
  /توزيع|قایق|خارگ|Kharg|dispers(e|al|ing)|fast\s*boat|speedboat|قایق های تندرو|swarm|IRGC.{0,40}(boat|naval|coast|dispers)|go[- ]?order|(?:combat|military)\s+operation.{0,40}(Hormuz|Kharg|Strait|Gulf)|(Hormuz|Kharg|Bandar\s*Abbas).{0,50}(dispers|fast\s*boat|speedboat|swarm|massing)/i;
/** IRGC pulse headlines/posts older than this are noise, not a live go-order. */
const IRGC_NEWS_WINDOW_HOURS = 72;
const IRGC_NEWS_MAX_AGE_MS = IRGC_NEWS_WINDOW_HOURS * 60 * 60 * 1000;

function isFreshIntelItem(pubDate: string, maxAgeMs: number): boolean {
  const d = parseRssPubDate(pubDate);
  if (!d) return false;
  const age = Date.now() - d.getTime();
  return age >= 0 && age <= maxAgeMs;
}

async function evalLock3Irgc(
  manual: IntelAlarmManualInputs,
): Promise<IntelLock> {
  const links = [
    { label: "t.me/SaberinFa", href: "https://t.me/SaberinFa" },
    { label: "t.me/TasnimNewsEN", href: "https://t.me/TasnimNewsEN" },
    { label: "t.me/FotrosResistancee", href: "https://t.me/FotrosResistancee" },
    { label: "t.me/irgc_news_english", href: "https://t.me/irgc_news_english" },
  ];
  const limit =
    "No GramJS/Telethon required for Lock 3 — IRONSIGHT public t.me/s dump + Google News RSS keyword density (Arabic/Persian + EN). Volume spike still approximate vs authenticated MTProto.";

  if (manual.irgcForce === true) {
    return {
      id: 3,
      name: "IRGC Telegram / Go-order pulse",
      short: "IRGC pulse",
      triggered: true,
      source: "manual",
      read: "Lock 3 FIRED — manual IRGC go-order / dispersal override.",
      evidence: { force: true },
      links,
      limit,
    };
  }
  if (manual.irgcForce === false) {
    return {
      id: 3,
      name: "IRGC Telegram / Go-order pulse",
      short: "IRGC pulse",
      triggered: false,
      source: "manual",
      read: "Lock 3 cleared — manual override false.",
      evidence: { force: false },
      links,
      limit,
    };
  }

  try {
    const queries = [
      "SaberinFa OR Tasnim (IRGC OR Kharg OR boat OR dispersal OR عملیات)",
      "IRGC (توزيع OR قایق OR خارگ OR Kharg OR \"fast boat\" OR dispersal OR swarm)",
      'IRGC (Kharg OR Hormuz) (dispersal OR "fast boats" OR swarm OR massing)',
    ];
    const batches = await Promise.all(
      queries.map((q) => fetchGoogleNewsRss(q, 6).catch(() => [] as NewsItem[])),
    );

    type Hit = { source: string; title: string; link: string; pubDate: string };
    const tgHits: Hit[] = [];
    const tgRejected: string[] = [];
    let tgCount = 0;
    let tgWithTs = 0;
    try {
      const base = IRONSIGHT_URL.replace(/\/$/, "");
      const res = await fetch(
        `${base}/api/telegram?conflict=${encodeURIComponent("iran-israel")}`,
        {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(12_000),
        },
      );
      if (res.ok) {
        const json = (await res.json()) as {
          posts?: Array<Record<string, unknown>>;
        };
        for (const p of json.posts ?? []) {
          tgCount += 1;
          const text = String(p.text ?? "");
          const channel = String(
            p.channelLabel ?? p.channel ?? p.username ?? "",
          );
          const pubDate =
            p.date != null
              ? String(p.date)
              : p.ts != null
                ? String(p.ts)
                : p.createdAt != null
                  ? String(p.createdAt)
                  : "";
          if (pubDate) tgWithTs += 1;
          // Require dispersal/boat/Kharg keywords — Saberin/Tasnim chatter alone ≠ go-order.
          if (!IRGC_KW.test(text)) {
            if (/Saberin|Tasnim|Fotros|irgc/i.test(channel)) {
              tgRejected.push(text.replace(/\s+/g, " ").slice(0, 100));
            }
            continue;
          }
          // Prefer IRGC-linked channels; still allow keyword hits from others.
          const channelOk = /Saberin|Tasnim|Fotros|irgc|DefaPress|OSINT/i.test(
            channel,
          );
          if (!channelOk && !/IRGC|Kharg|Hormuz|قایق|خارگ/i.test(text)) continue;
          if (pubDate && !isFreshIntelItem(pubDate, IRGC_NEWS_MAX_AGE_MS)) {
            tgRejected.push(`stale: ${text.replace(/\s+/g, " ").slice(0, 80)}`);
            continue;
          }
          tgHits.push({
            source: channel || "telegram",
            title: text.replace(/\s+/g, " ").slice(0, 180),
            link: String(p.url ?? ""),
            pubDate,
          });
        }
      }
    } catch {
      /* optional */
    }

    const newsRejected: string[] = [];
    const newsHits = batches
      .flat()
      .filter((i) => {
        if (!IRGC_KW.test(i.title)) return false;
        if (!isFreshIntelItem(i.pubDate, IRGC_NEWS_MAX_AGE_MS)) {
          newsRejected.push(i.title);
          return false;
        }
        return true;
      })
      .map((i) => ({
        source: "news",
        title: i.title,
        link: i.link,
        pubDate: i.pubDate,
      }));

    const keywordHits = [...tgHits, ...newsHits];
    const triggered = keywordHits.length >= 2 || tgHits.length >= 1;

    return {
      id: 3,
      name: "IRGC Telegram / Go-order pulse",
      short: "IRGC pulse",
      triggered,
      source: tgHits.length ? "mixed" : "auto",
      read: triggered
        ? `Lock 3 FIRED — ${keywordHits.length} keyword hit(s) (IRONSIGHT tg ${tgHits.length} · news ${newsHits.length}). Approx go-order / dispersal pulse — verify t.me/SaberinFa + TasnimNewsEN.`
        : `Lock 3 quiet — ${keywordHits.length} fresh ≤${IRGC_NEWS_WINDOW_HOURS}h dispersal/boat hit(s) (tg scanned ${tgCount}; rejected ${tgRejected.length + newsRejected.length} channel/stale/noise).`,
      evidence: {
        keywordHitCount: keywordHits.length,
        telegramHits: tgHits.slice(0, 8),
        newsHits: newsHits.slice(0, 8),
        rejectedNoise: [...tgRejected, ...newsRejected].slice(0, 8),
        windowHours: IRGC_NEWS_WINDOW_HOURS,
        telegramPostsScanned: tgCount,
        telegramWithTimestamps: tgWithTs,
        volumeSpikeAvailable: tgWithTs > 0,
      },
      links,
      limit,
    };
  } catch (err) {
    return {
      id: 3,
      name: "IRGC Telegram / Go-order pulse",
      short: "IRGC pulse",
      triggered: false,
      source: "unknown",
      read: "Lock 3 unknown — news/telegram fetch failed.",
      evidence: { error: String(err) },
      links,
      limit,
    };
  }
}

async function evalLock4Navwarn(
  manual: IntelAlarmManualInputs,
): Promise<IntelLock> {
  const links = [
    {
      label: "USCG NAVCEN",
      href: "https://www.navcen.uscg.gov/",
    },
    {
      label: "Google · NAVWARN Persian Gulf",
      href: `https://news.google.com/search?q=${encodeURIComponent('NAVWARN OR "maritime security advisory" OR "navigation restricted" ("Persian Gulf" OR Hormuz OR Kharg)')}&hl=en-US&gl=US&ceid=US:en`,
    },
  ];
  const limit =
    "No authenticated NAVCEN scrape. Google News / advisory RSS classifier for Northern Persian Gulf (26–30N, 48–56E) keywords + optional manual override.";

  if (manual.navwarnForce === true) {
    return {
      id: 4,
      name: "NAVWARN / Maritime exclusion",
      short: "NAVWARN",
      triggered: true,
      source: "manual",
      read: "Lock 4 FIRED — manual NAVWARN / exclusion override.",
      evidence: { force: true },
      links,
      limit,
    };
  }
  if (manual.navwarnForce === false) {
    return {
      id: 4,
      name: "NAVWARN / Maritime exclusion",
      short: "NAVWARN",
      triggered: false,
      source: "manual",
      read: "Lock 4 cleared — manual override false.",
      evidence: { force: false },
      links,
      limit,
    };
  }

  try {
    const queries = [
      'NAVWARN OR "navigation warning" OR "maritime security advisory" (Hormuz OR "Persian Gulf" OR Kharg OR Bahrain)',
      '("navigation restricted" OR "maritime exclusion" OR exclusion zone OR NAVAREA) (Hormuz OR "Persian Gulf" OR CENTCOM OR "Northern Gulf")',
      'NAVCEN OR "Coast Guard" (advisory OR NAVAREA) (Gulf OR Hormuz OR Arabia)',
      'UKMTO OR HYDROPAC OR HYDROLANT OR "NAVAREA IX" OR "NAVAREA 9" (Hormuz OR "Persian Gulf" OR Arabia OR Bahrain)',
      '("dangerous operations" OR "gunfire" OR "live fire" OR "missile exercise") (NAVWARN OR NAVAREA OR advisory) (Gulf OR Hormuz OR Kharg)',
      '"maritime security" OR "navigation restricted" OR "exclusion zone" (CENTCOM OR "Fifth Fleet" OR "Northern Gulf" OR Bandar)',
    ];
    const batches = await Promise.all(
      queries.map((q) => fetchGoogleNewsRss(q, 6).catch(() => [] as NewsItem[])),
    );
    const items = batches.flat();
    const classified = classifyNavwarnItems(items);
    const triggered = classified.lock4Triggered;

    return {
      id: 4,
      name: "NAVWARN / Maritime exclusion",
      short: "NAVWARN",
      triggered,
      source: "auto",
      read: triggered
        ? `Lock 4 FIRED — ${classified.hardHits.length} hard / ${classified.softHits.length} soft NAVWARN-ish headline(s) ≤${classified.windowHours}h for Northern Persian Gulf / Hormuz.`
        : `Lock 4 quiet — no fresh ≤${classified.windowHours}h NAVWARN / maritime exclusion in Gulf sample${classified.rejectedStale.length ? ` (${classified.rejectedStale.length} stale filtered)` : ""}.`,
      evidence: {
        hardHits: classified.hardHits.map((h) => h.title).slice(0, 8),
        softHits: classified.softHits.map((h) => h.title).slice(0, 8),
        rejectedStale: classified.rejectedStale.slice(0, 8),
        windowHours: classified.windowHours,
        ghostStatus: classified.ghostStatus,
        bbox: "26–30N, 48–56E (Northern Persian Gulf)",
      },
      links,
      limit,
    };
  } catch (err) {
    return {
      id: 4,
      name: "NAVWARN / Maritime exclusion",
      short: "NAVWARN",
      triggered: false,
      source: "unknown",
      read: "Lock 4 unknown — NAVWARN news fetch failed.",
      evidence: { error: String(err) },
      links,
      limit,
    };
  }
}

async function evalLock5Cape(
  manual: IntelAlarmManualInputs,
): Promise<IntelLock> {
  const links = [
    {
      label: "MarineTraffic · S of Yemen",
      href: "https://www.marinetraffic.com/en/ais/home/centerx:45.0/centery:12.5/zoom:7",
    },
    {
      label: "VesselFinder · Gulf of Aden",
      href: "https://www.vesselfinder.com/?latitude=12.5&longitude=45.0&zoom=7",
    },
  ];
  const limit =
    "No free bulk VLCC AIS count. Trigger: ≥3 diversion headline indicators OR strong Cape news spike + manual VLCC divert count ≥3.";

  if (manual.capeForce === true) {
    return {
      id: 5,
      name: "VLCC Cape diversion confirmation",
      short: "Cape VLCC",
      triggered: true,
      source: "manual",
      read: "Lock 5 FIRED — manual Cape diversion override.",
      evidence: { force: true, vlccDivertCount: manual.vlccDivertCount },
      links,
      limit,
    };
  }
  if (manual.capeForce === false) {
    return {
      id: 5,
      name: "VLCC Cape diversion confirmation",
      short: "Cape VLCC",
      triggered: false,
      source: "manual",
      read: "Lock 5 cleared — manual override false.",
      evidence: { force: false },
      links,
      limit,
    };
  }

  try {
    const query =
      'VLCC (Cape OR "Good Hope" OR divert OR diversion OR reroute) (Yemen OR "Bab el-Mandeb" OR Hormuz OR laden)';
    const items = await fetchGoogleNewsRss(query, 12);
    const diversionHints = items
      .filter((i) =>
        /Cape|Good Hope|divert|diversion|reroute|avoid(ing)?\s+(Red Sea|Hormuz|Bab)/i.test(
          i.title,
        ),
      )
      .map((i) => i.title);
    const manualCount = manual.vlccDivertCount;
    const newsStrong = diversionHints.length >= 3;
    const newsSpike = diversionHints.length >= 2;
    const manualStrong = manualCount != null && manualCount >= 3;
    const triggered =
      newsStrong || (newsSpike && manualStrong) || manualStrong;

    let source: IntelLock["source"] = "auto";
    if (manualCount != null && diversionHints.length) source = "mixed";
    else if (manualCount != null) source = "manual";

    return {
      id: 5,
      name: "VLCC Cape diversion confirmation",
      short: "Cape VLCC",
      triggered,
      source,
      read: triggered
        ? `Lock 5 FIRED — diversion hints ${diversionHints.length} · manual VLCC divert count ${manualCount ?? "—"} (need ≥3 hints OR count≥3 with spike).`
        : `Lock 5 quiet — diversion hints ${diversionHints.length} · manual count ${manualCount ?? "—"}. Enter VLCC divert count from AIS south of Yemen if news is thin.`,
      evidence: {
        diversionHints,
        diversionHintCount: diversionHints.length,
        vlccDivertCount: manualCount,
        items: items.slice(0, 8).map((i) => i.title),
      },
      links,
      limit,
    };
  } catch (err) {
    const manualCount = manual.vlccDivertCount;
    const triggered = manualCount != null && manualCount >= 3;
    return {
      id: 5,
      name: "VLCC Cape diversion confirmation",
      short: "Cape VLCC",
      triggered,
      source: manualCount != null ? "manual" : "unknown",
      read: triggered
        ? `Lock 5 FIRED — manual VLCC divert count ${manualCount} (news RSS failed).`
        : "Lock 5 unknown — Cape diversion RSS failed; enter manual VLCC count.",
      evidence: { error: String(err), vlccDivertCount: manualCount },
      links,
      limit,
    };
  }
}

function insertIntelHistoryEvent(state: IntelAlarmState): void {
  const database = getHistoryDb();
  if (!database) return;
  const ts = state.evaluatedAt;
  const day = ts.slice(0, 10);
  const severity =
    state.level === "red" ? "critical" : state.level === "yellow" ? "warn" : "info";
  if (severity === "info") return;
  const kind = "intel_alarm";
  const dedupeKey = `FRO|${kind}|${state.level}|${day}|${state.lockCount}`;
  const message = `5-Lock ${state.level.toUpperCase()} · ${state.lockCount}/5${
    state.redReason ? ` · ${state.redReason}` : ""
  }${state.bibiTrigger ? " · Bibi" : ""} — ${
    state.locks
      .filter((l) => l.triggered)
      .map((l) => l.short)
      .join(", ") || "none"
  }`;
  try {
    database
      .prepare(
        `INSERT INTO flow_events
          (ts, kind, symbol, expiry, strike, type, severity, message, metrics_json, dedupe_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ts,
        kind,
        "FRO",
        null,
        null,
        null,
        severity,
        message,
        JSON.stringify({
          level: state.level,
          lockCount: state.lockCount,
          threeLockStack: state.threeLockStack,
          bibiTrigger: state.bibiTrigger,
          shekelSpiked: state.shekelAlarm.spiked,
          shekel: {
            price: state.shekelAlarm.price,
            regime: state.shekelAlarm.regime,
            threshold: state.shekelAlarm.threshold,
          },
          redReason: state.redReason,
          locks: state.locks.map((l) => ({
            id: l.id,
            triggered: l.triggered,
            short: l.short,
          })),
          previousLevel: state.previousLevel,
        }),
        dedupeKey,
      );
  } catch {
    /* unique dedupe — ignore */
  }
}

async function pushTransition(state: IntelAlarmState): Promise<void> {
  if (!state.transitioned) return;
  const reasonTag = state.redReason
    ? ` · ${state.redReason}`
    : state.bibiTrigger
      ? " · bibi"
      : "";
  const title = `Tradehole 5-Lock → ${state.level.toUpperCase()} (${state.lockCount}/5${reasonTag})`;
  const body = [
    ...state.locks.map((l) => `${l.triggered ? "✓" : "·"} L${l.id} ${l.short}`),
    `${state.bibiTrigger ? "✓" : "·"} Bibi secondary`,
  ].join("\n");

  const discord = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (discord) {
    try {
      await fetch(discord, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: `**${title}**\n\`\`\`\n${body}\n\`\`\`\n${state.reads[0] ?? ""}`,
        }),
        signal: AbortSignal.timeout(8_000),
      });
    } catch (err) {
      console.warn("[tradehole] Discord intel-alarm push failed:", err);
    }
  }

  const token = process.env.PUSHOVER_TOKEN?.trim();
  const user = process.env.PUSHOVER_USER?.trim();
  if (token && user) {
    try {
      const form = new URLSearchParams({
        token,
        user,
        title,
        message: `${body}\n${state.reads[0] ?? ""}`,
        priority: state.level === "red" ? "1" : "0",
      });
      await fetch("https://api.pushover.net/1/messages.json", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        signal: AbortSignal.timeout(8_000),
      });
    } catch (err) {
      console.warn("[tradehole] Pushover intel-alarm push failed:", err);
    }
  }
}

export async function evaluateIntelAlarm(): Promise<IntelAlarmState> {
  const manual = { ...manualInputs };
  const [lock1, lock2, lock3, lock4, lock5, bibiEval] = await Promise.all([
    evalLock1Amphib(manual),
    evalLock2Airborne(),
    evalLock3Irgc(manual),
    evalLock4Navwarn(manual),
    evalLock5Cape(manual),
    evalBibiTrigger(),
  ]);
  const locks = [lock1, lock2, lock3, lock4, lock5];
  const lockCount = locks.filter((l) => l.triggered).length;
  const threeLockStack =
    lock1.triggered && lock2.triggered && lock3.triggered;
  const { bibiTrigger, bibi, shekelAlarm } = bibiEval;
  const { level, redReason } = resolveAlarmLevel({
    lockCount,
    threeLockStack,
    bibiTrigger,
  });
  const transitioned = previousLevel != null && previousLevel !== level;

  const topRead = (() => {
    if (level === "red") {
      if (redReason === "five_lock") {
        return "RED — full 5-lock stack. Treat as 12–24h Kharg/Hormuz assault window. Ignore headlines; mechanics only.";
      }
      if (redReason === "three_lock_stack") {
        return `RED — critical three-lock stack (L1 Bataan + L2 E-6B + L3 IRGC) with ${lockCount}/5. Unmistakable signature even without L4/L5.`;
      }
      return `RED — Bibi secondary + ${lockCount}/5 locks (need ≥2). Shekel / Natanz-Fordow path alongside footprint.`;
    }
    if (level === "yellow") {
      if (bibiTrigger && lockCount < 3) {
        return `YELLOW — Bibi secondary alone (${lockCount}/5 locks). Shekel spike or nuclear-site strike news — elevated spoiler risk.`;
      }
      return `YELLOW — ${lockCount}/5 locks${bibiTrigger ? " · Bibi secondary also armed" : ""}. Elevated footprint; not yet definitive go.`;
    }
    return `GREEN — ${lockCount}/5 locks. Posturing / incomplete stack.`;
  })();

  const reads = [topRead, shekelAlarm.read, bibi.read, ...locks.map((l) => l.read)];
  const limits = [
    ...new Set(locks.map((l) => l.limit)),
    SHEKEL_SPIKE_RULE,
    "Bibi secondary: Yahoo USD/ILS + Google News Natanz/Fordow RSS (≤48h pubDate, ≥2 same-day sources; recycled joint-strike reprints excluded) — not a live cabinet signal.",
    "Paid AIS APIs out of scope. No puppeteer / GramJS unless already in IRONSIGHT.",
  ];

  const state: IntelAlarmState = {
    locks,
    lockCount,
    level,
    threeLockStack,
    bibiTrigger,
    bibi,
    shekelAlarm,
    redReason,
    reads,
    evaluatedAt: new Date().toISOString(),
    manual,
    previousLevel,
    transitioned,
    limits,
    rule:
      "RED if L1+L2+L3 (critical three-lock) OR all 5 (full 5-lock) OR (Bibi secondary ∧ ≥2 locks). YELLOW if 3–4 without three-lock / Bibi+2, or Bibi alone. ≤2 without Bibi = green. Bibi = Shekel spike (USD/ILS ≥3.85 band ~3.9–4.0, or ≥3.6 +≥1.5% d/d) OR fresh corroborated Natanz/Fordow strike news (≤48h, ≥2 same-day; recycled reprints excluded).",
  };

  if (transitioned || previousLevel == null) {
    insertIntelHistoryEvent(state);
  }
  if (transitioned) {
    void pushTransition(state).catch(() => undefined);
  }

  previousLevel = level;
  latestState = state;
  return state;
}

export function startIntelAlarmPolling(intervalMs = INTEL_ALARM_POLL_MS): void {
  if (pollTimer) return;
  const tick = () => {
    if (evalInFlight) return;
    evalInFlight = true;
    void evaluateIntelAlarm()
      .then((s) => {
        console.log(
          `[tradehole] intel-alarm ${s.level} ${s.lockCount}/5${
            s.redReason ? ` ${s.redReason}` : ""
          }${s.bibiTrigger ? " bibi" : ""}${
            s.shekelAlarm.spiked ? " shekel-spike" : ""
          } @ ${s.evaluatedAt}`,
        );
      })
      .catch((err) => {
        console.warn("[tradehole] intel-alarm eval failed:", err);
      })
      .finally(() => {
        evalInFlight = false;
      });
  };
  tick();
  pollTimer = setInterval(tick, intervalMs);
}

export function stopIntelAlarmPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** Markdown section for Export ALL / 00_THEATER_5CHECK.md */
export function intelAlarmMarkdown(state: IntelAlarmState | null): string {
  const ruleDoc = [
    "Rules for receiving LLM:",
    "- **Critical three-lock stack**: Lock 1 (Bataan sprint) ∧ Lock 2 (E-6B) ∧ Lock 3 (IRGC pulse) → overall **RED**, even if Lock 4/5 are false.",
    "- **Full 5-lock**: all five locks true → **RED** (12–24h Kharg/Hormuz assault window).",
    "- **Bibi secondary**: Shekel USD/ILS spike (price ≥3.85 band ~3.9–4.0, **OR** price ≥3.6 with d/d ≥+1.5%) **OR** fresh corroborated Israel strike news on Natanz/Fordow/nuclear site (parseable pubDate ≤48h, ≥2 distinct same-UTC-day sources; recycled \"joint strike on Natanz\" war-wave reprints hard-excluded).",
    "  - Bibi alone → at least **YELLOW** (even if lockCount < 3).",
    "  - Bibi ∧ any **two** of the five locks → **RED** (`bibi_plus_locks`).",
    "- Else 3–4 locks without three-lock → **YELLOW**; ≤2 without Bibi → green/posturing.",
    "- Prefer mechanics over Polymarket/oil fluff; Bibi FX/nuclear-news path is the intentional headline exception (nuclear leg is freshness-gated).",
  ].join("\n");

  if (!state) {
    return [
      "## § Ultimate 5-Lock Intel Alarm",
      "(not evaluated yet — server poll may still be starting)",
      "",
      ruleDoc,
    ].join("\n");
  }

  const redLabel =
    state.redReason === "five_lock"
      ? "full 5-lock"
      : state.redReason === "three_lock_stack"
        ? "critical three-lock stack"
        : state.redReason === "bibi_plus_locks"
          ? "Bibi + ≥2 locks"
          : "—";

  const rows = state.locks.map(
    (l) =>
      `| ${l.id} | ${l.short} | **${l.triggered ? "TRUE" : "false"}** | ${l.source} | ${l.read} |`,
  );
  return [
    "## § Ultimate 5-Lock Intel Alarm",
    state.rule,
    "",
    ruleDoc,
    "",
    `**Level: ${state.level.toUpperCase()} · ${state.lockCount}/5 · three-lock=${state.threeLockStack} · Bibi=${state.bibiTrigger} · redReason=${state.redReason ?? "null"} (${redLabel}) · evaluated ${state.evaluatedAt}**`,
    "",
    "| # | Lock | Triggered | Source | Read |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "### Bibi secondary path",
    state.bibi.read,
    `USD/ILS ${state.bibi.shekel.symbol}=${state.bibi.shekel.price?.toFixed(4) ?? "—"} · d/d ${state.bibi.shekel.changePct?.toFixed(2) ?? "—"}% · threshold~${state.bibi.shekel.threshold.toFixed(2)} · floor~${state.bibi.shekel.spikeFloor.toFixed(1)} · hard≥${state.bibi.shekel.spikeHard} · regime=**${state.bibi.shekel.regime}** · spiked=${state.bibi.shekel.spiked}`,
    state.bibi.shekel.rule,
    state.shekelAlarm.read,
    `Nuclear-site strike news hit=${state.bibi.nuclearStrikeNews.hit} · corroboration=${state.bibi.nuclearStrikeNews.corroboration} · window≤${state.bibi.nuclearStrikeNews.windowHours}h`,
    ...(state.bibi.nuclearStrikeNews.titles.length
      ? state.bibi.nuclearStrikeNews.titles.map((t) => `- fresh: ${t}`)
      : ["- (no fresh Natanz/Fordow strike headlines in ≤48h sample)"]),
    ...(state.bibi.nuclearStrikeNews.rejectedStale.length
      ? [
          "Filtered stale/recycled/undated/non-event (do **not** treat as live kinetic):",
          ...state.bibi.nuclearStrikeNews.rejectedStale.map(
            (t) => `- filtered: ${t}`,
          ),
        ]
      : []),
    "",
    "### Manual inputs (server)",
    `Bataan SOG=${state.manual.bataanSog ?? "—"} · course=${state.manual.bataanCourse ?? "—"} · lat=${state.manual.bataanLat ?? "—"} · lon=${state.manual.bataanLon ?? "—"} · force=${state.manual.bataanLockForce ?? "—"}`,
    `VLCC divert count=${state.manual.vlccDivertCount ?? "—"} · NAVWARN force=${state.manual.navwarnForce ?? "—"} · IRGC force=${state.manual.irgcForce ?? "—"} · Cape force=${state.manual.capeForce ?? "—"}`,
    state.manual.note ? `Note: ${state.manual.note}` : "",
    "",
    "### Honest limits",
    ...state.limits.map((x) => `- ${x}`),
    "",
    "### Per-lock evidence (compact)",
    ...state.locks.map(
      (l) =>
        `- L${l.id} ${l.short}: ${JSON.stringify(l.evidence).slice(0, 400)}`,
    ),
  ]
    .filter((l) => l !== "")
    .join("\n");
}
