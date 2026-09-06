/**
 * One-click FRO/Hormuz OSINT pack — 7 buckets for paste into another LLM.
 * Aggregates theaterWatch + IRONSIGHT + physical/energy + intel alarm.
 * Honest about gaps (no live AIS scrape, lagged TD3C/EIA).
 * Telegram: two-pass IRONSIGHT public t.me/s dump (deep Hormuz + broad ME) — not GramJS forever-history.
 */

import { getEnergyQuotes, getStockQuote } from "./market";
import { getPhysicalMarkets } from "./physical";
import { fetchBdtiSeries } from "./analytics/bdti";
import { freightMaxMarkdown } from "./freightPack";
import { fetchChokepointTransits } from "./analytics/chokepointTransits";
import { fetchShippingIndustry } from "./analytics/shippingIndustry";
import { buildTheaterWatch, type TheaterWatch } from "./theaterWatch";
import {
  evaluateIntelAlarm,
  getLatestIntelAlarm,
  setIntelAlarmManual,
  type IntelAlarmState,
} from "./intelAlarm";
import { getLatestDealAlarm, evaluateDealAlarm } from "./dealAlarm";
import {
  buildDecisionFootprint,
  decisionFootprintMarkdown,
  type DecisionFootprint,
} from "./analytics/decisionFootprint";
import {
  buildMarketSurprise,
  marketSurpriseMarkdown,
  type MarketSurprise,
} from "./analytics/marketSurprise";
import {
  TELEGRAM_BROAD_DUMP_QUERY,
  TELEGRAM_BROAD_TIMEOUT_MS,
  TELEGRAM_DEEP_DUMP_QUERY,
  TELEGRAM_DEEP_TIMEOUT_MS,
  TELEGRAM_RU_LIGHT_DUMP_QUERY,
  TELEGRAM_RU_TIMEOUT_MS,
  manualSubscribeLine,
} from "./hormuzTelegramChannels";
import {
  computePackScore,
  packScoreMarkdown,
  type PackScore,
} from "./packScore";
import {
  buildEvidenceIndex,
  buildNarrativeMatrix,
  narrativeMatrixMarkdown,
  type EvidenceItem,
  type NarrativeMatrix,
} from "./packEvidence";
import { getHistoryStatus } from "./history/db";
import { recordIntelDailySnapshot } from "./intelDailySnapshot";
import {
  buildAiPackV3,
  PACK_SCHEMA_VERSION,
  type AiPackV3,
} from "./aiBrief";

/** @deprecated use TELEGRAM_BROAD_DUMP_QUERY — kept for callers */
export const TELEGRAM_DUMP_QUERY = TELEGRAM_BROAD_DUMP_QUERY;
export const TELEGRAM_DUMP_TIMEOUT_MS = TELEGRAM_BROAD_TIMEOUT_MS;
const IRONSIGHT_URL = process.env.IRONSIGHT_URL ?? "http://localhost:3170";

/** Manual Theater-watch / 5-Lock fields from the UI (same shape as Export ALL). */
export type OsintPackOpts = {
  aisStatus?: string | null;
  aisNote?: string | null;
  bataanStatus?: string | null;
  bataanNote?: string | null;
  boxerStatus?: string | null;
  boxerNote?: string | null;
  newYorkStatus?: string | null;
  newYorkNote?: string | null;
  amphibStatus?: string | null;
  amphibNote?: string | null;
  irgcStatus?: string | null;
  irgcNote?: string | null;
  capeStatus?: string | null;
  capeNote?: string | null;
  romeStatus?: string | null;
  romeNote?: string | null;
  bataanSog?: string | number | null;
  bataanCourse?: string | number | null;
  bataanLat?: string | number | null;
  bataanLon?: string | number | null;
  boxerSog?: string | number | null;
  boxerCourse?: string | number | null;
  boxerLat?: string | number | null;
  boxerLon?: string | number | null;
  newYorkSog?: string | number | null;
  newYorkCourse?: string | number | null;
  newYorkLat?: string | number | null;
  newYorkLon?: string | number | null;
  vlccDivertCount?: string | number | null;
  navwarnForce?: string | boolean | null;
  irgcForce?: string | boolean | null;
  capeForce?: string | boolean | null;
  intelAlarmNote?: string | null;
};

const FOCUS_EXPIRY = "2026-09-18";
const FOCUS_STRIKE = 46;

/** Strait of Hormuz / Northern Gulf thermal box */
const HORMUZ_BOX = { latMin: 24.5, latMax: 28.5, lonMin: 54.5, lonMax: 58.5 };
/** Bab el-Mandeb / Southern Red Sea approach */
const BAB_BOX = { latMin: 11.0, latMax: 14.5, lonMin: 41.5, lonMax: 45.5 };

const HOSTILE_RE =
  /\b(attack|attacked|missile|drone|UAV|boarded|seized|hijack|explod|strike|struck|hit|sank|sinking|intercept|IRGC|Houthi|mine|ASM|anti-ship)\b/i;
const VESSEL_RE =
  /\b(VLCC|tanker|MT\s+\w+|Front\s+\w+|Bataan|Boxer|New York|Kharg|Hormuz|Bab\s*el[- ]?Mandeb)\b/i;
const POLITICAL_SAUDI_HOUTHI_RE =
  /\b(Saudi|Houthi|Ansar\s*Allah|Riyadh|Red\s+Sea|Bab\s*el[- ]?Mandeb|ceasefire\s+talks?)\b/i;

const TG_RELEVANT_RE =
  /\b(Hormuz|Kharg|IRGC|tanker|VLCC|Bataan|Cape|Houthi|missile|drone|Strait|Oman|fee|deal|Iran|Israel|CENTCOM|NAVWARN|war\s*risk|al-?Shabaab|Puntland|Bosaso|Kismayo|Hobyo|Somali)\b/i;

export type TelegramDumpMeta = {
  mode?: string;
  postCount?: number;
  channelCount?: number;
  days?: number;
  limit?: number;
  capability?: string;
  channelStats?: Array<{
    channel: string;
    label: string;
    postCount: number;
    pages?: number;
    error?: string;
  }>;
};

export type OsintNewsHeadline = {
  source: string;
  title: string;
  link: string;
  pubDate: string;
  excerpt: string;
};

export type OsintTelegramPost = {
  channel: string;
  time: string;
  text: string;
  link: string;
  relevant: boolean;
};

/** Compact inputs for size-capped DeepSeek paste (not the full 7-bucket dump). */
export type OsintPasteInputs = {
  news: OsintNewsHeadline[];
  telegram: OsintTelegramPost[];
  ships: Array<{
    name: string;
    hull: string;
    lat: number;
    lon: number;
    status: string;
    region: string;
  }>;
  td3cLine: string | null;
  /** Compact desk posture for DeepSeek paste (titles demoted). */
  desk?: {
    lockLevel: string | null;
    lockCount: number | null;
    ghostScore: number | null;
    ghostMax: number | null;
    ghostRegime: string | null;
    dfBand: string | null;
    dfScore: number | null;
  };
  /** Somali-basin Cape-route freight watch — never High-go. */
  eastAfrica?: {
    regime: string;
    read: string;
    lit: string[];
    evidence: string[];
  } | null;
};

export type OsintPackResult = {
  symbol: string;
  generatedAt: string;
  markdown: string;
  byteLength: number;
  sources: Record<string, "ok" | "error" | "partial">;
  /** Combined telegram dump payload (deep + broad + optional RU) for ZIP. */
  telegramDump?: unknown;
  telegramDumpMeta?: TelegramDumpMeta;
  telegramDeepDump?: unknown;
  telegramBroadDump?: unknown;
  telegramRuDump?: unknown;
  flights?: unknown;
  alerts?: unknown;
  strikes?: unknown;
  regionalAlerts?: unknown;
  polymarketIs?: unknown;
  chokepointTransits?: unknown;
  shippingIndustry?: unknown;
  packScore?: PackScore;
  evidenceIndex?: EvidenceItem[];
  narrativeMatrix?: NarrativeMatrix;
  aiPack?: AiPackV3;
  packSchemaVersion?: string;
  /** Structured slices for DeepSeek size-capped paste. */
  pasteInputs?: OsintPasteInputs;
};

type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

async function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await p };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function fetchIronsightJson(
  path: string,
  timeoutMs = 12_000,
): Promise<unknown> {
  const base = IRONSIGHT_URL.replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`IRONSIGHT ${path} HTTP ${res.status}`);
  return res.json();
}

function inBox(
  lat: number,
  lon: number,
  box: { latMin: number; latMax: number; lonMin: number; lonMax: number },
): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= box.latMin &&
    lat <= box.latMax &&
    lon >= box.lonMin &&
    lon <= box.lonMax
  );
}

function fmtUsd(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(digits)}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function hullManual(
  opts: OsintPackOpts | undefined,
  key: "bataan" | "boxer" | "newYork",
): { status: string; note: string } {
  if (key === "bataan") {
    return {
      status:
        opts?.bataanStatus?.trim() ||
        opts?.amphibStatus?.trim() ||
        "unknown",
      note:
        opts?.bataanNote?.trim() ||
        opts?.amphibNote?.trim() ||
        "(no manual note)",
    };
  }
  if (key === "boxer") {
    return {
      status: opts?.boxerStatus?.trim() || "unknown",
      note: opts?.boxerNote?.trim() || "(no manual note)",
    };
  }
  return {
    status: opts?.newYorkStatus?.trim() || "unknown",
    note: opts?.newYorkNote?.trim() || "(no manual note)",
  };
}

type TgPost = {
  channel: string;
  time: string;
  text: string;
  link: string;
  relevant: boolean;
};

function parseTelegram(raw: unknown): TgPost[] {
  const posts = Array.isArray((raw as { posts?: unknown })?.posts)
    ? ((raw as { posts: unknown[] }).posts as Record<string, unknown>[])
    : [];
  return posts.map((p) => {
    const text = String(p.text ?? p.body ?? p.rssBody ?? p.title ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const channel = String(
      p.channelLabel ?? p.channel ?? p.username ?? p.source ?? "telegram",
    );
    const time =
      p.date != null
        ? String(p.date)
        : p.pubDate != null
          ? String(p.pubDate)
          : p.ts != null
            ? String(p.ts)
            : p.createdAt != null
              ? String(p.createdAt)
              : "(no timestamp)";
    const link = String(p.url ?? p.link ?? "").trim();
    return {
      channel,
      time,
      text: text.slice(0, 900),
      link,
      relevant: TG_RELEVANT_RE.test(`${channel} ${text}`),
    };
  });
}

function tgLinkKey(link: string, text: string): string {
  const norm = link
    .toLowerCase()
    .replace(/\/$/, "")
    .replace(/t\.me\/middle_east_spectator\//, "t.me/middle_east_spectator/");
  if (norm.includes("t.me/")) return norm;
  return `${norm}|${text.slice(0, 80).toLowerCase()}`;
}

function telegramDumpMeta(raw: unknown): TelegramDumpMeta {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  return {
    mode: r.mode != null ? String(r.mode) : undefined,
    postCount:
      typeof r.postCount === "number"
        ? r.postCount
        : Array.isArray(r.posts)
          ? r.posts.length
          : undefined,
    channelCount: typeof r.channelCount === "number" ? r.channelCount : undefined,
    days: typeof r.days === "number" ? r.days : undefined,
    limit: typeof r.limit === "number" ? r.limit : undefined,
    capability: r.capability != null ? String(r.capability) : undefined,
    channelStats: Array.isArray(r.channelStats)
      ? (r.channelStats as TelegramDumpMeta["channelStats"])
      : undefined,
  };
}

type FireHit = {
  lat: number;
  lon: number;
  bright?: number | null;
  frp?: number | null;
  acqDate?: string | null;
  satellite?: string | null;
  box: "hormuz" | "bab" | "other";
};

function parseFires(raw: unknown): {
  total: number;
  hormuz: FireHit[];
  bab: FireHit[];
  error?: string;
} {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { fires?: unknown })?.fires)
      ? ((raw as { fires: unknown[] }).fires as unknown[])
      : Array.isArray((raw as { detections?: unknown })?.detections)
        ? ((raw as { detections: unknown[] }).detections as unknown[])
        : [];

  const hormuz: FireHit[] = [];
  const bab: FireHit[] = [];
  let other = 0;

  for (const item of list) {
    const row = item as Record<string, unknown>;
    const lat = Number(row.lat ?? row.latitude ?? row.Latitude);
    const lon = Number(row.lon ?? row.longitude ?? row.Longitude ?? row.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const hit: FireHit = {
      lat,
      lon,
      bright:
        typeof row.brightness === "number"
          ? row.brightness
          : typeof row.bright_ti4 === "number"
            ? row.bright_ti4
            : null,
      frp: typeof row.frp === "number" ? row.frp : null,
      acqDate:
        row.acq_date != null
          ? String(row.acq_date)
          : row.acqDate != null
            ? String(row.acqDate)
            : row.date != null
              ? String(row.date)
              : null,
      satellite:
        row.satellite != null
          ? String(row.satellite)
          : row.instrument != null
            ? String(row.instrument)
            : null,
      box: "other",
    };
    if (inBox(lat, lon, HORMUZ_BOX)) {
      hit.box = "hormuz";
      hormuz.push(hit);
    } else if (inBox(lat, lon, BAB_BOX)) {
      hit.box = "bab";
      bab.push(hit);
    } else {
      other += 1;
    }
  }

  return { total: list.length, hormuz, bab };
}

type ShipStamp = {
  name: string;
  hull: string;
  lat: number;
  lon: number;
  status: string;
  region: string;
};

function parseShips(raw: unknown): ShipStamp[] {
  const ships = Array.isArray((raw as { ships?: unknown })?.ships)
    ? ((raw as { ships: unknown[] }).ships as Record<string, unknown>[])
    : [];
  return ships.slice(0, 40).map((s) => ({
    name: String(s.name ?? ""),
    hull: String(s.hull ?? ""),
    lat: Number(s.lat) || 0,
    lon: Number(s.lon) || 0,
    status: String(s.status ?? ""),
    region: String(s.region ?? ""),
  }));
}

type HostileItem = {
  source: string;
  title: string;
  link: string;
  when: string;
};

/** Hostile log is for live kinetic/spoiler context — drop ancient channel dumps. */
const HOSTILE_MAX_AGE_MS = 14 * 24 * 3600_000;

function hostileWhenMs(when: string): number | null {
  if (!when || when.startsWith("(")) return null;
  const ms = Date.parse(when);
  return Number.isFinite(ms) ? ms : null;
}

function collectHostile(
  tg: TgPost[],
  newsItems: Array<{ source: string; title: string; link: string; pubDate: string }>,
  diversionHints: string[],
  warRiskTitles: string[],
): HostileItem[] {
  const out: HostileItem[] = [];
  const seen = new Set<string>();
  const cutoff = Date.now() - HOSTILE_MAX_AGE_MS;

  const push = (item: HostileItem) => {
    const whenMs = hostileWhenMs(item.when);
    if (whenMs != null && whenMs < cutoff) return;
    const key = item.title.slice(0, 80).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };

  for (const p of tg) {
    if (!HOSTILE_RE.test(p.text) && !VESSEL_RE.test(p.text)) continue;
    if (!HOSTILE_RE.test(p.text)) continue;
    push({
      source: `telegram:${p.channel}`,
      title: p.text,
      link: p.link,
      when: p.time,
    });
  }

  for (const n of newsItems) {
    if (!HOSTILE_RE.test(n.title)) continue;
    push({
      source: n.source,
      title: n.title,
      link: n.link,
      when: n.pubDate || "(unknown)",
    });
  }

  for (const t of diversionHints) {
    if (!HOSTILE_RE.test(t) && !/divert|Cape|attack/i.test(t)) continue;
    push({
      source: "vlccCape/news",
      title: t,
      link: "",
      when: "(from theaterWatch)",
    });
  }

  for (const t of warRiskTitles) {
    if (!HOSTILE_RE.test(t)) continue;
    push({
      source: "warRiskInsurance",
      title: t,
      link: "",
      when: "(from theaterWatch)",
    });
  }

  return out.slice(0, 20);
}

function syncIntelManual(opts: OsintPackOpts): void {
  if (
    opts.bataanSog == null &&
    opts.bataanCourse == null &&
    opts.bataanLat == null &&
    opts.bataanLon == null &&
    opts.boxerLat == null &&
    opts.boxerLon == null &&
    opts.newYorkLat == null &&
    opts.newYorkLon == null &&
    opts.vlccDivertCount == null &&
    opts.navwarnForce == null &&
    opts.irgcForce == null &&
    opts.capeForce == null &&
    opts.intelAlarmNote == null
  ) {
    return;
  }
  setIntelAlarmManual({
    bataanSog: opts.bataanSog as number | null,
    bataanCourse: opts.bataanCourse as number | null,
    bataanLat: opts.bataanLat as number | null,
    bataanLon: opts.bataanLon as number | null,
    boxerSog: opts.boxerSog as number | null,
    boxerCourse: opts.boxerCourse as number | null,
    boxerLat: opts.boxerLat as number | null,
    boxerLon: opts.boxerLon as number | null,
    newYorkSog: opts.newYorkSog as number | null,
    newYorkCourse: opts.newYorkCourse as number | null,
    newYorkLat: opts.newYorkLat as number | null,
    newYorkLon: opts.newYorkLon as number | null,
    vlccDivertCount: opts.vlccDivertCount as number | null,
    navwarnForce: opts.navwarnForce as boolean | null,
    irgcForce: opts.irgcForce as boolean | null,
    capeForce: opts.capeForce as boolean | null,
    note: opts.intelAlarmNote ?? null,
  });
}

function buildExecutiveBullets(ctx: {
  watch: TheaterWatch | null;
  alarm: IntelAlarmState | null;
  footprint: DecisionFootprint | null;
  surprise: MarketSurprise | null;
  froPrice: number | null;
  froChangePct: number | null;
  focusBid: number | null;
  focusAsk: number | null;
  aisStatus: string;
  capeStatus: string;
  firesHormuz: number;
  firesBab: number;
  hostileCount: number;
  tgRelevant: number;
  gaps: string[];
}): string[] {
  const bullets: string[] = [];
  const w = ctx.watch;

  if (ctx.footprint) {
    bullets.push(
      `Decision Footprint: **${ctx.footprint.score}/100** · ${ctx.footprint.statusLabel}${ctx.footprint.decisionMade ? " · decisionMade" : ""} — ${ctx.footprint.verdict.slice(0, 180)}`,
    );
  }

  if (ctx.surprise?.theses.length) {
    const top = [...ctx.surprise.theses]
      .filter((t) => t.edgePp != null)
      .sort((a, b) => Math.abs(b.edgePp!) - Math.abs(a.edgePp!))[0];
    if (top) {
      bullets.push(
        `Market Surprise · **${top.label}**: Reality ${top.realityPct ?? "—"}% vs Market ${top.marketPct ?? "—"}% · edge ${top.edgePp! >= 0 ? "+" : ""}${top.edgePp}pp (${top.confidence}) — ${top.verdict.slice(0, 120)}`,
      );
    }
  }

  if (ctx.alarm) {
    bullets.push(
      `5-Lock intel alarm: **${ctx.alarm.level.toUpperCase()}** (${ctx.alarm.lockCount}/5 · three-lock=${ctx.alarm.threeLockStack} · Bibi=${ctx.alarm.bibiTrigger}${ctx.alarm.redReason ? ` · ${ctx.alarm.redReason}` : ""}).`,
    );
  }

  bullets.push(
    `FRO spot ${fmtUsd(ctx.froPrice)} (${fmtPct(ctx.froChangePct)}) · Sep $${FOCUS_STRIKE}c bid/ask ${fmtUsd(ctx.focusBid)}/${fmtUsd(ctx.focusAsk)}.`,
  );

  if (w) {
    bullets.push(
      `State media: **${w.stateMedia.regime}** · Polymarket ceasefire ${w.polymarket.ceasefire?.yesPct ?? "—"}% · Hormuz ${w.polymarket.hormuz?.yesPct ?? "—"}% · Shekel ${w.bibiSpoiler.shekel.price?.toFixed(4) ?? "—"} (${w.bibiSpoiler.shekel.regime}) · BDTI ${w.bdti.latest?.value ?? "—"} (${fmtPct(w.bdti.changePct1d)} d/d).`,
    );
    bullets.push(
      `AIS (Layer-3 gap / manual): **${ctx.aisStatus}** · Cape VLCC auto=${w.khargPickaxe.vlccCape.regime} / manual=${ctx.capeStatus}.`,
    );
  }

  bullets.push(
    `FIRMS near Hormuz ${ctx.firesHormuz} / Bab ${ctx.firesBab} · Telegram relevant ${ctx.tgRelevant} · Hostile-keyword hits ${ctx.hostileCount}${ctx.gaps.length ? ` · ${ctx.gaps.length} gap(s)` : ""}.`,
  );

  return bullets.slice(0, 7);
}

function froOneLiner(ctx: {
  froPrice: number | null;
  froChangePct: number | null;
  focusBid: number | null;
  focusAsk: number | null;
  focusVol: number | null;
  focusOi: number | null;
  wti: number | null;
  brent: number | null;
  bdti: number | null;
  aisStatus: string;
  alarmLevel: string | null;
  generatedAt: string;
}): string {
  return [
    `FRO ${fmtUsd(ctx.froPrice)} (${fmtPct(ctx.froChangePct)})`,
    `Sep$${FOCUS_STRIKE}c ${fmtUsd(ctx.focusBid)}/${fmtUsd(ctx.focusAsk)} vol=${ctx.focusVol ?? "—"} OI=${ctx.focusOi ?? "—"}`,
    `WTI ${fmtUsd(ctx.wti)} · Brent ${fmtUsd(ctx.brent)} · BDTI ${ctx.bdti ?? "—"}`,
    `AIS=${ctx.aisStatus}`,
    ctx.alarmLevel ? `alarm=${ctx.alarmLevel}` : null,
    ctx.generatedAt,
  ]
    .filter(Boolean)
    .join(" · ");
}

export async function buildOsintPack(
  symbolRaw = "FRO",
  opts: OsintPackOpts = {},
): Promise<OsintPackResult> {
  const symbol = symbolRaw.toUpperCase();
  const generatedAt = new Date().toISOString();
  syncIntelManual(opts);

  const [
    theaterS,
    quoteS,
    energyS,
    physicalS,
    bdtiS,
    tgDeepS,
    tgBroadS,
    tgRuS,
    firesS,
    shipsS,
    newsS,
    flightsS,
    alertsS,
    strikesS,
    regionalS,
    polymarketS,
    chokeS,
    shipS,
  ] = await Promise.all([
    settle(buildTheaterWatch()),
    settle(getStockQuote(symbol)),
    settle(getEnergyQuotes()),
    settle(getPhysicalMarkets()),
    settle(fetchBdtiSeries()),
    settle(
      fetchIronsightJson(
        `/api/telegram?${TELEGRAM_DEEP_DUMP_QUERY}`,
        TELEGRAM_DEEP_TIMEOUT_MS,
      ),
    ),
    settle(
      fetchIronsightJson(
        `/api/telegram?${TELEGRAM_BROAD_DUMP_QUERY}`,
        TELEGRAM_BROAD_TIMEOUT_MS,
      ),
    ),
    settle(
      fetchIronsightJson(
        `/api/telegram?${TELEGRAM_RU_LIGHT_DUMP_QUERY}`,
        TELEGRAM_RU_TIMEOUT_MS,
      ),
    ),
    settle(
      fetchIronsightJson(
        `/api/fires?conflict=${encodeURIComponent("iran-israel")}`,
      ),
    ),
    settle(
      fetchIronsightJson(
        `/api/ships?conflict=${encodeURIComponent("iran-israel")}`,
      ),
    ),
    settle(
      fetchIronsightJson(
        `/api/news?conflict=${encodeURIComponent("iran-israel")}`,
      ),
    ),
    settle(
      fetchIronsightJson(
        `/api/flights?conflict=${encodeURIComponent("iran-israel")}`,
        20_000,
      ),
    ),
    settle(
      fetchIronsightJson(
        `/api/alerts?conflict=${encodeURIComponent("iran-israel")}`,
        15_000,
      ),
    ),
    settle(
      fetchIronsightJson(
        `/api/strikes?conflict=${encodeURIComponent("iran-israel")}`,
        20_000,
      ),
    ),
    settle(
      fetchIronsightJson(
        `/api/regional-alerts?conflict=${encodeURIComponent("iran-israel")}`,
        25_000,
      ),
    ),
    settle(
      fetchIronsightJson(
        `/api/polymarket?conflict=${encodeURIComponent("iran-israel")}`,
        15_000,
      ),
    ),
    settle(fetchChokepointTransits()),
    settle(fetchShippingIndustry()),
  ]);

  let alarm: IntelAlarmState | null = getLatestIntelAlarm();
  try {
    alarm = await evaluateIntelAlarm();
  } catch (err) {
    console.warn("[tradehole] osint-pack intel-alarm failed:", err);
  }

  let deal = getLatestDealAlarm();
  try {
    if (!deal) deal = await evaluateDealAlarm();
  } catch {
    /* optional */
  }

  let footprint: DecisionFootprint | null = null;
  try {
    footprint = await buildDecisionFootprint({
      theater: theaterS.ok ? theaterS.value : null,
      deal,
      intel: alarm,
    });
  } catch (err) {
    console.warn("[tradehole] osint-pack decision-footprint failed:", err);
  }

  let surprise: MarketSurprise | null = null;
  try {
    surprise = await buildMarketSurprise({
      theater: theaterS.ok ? theaterS.value : null,
      deal,
      intel: alarm,
      footprint,
    });
  } catch (err) {
    console.warn("[tradehole] osint-pack market-surprise failed:", err);
  }

  const deepPosts = tgDeepS.ok ? parseTelegram(tgDeepS.value) : [];
  const broadPosts = tgBroadS.ok ? parseTelegram(tgBroadS.value) : [];
  const ruPosts = tgRuS.ok ? parseTelegram(tgRuS.value) : [];
  const deepMeta = tgDeepS.ok ? telegramDumpMeta(tgDeepS.value) : {};
  const broadMeta = tgBroadS.ok ? telegramDumpMeta(tgBroadS.value) : {};
  const ruMeta = tgRuS.ok ? telegramDumpMeta(tgRuS.value) : {};

  /** Prefer deep+broad merge for pack text; dedupe by normalized link|text. */
  const seenTg = new Set<string>();
  const allTg: TgPost[] = [];
  for (const p of [...deepPosts, ...broadPosts, ...ruPosts]) {
    const key = tgLinkKey(p.link, p.text);
    if (seenTg.has(key)) continue;
    seenTg.add(key);
    allTg.push(p);
  }

  /** DeepSeek paste prefers ME dumps only — RU light stays in ZIP dump files. */
  const meTgOnly: TgPost[] = [];
  const seenMe = new Set<string>();
  for (const p of [...deepPosts, ...broadPosts]) {
    const key = tgLinkKey(p.link, p.text);
    if (seenMe.has(key)) continue;
    seenMe.add(key);
    meTgOnly.push(p);
  }

  const tgIsDump =
    (tgDeepS.ok &&
      (deepMeta.mode === "dump" ||
        deepPosts.length > 20 ||
        (deepMeta.postCount ?? 0) > 20)) ||
    (tgBroadS.ok &&
      (broadMeta.mode === "dump" ||
        broadPosts.length > 50 ||
        (broadMeta.postCount ?? 0) > 50));

  const tgMeta: TelegramDumpMeta = {
    mode: tgIsDump ? "dump" : broadMeta.mode ?? deepMeta.mode ?? "sample",
    postCount: allTg.length,
    channelCount:
      (deepMeta.channelCount ?? 0) +
      (broadMeta.channelCount ?? 0) +
      (ruMeta.channelCount ?? 0) || undefined,
    days: Math.max(deepMeta.days ?? 0, broadMeta.days ?? 0, 7) || 7,
    limit: Math.max(deepMeta.limit ?? 0, broadMeta.limit ?? 0, 100) || 100,
    capability: [
      tgDeepS.ok
        ? `deep Hormuz ${deepMeta.postCount ?? deepPosts.length} posts / ${deepMeta.days ?? 30}d`
        : `deep failed: ${tgDeepS.error}`,
      tgBroadS.ok
        ? `broad ME ${broadMeta.postCount ?? broadPosts.length} posts / ${broadMeta.days ?? 7}d`
        : `broad failed: ${tgBroadS.error}`,
      tgRuS.ok
        ? `RU light ${ruMeta.postCount ?? ruPosts.length} posts`
        : `RU light skipped/failed: ${tgRuS.error}`,
    ].join(" · "),
    channelStats: [
      ...(deepMeta.channelStats ?? []),
      ...(broadMeta.channelStats ?? []),
      ...(ruMeta.channelStats ?? []),
    ],
  };

  const combinedTelegramDump = {
    mode: tgMeta.mode,
    capability: tgMeta.capability,
    postCount: allTg.length,
    deep: tgDeepS.ok
      ? tgDeepS.value
      : { error: tgDeepS.error, partial: true },
    broad: tgBroadS.ok
      ? tgBroadS.value
      : { error: tgBroadS.error, partial: true },
    russiaUkraineLight: tgRuS.ok
      ? tgRuS.value
      : { error: tgRuS.error, partial: true },
    posts: allTg.map((p) => ({
      channel: p.channel,
      date: p.time,
      text: p.text,
      url: p.link,
    })),
  };

  const sources: Record<string, "ok" | "error" | "partial"> = {
    theaterWatch: theaterS.ok ? "ok" : "error",
    quote: quoteS.ok ? "ok" : "error",
    energy: energyS.ok ? "ok" : "error",
    physical: physicalS.ok ? "ok" : "error",
    bdti: bdtiS.ok ? "ok" : "error",
    telegramDeep: tgDeepS.ok ? "ok" : "error",
    telegramBroad: tgBroadS.ok ? "ok" : "error",
    telegramRu: tgRuS.ok ? "ok" : "partial",
    telegram:
      tgDeepS.ok && tgBroadS.ok
        ? "ok"
        : tgDeepS.ok || tgBroadS.ok
          ? "partial"
          : "error",
    fires: firesS.ok ? "ok" : "error",
    ships: shipsS.ok ? "ok" : "error",
    news: newsS.ok ? "ok" : "error",
    flights: flightsS.ok ? "ok" : "error",
    alerts: alertsS.ok ? "ok" : "error",
    strikes: strikesS.ok ? "ok" : "error",
    regionalAlerts: regionalS.ok ? "ok" : "error",
    polymarketIs: polymarketS.ok ? "ok" : "error",
    chokepoints: chokeS.ok ? "ok" : "error",
    shippingIndustry: shipS.ok ? "ok" : "error",
    intelAlarm: alarm ? "ok" : "partial",
    decisionFootprint: footprint ? "ok" : "partial",
    marketSurprise: surprise ? "ok" : "partial",
  };

  const gaps: string[] = [];
  if (!theaterS.ok) gaps.push(`theaterWatch: ${theaterS.error}`);
  if (!quoteS.ok) gaps.push(`FRO quote: ${quoteS.error}`);
  if (!energyS.ok) gaps.push(`energy futures: ${energyS.error}`);
  if (!physicalS.ok) gaps.push(`physical (EIA/TD3C): ${physicalS.error}`);
  if (!firesS.ok)
    gaps.push(
      `IRONSIGHT FIRMS offline (${firesS.error}) — use NASA FIRMS map deep link`,
    );
  if (!shipsS.ok)
    gaps.push(
      `IRONSIGHT ships offline (${shipsS.error}) — warship stamps unavailable (not live AIS)`,
    );
  if (!newsS.ok) gaps.push(`IRONSIGHT news offline (${newsS.error})`);
  if (!flightsS.ok)
    gaps.push(`IRONSIGHT flights/ADS-B offline (${flightsS.error})`);
  if (!alertsS.ok) gaps.push(`IRONSIGHT alerts offline (${alertsS.error})`);
  if (!strikesS.ok) gaps.push(`IRONSIGHT strikes offline (${strikesS.error})`);
  if (!regionalS.ok)
    gaps.push(`IRONSIGHT regional-alerts offline (${regionalS.error})`);
  if (!polymarketS.ok)
    gaps.push(`IRONSIGHT polymarket offline (${polymarketS.error})`);
  if (chokeS.ok && chokeS.value.hormuz.latest) {
    gaps.push(
      `✅ IMF PortWatch daily chokepoint transits — Hormuz ${chokeS.value.hormuz.latest.nTotal} total / ${chokeS.value.hormuz.latest.nTanker} tanker @ ${chokeS.value.hormuz.latest.date} (lagged ~3–7d; not live AIS).`,
    );
  } else {
    gaps.push(
      `❌ IMF PortWatch chokepoint transits unavailable${chokeS.ok ? "" : ` (${chokeS.error})`} — MarineTraffic deep links only for Hormuz/Bab counts.`,
    );
  }
  if (shipS.ok) {
    gaps.push(
      `✅ Frontline/peer shipping headlines (${shipS.value.frontline.length} FRO-related) + IR deep links — TCE not PDF-parsed.`,
    );
  } else {
    gaps.push(`Frontline/peer IR headlines unavailable (${shipS.error})`);
  }
  gaps.push(
    "❌ No live commercial AIS scrape — AIS is a Layer-3 corroboration gap (Decision Footprint + Market Surprise are primary). PortWatch covers lagged transit counts; manual Theater posture + deep links for live pins.",
  );
  gaps.push(
    "EIA Brent spot + VLCC TD3C are lagged official/reprint series — not live Baltic FFA.",
  );

  const watch = theaterS.ok ? theaterS.value : null;
  const froPrice =
    quoteS.ok && typeof quoteS.value.price === "number" ? quoteS.value.price : null;
  const froChangePct =
    quoteS.ok && typeof quoteS.value.changePercent === "number"
      ? quoteS.value.changePercent
      : null;

  const focus = watch?.focus46c;
  const aisStatus = opts.aisStatus?.trim() || "unknown";
  const aisNote = opts.aisNote?.trim() || "(no manual AIS note)";
  const capeStatus = opts.capeStatus?.trim() || "unknown";
  const capeNote = opts.capeNote?.trim() || "(no manual Cape note)";
  const irgcStatus = opts.irgcStatus?.trim() || "unknown";
  const irgcNote = opts.irgcNote?.trim() || "(no manual IRGC note)";
  const romeStatus = opts.romeStatus?.trim() || "unknown";
  const romeNote = opts.romeNote?.trim() || "(no manual Rome note)";

  const relevantTg = allTg.filter((p) => p.relevant);
  const tgForPack =
    relevantTg.length > 0
      ? relevantTg.slice(0, tgIsDump ? 80 : 24)
      : allTg.slice(0, tgIsDump ? 40 : 12);

  if (!tgDeepS.ok && !tgBroadS.ok) {
    gaps.push(
      `❌ No live Telegram full channel dump — IRONSIGHT offline (deep: ${tgDeepS.error}; broad: ${tgBroadS.error}). Start \`npm run osint\` (IRONSIGHT :3170). Public scrape needs no TELEGRAM_* keys.`,
    );
  } else if (tgIsDump) {
    const partial =
      !tgDeepS.ok || !tgBroadS.ok
        ? " (partial — one pass failed; shipped what succeeded)"
        : "";
    gaps.push(
      `✅ Live Telegram two-pass dump${partial} — deep Hormuz ${deepMeta.postCount ?? deepPosts.length} posts (${deepMeta.days ?? 30}d / ≤${deepMeta.limit ?? 500}) + broad ME ${broadMeta.postCount ?? broadPosts.length} (${broadMeta.days ?? 7}d / ≤${broadMeta.limit ?? 100}) + RU light ${ruMeta.postCount ?? ruPosts.length}. Merged unique ${allTg.length}. Not forever-history / private channels.`,
    );
    if (!tgDeepS.ok) sources.telegramDeep = "error";
    if (!tgBroadS.ok) sources.telegramBroad = "error";
    if (!tgDeepS.ok || !tgBroadS.ok) sources.telegram = "partial";
  } else {
    gaps.push(
      `❌ No live Telegram full channel dump — IRONSIGHT sample only (merged ${allTg.length} posts). Upgrade IRONSIGHT /api/telegram to mode=dump.`,
    );
    sources.telegram = "partial";
  }

  const hist = getHistoryStatus();
  const packScore = computePackScore({
    sources,
    telegramDeepPosts: deepMeta.postCount ?? deepPosts.length,
    telegramBroadPosts: broadMeta.postCount ?? broadPosts.length,
    historyOptionRows: hist.optionRows,
    footprintOk: !!footprint,
    surpriseOk: !!surprise,
  });

  const firesParsed = firesS.ok
    ? parseFires(firesS.value)
    : { total: 0, hormuz: [] as FireHit[], bab: [] as FireHit[] };

  const ships = shipsS.ok ? parseShips(shipsS.value) : [];

  const newsItems: OsintNewsHeadline[] = [];
  const pushNews = (item: OsintNewsHeadline) => {
    const title = item.title.trim();
    if (!title) return;
    newsItems.push({
      ...item,
      title,
      excerpt: item.excerpt.replace(/\s+/g, " ").trim().slice(0, 400),
    });
  };
  if (newsS.ok) {
    const raw = newsS.value;
    const articles = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as { news?: unknown })?.news)
        ? ((raw as { news: unknown[] }).news as unknown[])
        : [];
    for (const a of articles.slice(0, 80)) {
      const row = a as Record<string, unknown>;
      const excerptRaw =
        row.description ??
        row.summary ??
        row.contentSnippet ??
        row.content ??
        row.excerpt ??
        "";
      const excerpt =
        typeof excerptRaw === "string"
          ? excerptRaw.replace(/<[^>]+>/g, " ")
          : "";
      pushNews({
        source: String(row.source ?? "news"),
        title: String(row.title ?? "").trim(),
        link: String(row.link ?? row.url ?? "").trim(),
        pubDate: row.pubDate != null ? String(row.pubDate) : "",
        excerpt,
      });
    }
  }

  // Merge theaterWatch news into hostile/political synthesis
  if (watch) {
    for (const i of watch.stateMedia.items.slice(0, 10)) {
      pushNews({
        source: `stateMedia:${i.source}`,
        title: i.title,
        link: i.link ?? "",
        pubDate: i.pubDate ?? "",
        excerpt: "",
      });
    }
    for (const i of watch.warRiskInsurance.items.slice(0, 8)) {
      pushNews({
        source: "warRisk",
        title: i.title,
        link: i.link,
        pubDate: i.pubDate,
        excerpt: "",
      });
    }
    for (const i of watch.bibiSpoiler.romeTalks.items.slice(0, 8)) {
      pushNews({
        source: `rome:${i.source}`,
        title: i.title,
        link: i.link,
        pubDate: i.pubDate,
        excerpt: "",
      });
    }
    for (const i of watch.khargPickaxe.irgcBoats.items.slice(0, 8)) {
      pushNews({
        source: `irgc:${i.source}`,
        title: i.title,
        link: i.link,
        pubDate: i.pubDate || "",
        excerpt: "",
      });
    }
  }

  const evidenceIndex = buildEvidenceIndex({
    footprintContributions: (footprint?.signals ?? []).map((s) => ({
      id: s.id,
      label: s.label,
      title: s.detail,
      detail: s.detail,
      points: s.points,
    })),
    surpriseTheses: surprise?.theses,
    telegram: allTg,
    news: newsItems,
  });
  const narrativeMatrix = buildNarrativeMatrix(
    newsItems
      .map((n) => ({
        title: n.title,
        source: n.source,
        url: n.link,
      }))
      .concat(
        allTg.slice(0, 80).map((p) => ({
          title: p.text,
          source: p.channel,
          url: p.link,
        })),
      ),
  );

  try {
    recordIntelDailySnapshot({
      footprintScore: footprint?.score ?? null,
      footprintBand: footprint?.band ?? null,
      surpriseEdges: (surprise?.theses ?? []).map((t) => ({
        id: t.id,
        edgePp: t.edgePp,
      })),
      packScore: packScore.score,
      packBand: packScore.band,
      payload: {
        telegramPosts: allTg.length,
        sources,
      },
    });
  } catch {
    /* non-fatal */
  }

  const hostile = collectHostile(
    allTg,
    newsItems,
    watch?.khargPickaxe.vlccCape.diversionHints ?? [],
    watch?.warRiskInsurance.spikeHints ?? [],
  );

  const saudiHouthiHits = [
    ...allTg
      .filter((p) => POLITICAL_SAUDI_HOUTHI_RE.test(p.text))
      .map((p) => `[tg:${p.channel}] ${p.text}`),
    ...newsItems
      .filter((n) => POLITICAL_SAUDI_HOUTHI_RE.test(n.title))
      .map((n) => `[${n.source}] ${n.title}`),
  ].slice(0, 10);

  const wti =
    energyS.ok && typeof energyS.value.wti?.price === "number"
      ? energyS.value.wti.price
      : null;
  const brent =
    energyS.ok && typeof energyS.value.brent?.price === "number"
      ? energyS.value.brent.price
      : null;

  const bullets = buildExecutiveBullets({
    watch,
    alarm,
    footprint,
    surprise,
    froPrice,
    froChangePct,
    focusBid: focus?.bid ?? null,
    focusAsk: focus?.ask ?? null,
    aisStatus,
    capeStatus,
    firesHormuz: firesParsed.hormuz.length,
    firesBab: firesParsed.bab.length,
    hostileCount: hostile.length,
    tgRelevant: relevantTg.length,
    gaps,
  });

  const oneLiner = froOneLiner({
    froPrice,
    froChangePct,
    focusBid: focus?.bid ?? null,
    focusAsk: focus?.ask ?? null,
    focusVol: focus?.volume ?? null,
    focusOi: focus?.openInterest ?? null,
    wti,
    brent,
    bdti: watch?.bdti.latest?.value ?? null,
    aisStatus,
    alarmLevel: alarm?.level ?? null,
    generatedAt,
  });

  const aisRead =
    aisStatus === "anchored"
      ? watch?.ais.readAnchored ?? "Anchored/loitering — deal-hope posture."
      : aisStatus === "cape"
        ? watch?.ais.readCapeDiversion ?? "Cape diversion — long-war / bullish freight."
        : aisStatus === "normal"
          ? "VLCCs moving normally through the Strait — no clear loitering or Cape diversion signal."
          : "AIS posture not set — optional Layer-3 gap; Decision Footprint + Market Surprise are primary.";

  const lines: string[] = [];
  lines.push(`# Tradehole live data feed · ${generatedAt}`);
  lines.push("");
  lines.push(`Symbol: ${symbol} · Sources: Tradehole + IRONSIGHT (${IRONSIGHT_URL})`);
  lines.push("");
  lines.push("## Executive snapshot");
  for (const b of bullets) lines.push(`- ${b}`);
  lines.push("");

  // ——— 0. Decision Footprint (primary) ———
  lines.push(decisionFootprintMarkdown(footprint));
  lines.push("");

  // ——— 0b. Market Surprise ———
  lines.push(marketSurpriseMarkdown(surprise));
  lines.push("");

  // ——— 1. AIS / VLCC (Layer-3 gap) ———
  lines.push("## 1. AIS / VLCC (Layer-3 gap · manual)");
  lines.push(
    "**Honest gap:** No live commercial AIS scrape. Decision Footprint + Market Surprise above are the primary scored aids — AIS deep links are optional Layer-3 corroboration + IRONSIGHT warship stamps.",
  );
  lines.push(`Manual Hormuz VLCC posture: **${aisStatus}** — ${aisNote}`);
  lines.push(`Read: ${aisRead}`);
  lines.push(
    `Cape diversion auto: **${watch?.khargPickaxe.vlccCape.regime ?? "?"}** · manual **${capeStatus}** — ${capeNote}`,
  );
  if (watch?.khargPickaxe.vlccCape.read) {
    lines.push(watch.khargPickaxe.vlccCape.read);
  }
  if (watch?.khargPickaxe.vlccCape.diversionHints.length) {
    lines.push("Diversion headlines:");
    for (const t of watch.khargPickaxe.vlccCape.diversionHints.slice(0, 8)) {
      lines.push(`- ${t}`);
    }
  }
  const ea = watch?.eastAfricaCape;
  if (ea) {
    lines.push("");
    lines.push("### East Africa / Somali-basin Cape route (freight watch — not High-go)");
    lines.push(`Regime: **${ea.regime}**`);
    lines.push(ea.read);
    lines.push(ea.thesis);
    for (const s of ea.signals) {
      lines.push(`- ${s.id}: ${s.status}${s.lit ? ` — ${s.read}` : ""}`);
      for (const e of s.evidence.slice(0, 2)) lines.push(`  - ${e}`);
    }
    for (const r of ea.rules) lines.push(`- ${r}`);
    for (const l of ea.links) lines.push(`- ${l.label}: ${l.href}`);
    for (const i of ea.items.slice(0, 6)) lines.push(`- ${i.title}`);
  }
  lines.push("Deep links:");
  for (const l of watch?.ais.links ?? [
    {
      label: "MarineTraffic · Hormuz",
      href: "https://www.marinetraffic.com/en/ais/home/centerx:56.25/centery:26.56/zoom:8",
    },
    {
      label: "VesselFinder",
      href: "https://www.vesselfinder.com/",
    },
  ]) {
    lines.push(`- ${l.label}: ${l.href}`);
  }
  for (const l of watch?.khargPickaxe.vlccCape.links ?? []) {
    lines.push(`- ${l.label}: ${l.href}`);
  }
  lines.push("");
  lines.push("### IRONSIGHT warship stamps (not live AIS)");
  if (ships.length === 0) {
    lines.push("- (none / IRONSIGHT offline)");
  } else {
    for (const s of ships.slice(0, 15)) {
      lines.push(
        `- ${s.name}${s.hull ? ` (${s.hull})` : ""} · ${s.status} @ ${s.lat.toFixed(2)},${s.lon.toFixed(2)} · ${s.region}`,
      );
    }
  }
  if (watch) {
    lines.push("");
    lines.push("### ARG hulls (Kharg / Pickaxe)");
    for (const v of watch.khargPickaxe.amphibious.vessels) {
      const man = hullManual(opts, v.key);
      lines.push(
        `- **${v.name} (${v.hull})** manual=${man.status} — ${man.note}`,
      );
      if (v.ironsight) {
        lines.push(
          `  IRONSIGHT: ${v.ironsight.status} @ ${v.ironsight.lat.toFixed(2)},${v.ironsight.lon.toFixed(2)} (${v.ironsight.region})`,
        );
      }
      for (const l of v.links.slice(0, 2)) {
        lines.push(`  - ${l.label}: ${l.href}`);
      }
    }
  }
  if (alarm) {
    lines.push("");
    lines.push(
      `5-Lock L1 Bataan / L5 Cape: L1=${alarm.locks.find((l) => l.id === 1)?.triggered ?? "?"} · L5=${alarm.locks.find((l) => l.id === 5)?.triggered ?? "?"} · VLCC divert count (manual)=${alarm.manual.vlccDivertCount ?? "—"}`,
    );
  }
  lines.push("");

  // ——— 2. Telegram ———
  lines.push(
    tgIsDump
      ? `## 2. Telegram (two-pass live dump · deep ${deepMeta.days ?? 30}d + broad ${broadMeta.days ?? 7}d)`
      : "## 2. Telegram (sample — dump unavailable)",
  );
  lines.push(
    `${tgIsDump ? "✅" : "❌"} IRONSIGHT ${tgMeta.mode ?? "sample"}: ${allTg.length} unique posts · ${relevantTg.length} keyword-relevant · showing ${tgForPack.length}${
      tgMeta.capability ? ` · ${tgMeta.capability}` : ""
    }.`,
  );
  lines.push(`Channels (manual subscribe): ${manualSubscribeLine()}`);
  if (tgIsDump && tgMeta.channelStats?.length) {
    const top = [...tgMeta.channelStats]
      .sort((a, b) => b.postCount - a.postCount)
      .slice(0, 12)
      .map((c) => `${c.label || c.channel}:${c.postCount}`)
      .join(" · ");
    lines.push(`Per-channel counts (top): ${top}`);
  }
  if (tgForPack.length === 0) {
    lines.push("- (no telegram posts — IRONSIGHT offline or empty)");
  } else {
    for (const p of tgForPack) {
      const link = p.link ? ` · ${p.link}` : "";
      lines.push(
        `- **${p.channel}** · ${p.time}${p.relevant ? " · relevant" : ""}`,
      );
      lines.push(`  ${p.text || "(empty)"}${link}`);
    }
  }
  lines.push(
    `IRGC boat auto regime: **${watch?.khargPickaxe.irgcBoats.regime ?? "?"}** · manual **${irgcStatus}** — ${irgcNote}`,
  );
  lines.push("");

  // ——— 2b. Free IRONSIGHT extras ———
  lines.push("## 2b. Free IRONSIGHT sensors (flights / alerts / strikes / Polymarket)");
  if (flightsS.ok) {
    const raw = flightsS.value as Record<string, unknown>;
    const count = Array.isArray(raw.aircraft)
      ? raw.aircraft.length
      : Array.isArray(raw.flights)
        ? raw.flights.length
        : typeof raw.count === "number"
          ? raw.count
          : "?";
    lines.push(`- **Mil ADS-B / flights:** ok · count≈${count} (adsb.lol via IRONSIGHT — many mil dark)`);
  } else {
    lines.push(`- **Mil ADS-B / flights:** error — ${flightsS.error}`);
  }
  if (alertsS.ok) {
    lines.push(`- **Theater alerts (Pikud):** ok — see \`ironsight_alerts.json\` in ZIP`);
  } else {
    lines.push(`- **Theater alerts:** error — ${alertsS.error}`);
  }
  if (strikesS.ok) {
    lines.push(`- **Strikes layer:** ok — see \`ironsight_strikes.json\``);
  } else {
    lines.push(`- **Strikes layer:** error — ${strikesS.error}`);
  }
  if (regionalS.ok) {
    lines.push(`- **Regional alerts:** ok — see \`ironsight_regional_alerts.json\``);
  } else {
    lines.push(`- **Regional alerts:** error — ${regionalS.error}`);
  }
  if (polymarketS.ok) {
    lines.push(`- **Polymarket (IRONSIGHT):** ok — see \`ironsight_polymarket.json\``);
  } else {
    lines.push(`- **Polymarket (IRONSIGHT):** error — ${polymarketS.error}`);
  }
  lines.push("");

  lines.push(narrativeMatrixMarkdown(narrativeMatrix));
  lines.push("");
  lines.push(packScoreMarkdown(packScore));
  lines.push("");
  // ——— 3. FIRMS ———
  lines.push("## 3. FIRMS / satellite");
  lines.push(
    `Detections scanned: ${firesParsed.total} · **Hormuz box: ${firesParsed.hormuz.length}** · **Bab box: ${firesParsed.bab.length}**`,
  );
  lines.push(
    `FIRMS map (Hormuz): https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@56.3,26.5,6z`,
  );
  lines.push(
    `EO Browser (Sentinel): https://apps.sentinel-hub.com/eo-browser/?zoom=7&lat=26.5&lng=56.3&themeId=DEFAULT-THEME`,
  );
  if (firesParsed.hormuz.length) {
    lines.push("Hormuz samples:");
    for (const f of firesParsed.hormuz.slice(0, 8)) {
      lines.push(
        `- ${f.lat.toFixed(3)},${f.lon.toFixed(3)}${f.frp != null ? ` · FRP ${f.frp}` : ""}${f.acqDate ? ` · ${f.acqDate}` : ""}${f.satellite ? ` · ${f.satellite}` : ""}`,
      );
    }
  }
  if (firesParsed.bab.length) {
    lines.push("Bab el-Mandeb samples:");
    for (const f of firesParsed.bab.slice(0, 6)) {
      lines.push(
        `- ${f.lat.toFixed(3)},${f.lon.toFixed(3)}${f.frp != null ? ` · FRP ${f.frp}` : ""}${f.acqDate ? ` · ${f.acqDate}` : ""}`,
      );
    }
  }
  if (!firesS.ok) {
    lines.push(`Fetch error: ${firesS.error}`);
  }
  lines.push("");

  // ——— 4. Energy & freight (MAX) ———
  lines.push("## 4. Energy & freight");
  lines.push(
    freightMaxMarkdown({
      physical: physicalS.ok ? physicalS.value : null,
      bdti: bdtiS.ok ? bdtiS.value : null,
      theater: watch,
      energy: energyS.ok ? energyS.value : null,
      physicalError: physicalS.ok ? null : physicalS.error,
      bdtiError: bdtiS.ok ? null : bdtiS.error,
      chokepoints: chokeS.ok ? chokeS.value : null,
      chokepointsError: chokeS.ok ? null : chokeS.error,
      shippingIndustry: shipS.ok ? shipS.value : null,
      shippingIndustryError: shipS.ok ? null : shipS.error,
    })
      .split("\n")
      .slice(2) // drop duplicate H1
      .join("\n"),
  );
  lines.push(
    `FRO: ${fmtUsd(froPrice)} (${fmtPct(froChangePct)}) · source ${quoteS.ok ? quoteS.value.source : "error"}`,
  );
  lines.push(
    `Sep ${FOCUS_EXPIRY} $${FOCUS_STRIKE}c: bid ${fmtUsd(focus?.bid)} · ask ${fmtUsd(focus?.ask)} · last ${fmtUsd(focus?.last)} · vol ${focus?.volume ?? "—"} · OI ${focus?.openInterest ?? "—"} · IV ${focus?.iv != null ? (focus.iv > 2 ? focus.iv.toFixed(1) + "%" : (focus.iv * 100).toFixed(1) + "%") : "—"} · regime=${focus?.regime ?? "?"}`,
  );
  if (focus?.read) lines.push(focus.read);
  lines.push("");

  // ——— 5. Military & diplomatic ———
  lines.push("## 5. Military & diplomatic");
  if (watch) {
    lines.push(`State media / fee dispute: **${watch.stateMedia.regime}**`);
    lines.push(watch.stateMedia.read);
    if (watch.stateMedia.feeDisputeHits.length) {
      lines.push("Fee-dispute hits:");
      for (const t of watch.stateMedia.feeDisputeHits.slice(0, 6)) {
        lines.push(`- ${t}`);
      }
    }
    if (watch.stateMedia.dealHits.length) {
      lines.push("Deal-ish hits:");
      for (const t of watch.stateMedia.dealHits.slice(0, 5)) {
        lines.push(`- ${t}`);
      }
    }
    lines.push("Portals:");
    for (const l of watch.stateMedia.links) {
      lines.push(`- ${l.label}: ${l.href}`);
    }
    for (const i of watch.stateMedia.items.slice(0, 8)) {
      lines.push(`- [${i.source}] ${i.title}${i.link ? ` · ${i.link}` : ""}`);
    }
    lines.push("");
    lines.push(
      `Aerial (ADS-B): tankers ${watch.aerial.tankerCount} · AWACS ${watch.aerial.awacsCount} · regime=**${watch.aerial.regime}**`,
    );
    lines.push(watch.aerial.read);
    lines.push("");
    lines.push("### Bataan ghost tracking (pre-AIS)");
    lines.push(
      `Formation: **${watch.bataanGhost.formationRegime}** · score ${watch.bataanGhost.formationScore}/${watch.bataanGhost.formationMax}`,
    );
    lines.push(watch.bataanGhost.read);
    lines.push(watch.bataanGhost.oneLiner);
    lines.push("| Sign | Status | Source |");
    lines.push("| --- | --- | --- |");
    for (const s of watch.bataanGhost.signs) {
      lines.push(`| ${s.label} | **${s.status}** | ${s.sourceHint} |`);
    }
    for (const s of watch.bataanGhost.signs.filter(
      (x) => x.status === "hot" || x.status === "warm",
    )) {
      lines.push(`- **${s.label}** (${s.status}): ${s.read}`);
      for (const e of s.evidence.slice(0, 3)) lines.push(`  - ${e}`);
    }
    lines.push(
      `War-risk insurance chatter: **${watch.warRiskInsurance.regime}** — ${watch.warRiskInsurance.read}`,
    );
    for (const t of watch.warRiskInsurance.spikeHints.slice(0, 5)) {
      lines.push(`- ${t}`);
    }
    if (alarm) {
      lines.push("");
      const l2 = alarm.locks.find((l) => l.id === 2);
      const l2Ev = l2?.evidence as
        | {
            samples?: Array<{
              hex?: string;
              callsign?: string;
              type?: string;
              confidence?: string;
            }>;
            noisyHexWatchCount?: number;
          }
        | undefined;
      const l2Bits =
        l2Ev?.samples
          ?.slice(0, 4)
          .map(
            (s) =>
              `${s.hex ?? "?"}/${s.callsign ?? "—"}/type=${s.type ?? "?"}${s.confidence === "noisy_hex_watch" ? " [NOISY]" : ""}`,
          )
          .join(" · ") ?? "";
      lines.push(
        `Intel alarm: **${alarm.level.toUpperCase()}** · locks ${alarm.lockCount}/5 · E-6B L2=${l2?.triggered}${l2Ev?.noisyHexWatchCount ? ` · noisyHex=${l2Ev.noisyHexWatchCount}` : ""} · IRGC L3=${alarm.locks.find((l) => l.id === 3)?.triggered} · NAVWARN L4=${alarm.locks.find((l) => l.id === 4)?.triggered} · Bibi=${alarm.bibiTrigger} · redReason=${alarm.redReason ?? "null"}`,
      );
      if (l2?.read) lines.push(`- L2 detail: ${l2.read}`);
      if (l2Bits) lines.push(`- L2 evidence: ${l2Bits}`);
      for (const r of alarm.reads.slice(0, 4)) lines.push(`- ${r}`);
      const nuc = alarm.bibi.nuclearStrikeNews;
      lines.push(
        `Bibi nuclear RSS: hit=${nuc.hit} · corroboration=${nuc.corroboration} · window≤${nuc.windowHours}h · shekel=${alarm.bibi.shekel.price?.toFixed(4) ?? "—"} regime=${alarm.shekelAlarm?.regime ?? alarm.bibi.shekel.regime ?? "—"} spiked=${alarm.bibi.shekel.spiked}`,
      );
      if (nuc.titles.length) {
        for (const t of nuc.titles.slice(0, 6)) lines.push(`- fresh: ${t}`);
      } else {
        lines.push("- (no fresh Natanz/Fordow strike headlines in ≤48h sample)");
      }
      if (nuc.rejectedStale.length) {
        lines.push(
          "Filtered stale/recycled/undated/non-event (do **not** treat as live kinetic):",
        );
        for (const t of nuc.rejectedStale.slice(0, 8)) {
          lines.push(`- filtered: ${t}`);
        }
      }
    }
  } else {
    lines.push("(theaterWatch unavailable)");
  }
  // CENTCOM / Oman-Iran language from news keywords
  const centcomHits = newsItems
    .filter((n) => /CENTCOM|Fifth\s+Fleet|NAVWARN|Oman|fee|toll/i.test(n.title))
    .slice(0, 8);
  if (centcomHits.length) {
    lines.push("CENTCOM / Oman–Iran language (keyword filter, not invented):");
    for (const n of centcomHits) {
      lines.push(`- [${n.source}] ${n.title}${n.link ? ` · ${n.link}` : ""}`);
    }
  }
  lines.push("");

  // ——— 6. Hostile action log ———
  lines.push("## 6. Hostile action log");
  lines.push(
    "Synthesized only from keyword hits in IRONSIGHT/news/telegram (attack/missile/drone/seized/vessel names). **Do not invent events.**",
  );
  if (hostile.length === 0) {
    lines.push("- (no hostile-keyword hits in current sample)");
  } else {
    for (const h of hostile) {
      lines.push(
        `- [${h.source}] ${h.when} — ${h.title}${h.link ? ` · ${h.link}` : ""}`,
      );
    }
  }
  lines.push("");

  // ——— 7. Political risk ———
  lines.push("## 7. Political risk");
  if (watch) {
    const b = watch.bibiSpoiler;
    lines.push("### Bibi spoiler");
    lines.push(b.thesis);
    lines.push(`Rome Trap: ${b.scenarios.romeTrap}`);
    lines.push(`Nuclear breakout excuse: ${b.scenarios.nuclearBreakout}`);
    lines.push(
      "Trade implication: Rome next: September — walkout arm DISABLED. Not a same-day binary. Hold stubs vs Shekel / Natanz–Fordow / Gaza–Lebanon ground only — never Rome walkout timing.",
    );
    lines.push(
      `Rome talks auto=**calendar_gap** (forced) · manual=**${romeStatus}** — ${romeNote}`,
    );
    lines.push(b.romeTalks.read);
    if (b.romeTalks.keywordHits.calendarGap?.length) {
      lines.push("Calendar-gap / September notes:");
      for (const t of b.romeTalks.keywordHits.calendarGap.slice(0, 5)) {
        lines.push(`- ${t}`);
      }
    }
    // Never emit walkout hits into paste — classifier disabled.
    if (b.romeTalks.keywordHits.disarmamentPrecondition?.length) {
      lines.push("Disarmament-precondition (background only — not live Rome walkout):");
      for (const t of b.romeTalks.keywordHits.disarmamentPrecondition.slice(0, 4)) {
        lines.push(`- ${t}`);
      }
    }
    lines.push(
      `Shekel ${b.shekel.symbol}: **${b.shekel.price?.toFixed(4) ?? "—"}** (${fmtPct(b.shekel.changePct)}) · threshold~${b.shekel.threshold.toFixed(2)} · **${b.shekel.regime}**`,
    );
    lines.push(b.shekel.read);
    lines.push(
      `IDF ground: **${b.idfGround.regime}** · IRONSIGHT ${b.idfGround.ironsightOnline ? "online" : "offline"}`,
    );
    lines.push(b.idfGround.read);
    lines.push("");
    lines.push("### Polymarket");
    if (watch.polymarket.ceasefire) {
      lines.push(
        `Ceasefire-ish: ${watch.polymarket.ceasefire.yesPct ?? "—"}% — ${watch.polymarket.ceasefire.question}`,
      );
    }
    if (watch.polymarket.hormuz) {
      lines.push(
        `Hormuz: ${watch.polymarket.hormuz.yesPct ?? "—"}% — ${watch.polymarket.hormuz.question}`,
      );
    }
    lines.push(watch.polymarket.read);
    for (const m of watch.polymarket.top.slice(0, 5)) {
      lines.push(`- ${m.yesPct ?? "—"}% · ${m.question}`);
    }
  }
  lines.push("");
  lines.push("### Saudi / Houthi (keyword filter only)");
  if (saudiHouthiHits.length === 0) {
    lines.push(
      "- (no Saudi/Houthi keyword hits in current telegram/news sample — paste manually if relevant)",
    );
  } else {
    for (const t of saudiHouthiHits) lines.push(`- ${t}`);
  }
  lines.push("");

  // ——— Gaps ———
  lines.push("## Gaps / could not fetch");
  for (const g of gaps) lines.push(`- ${g}`);
  lines.push(
    `- Source status: ${Object.entries(sources)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}`,
  );
  lines.push("");

  // ——— Suggested alerts ———
  lines.push("## Suggested alerts for other LLM");
  lines.push(
    "- Decision Footprint: score ≥71 = execution prep; ≥91 = imminent ≤12h (needs Shekel/oil/NOTAM/aerial — commercial-only cannot print 91). decisionMade = ≥2 Tier1 door-slams (not auto 5-Lock RED).",
  );
  lines.push(
    "- Market Surprise: Edge = Reality% − Market% (pp). Positive edge = market underprices thesis. Click contributions in UI; Polymarket/IV when available, honest low-conf proxies otherwise.",
  );
  lines.push(
    "- Deal/fee/signature: Tasnim/ONA/Pezeshkian/Khamenei — fee in text or US reject → HOLD stubs; fee-free/US accept → TRIM gap-down risk. Text > Polymarket %.",
  );
  lines.push(
    "- AIS (Layer-3 gap): VLCC loitering/anchored vs Cape diversion — optional Theater mark; do not wait on AIS before reading Decision Footprint / Market Surprise.",
  );
  lines.push(
    "- East Africa / al-Shabaab: Somali-basin anti-ship headlines = Cape-*route* war-risk watch (FRO), not Israel go and not automatic Cape-closed. No live Somali AIS. Sunday/Monday Bibi timing is chatter, not a fire rule.",
  );
  lines.push(
    "- Bataan ghost: if aerial tankers/AWACS + Florida/SSGN dark + IRGC dispersal + NAVWARN tighten while Bataan AIS-dark → treat as sprint (do not wait for L1).",
  );
  lines.push(
    "- 5-Lock: Bataan SOG ≥15 kts toward Strait ∧ E-6B airborne ∧ IRGC dispersal keywords → RED three-lock.",
  );
  lines.push(
    "- State media: Iran “no deal without fees” + US reject → Hold $46c lottery stubs despite high Polymarket deal %.",
  );
  lines.push(
    "- Shekel USD/ILS spike (≥3.85 band ~3.9–4.0, or ≥3.6 +≥1.5% d/d) or fresh corroborated Natanz/Fordow strike headlines (≤48h, ≥2 same-day; recycled reprints excluded) → Bibi secondary path (YELLOW alone / RED with ≥2 locks).",
  );
  lines.push(
    "- Rome next: September — walkout / spoiler-path-live / delegation-returning classifier is **DISABLED**. Do **not** invent a Rome walkout clock. Residual Bibi = Shekel / Natanz–Fordow / Gaza–Lebanon ground.",
  );
  lines.push(
    "- War-risk insurance spike in next-12h headlines → underwriters pricing talks collapse.",
  );
  lines.push(
    "- FIRMS cluster spike in Hormuz/Bab boxes + hostile telegram naming a vessel → escalate hostile log manually.",
  );
  lines.push(
    "- HO/RB backwardation eroding fast while Polymarket ceasefire ↑ → Hormuz reopen priced downstream (trim bias).",
  );
  lines.push("");

  lines.push("### FRO one-liner for paste");
  lines.push(oneLiner);
  lines.push("");

  const aiPack = buildAiPackV3({
    symbol,
    generatedAt,
    footprint,
    surprise,
    theater: watch,
    deal,
    intel: alarm,
    chokepoints: chokeS.ok ? chokeS.value : null,
    bdti: bdtiS.ok ? bdtiS.value : null,
    packScore,
    narrativeMatrix,
    evidenceIndex,
    froPrice,
    froChangePct,
    focus46: focus
      ? {
          bid: focus.bid,
          ask: focus.ask,
          last: focus.last,
          volume: focus.volume,
        }
      : null,
    telegramPostCount: allTg.length,
    gaps,
  });

  // Prepend DeepSeek entrypoint so clipboard paste starts with the brief
  const markdown = [
    aiPack.briefMarkdown,
    "",
    "----------",
    "",
    lines.join("\n"),
  ].join("\n");

  const td3c = physicalS.ok ? physicalS.value.vlccTd3c : null;
  const td3cLine = td3c
    ? `TD3C (lagged reprint): WS ${td3c.worldscale ?? "—"} · TCE $${td3c.tceUsdPerDay ?? "—"}/d · asOf ${td3c.asOfLabel ?? td3c.asOfIso ?? "—"} · lag ${td3c.lagDays != null ? `${td3c.lagDays}d` : "—"}${td3c.excerpt ? ` — ${td3c.excerpt.slice(0, 160)}` : ""}`
    : null;

  return {
    symbol,
    generatedAt,
    markdown,
    byteLength: Buffer.byteLength(markdown, "utf8"),
    sources,
    telegramDump: combinedTelegramDump,
    telegramDumpMeta: tgMeta,
    telegramDeepDump: tgDeepS.ok ? tgDeepS.value : undefined,
    telegramBroadDump: tgBroadS.ok ? tgBroadS.value : undefined,
    telegramRuDump: tgRuS.ok ? tgRuS.value : undefined,
    flights: flightsS.ok ? flightsS.value : undefined,
    alerts: alertsS.ok ? alertsS.value : undefined,
    strikes: strikesS.ok ? strikesS.value : undefined,
    regionalAlerts: regionalS.ok ? regionalS.value : undefined,
    polymarketIs: polymarketS.ok ? polymarketS.value : undefined,
    chokepointTransits: chokeS.ok ? chokeS.value : undefined,
    shippingIndustry: shipS.ok ? shipS.value : undefined,
    packScore,
    evidenceIndex,
    narrativeMatrix,
    aiPack,
    packSchemaVersion: PACK_SCHEMA_VERSION,
    pasteInputs: {
      news: newsItems,
      /** ME deep+broad only — RU light stays in ZIP telegram dump, not DeepSeek paste. */
      telegram: meTgOnly,
      ships,
      td3cLine,
      desk: {
        lockLevel: alarm?.level ?? null,
        lockCount: alarm?.lockCount ?? null,
        ghostScore: watch?.bataanGhost.formationScore ?? null,
        ghostMax: watch?.bataanGhost.formationMax ?? null,
        ghostRegime: watch?.bataanGhost.formationRegime ?? null,
        dfBand: footprint?.band ?? null,
        dfScore: footprint?.score ?? null,
      },
      eastAfrica: watch
        ? {
            regime: watch.eastAfricaCape.regime,
            read: watch.eastAfricaCape.read,
            lit: watch.eastAfricaCape.signals
              .filter((s) => s.lit)
              .map((s) => `${s.id}:${s.status}`),
            evidence: watch.eastAfricaCape.signals
              .flatMap((s) => s.evidence)
              .slice(0, 6),
          }
        : null,
    },
  };
}
