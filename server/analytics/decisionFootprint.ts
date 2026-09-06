/**
 * Decision Footprint Score (0–100)
 * ---------------------------------
 * Transparent additive stack — NOT ML. Primary decision aid for FRO/Hormuz
 * timing; AIS remains a manual/deep-link gap, not part of the formula.
 *
 * Bands:
 *   0–30  Diplomacy alive
 *  31–50  Talks deteriorating
 *  51–70  Decision being made
 *  71–90  Execution prep
 *  91–100 Imminent (≤12h)
 *
 * Tier 1 Diplomatic (door slamming) — weight heavily when 2+ co-occur ≤6h:
 *   fee_dispute, negotiations_suspended, trump_done_negotiating,
 *   bibi_no_choice, israeli_delegation_returning (general — not Rome-walkout),
 *   israel_unilateral (fresh ≤72h multi-source go-alone / Channel-13 planning —
 *     not evergreen "IDF ready"; contingent "if US pulls back" still counts soft).
 *   2+ lit → decisionMade=true + cluster bump (does NOT auto-RED 5-Lock).
 *
 * Tier 2 Execution footprint (count lit; sequence if timestamps available):
 *   shekel_spike, oil_spike (full weight only on sharp % or fresh level+same-day %;
 *     level-alone = elevated / lower weight — does not alone imply kinetic go),
 *   radio_hole warm→hot, aerial tanker surge, embassy/emergency (best-effort).
 *
 * Tier 3 Market:
 *   Polymarket ceasefire drop (honest: 1d Δ if no 1h history),
 *   FRO Sep $46c vol + bid/ask tighten, BDTI >2700 or sharp d/d,
 *   war-risk spike_chatter.
 *
 * Cap: commercial-only (war-risk + fee) cannot reach 91 without execution/FX
 *      (shekel, oil, NOTAM/radio, aerial elevated+).
 */
import { getEnergyQuotes } from "../market";
import { getHistoryDb } from "../history/db";
import type { TheaterWatch } from "../theaterWatch";
import { getLastGoodTheaterWatch, warmTheaterWatch } from "../theaterWatch";
import type { DealAlarmState } from "../dealAlarm";
import { evaluateDealAlarm, getLatestDealAlarm } from "../dealAlarm";
import type { IntelAlarmState } from "../intelAlarm";
import { evaluateIntelAlarm, getLatestIntelAlarm } from "../intelAlarm";
import { serveLastGood } from "../lastGoodServe";
import { readLastGood } from "../lastGoodStore";

const FOCUS_EXPIRY = "2026-09-18";
const FOCUS_STRIKE = 46;
const DIPLOMATIC_WINDOW_MS = 6 * 60 * 60 * 1000;
/** Unilateral / go-alone planning leaks — longer than door-slam window. */
const UNILATERAL_WINDOW_MS = 72 * 60 * 60 * 1000;
const UNILATERAL_CORROBORATION_MIN = 2;

/** Fresh Israel unilateral / go-alone planning (not evergreen "ready to strike"). */
const UNILATERAL_HIT_RE =
  /\bunilateral\b|go\s+it\s+alone|go\s+alone|fight(?:ing)?\s+Iran\s+alone|strike\s+Iran\s+alone|without\s+(the\s+)?U\.?S\.?|independently.{0,50}(strike|attack|prepar)|prepar(?:ing|es|ed)?.{0,60}(unilateral|alone|independently)|(Channel\s*13|N13|ערוץ\s*13).{0,80}(unilateral|alone|independently|go\s+alone)/i;

/** Evergreen readiness rhetoric without alone/unilateral — recycle filter. */
const UNILATERAL_EVERGREEN_RE =
  /\b(ready\s+to\s+strike|fully\s+ready|IDF\s+ready|operational(?:ly)?\s+ready)\b/i;

const UNILATERAL_CONTINGENT_RE =
  /\bif\s+(the\s+)?U\.?S\.?\b|if\s+Washington|pull(?:s|ing)?\s+back|at\s+(the\s+)?U\.?S\.?\s+request|U\.?S\.?\s+blocking|joint\s+with\s+(the\s+)?U\.?S\.?/i;

/** Oil level thresholds — elevated when at/above; full spike needs % move. */
const WTI_SPIKE_LEVEL = 82;
const BRENT_SPIKE_LEVEL = 87;
const OIL_SHARP_PCT = 3.0;
/** Same-day % that, with level breach, counts as fresh oil_spike (not sticky elevate). */
const OIL_FRESH_BREACH_PCT = 1.0;
const OIL_ELEVATED_WEIGHT = 4;
const OIL_SHARP_WEIGHT = 7;
const OIL_SPIKE_WEIGHT = 10;

export type OilClassifyResult = {
  oilElevated: boolean;
  oilSpike: boolean;
  oilLit: boolean;
  oilWeight: number;
  label: string;
  detailNote: string;
};

/**
 * Level alone = elevated (low weight). Full oil_spike points only for sharp %
 * or fresh breach (level AND same-day % ≥ ~1%). Elevated-only + dark aerial
 * stays light so DF does not hard-sell "execution prep" from sticky oil prices.
 */
export function classifyOilSignal(opts: {
  wtiPx: number | null;
  brentPx: number | null;
  wtiChg: number | null;
  brentChg: number | null;
  aerialElevated?: boolean;
  aerialMass?: boolean;
}): OilClassifyResult {
  const { wtiPx, brentPx, wtiChg, brentChg } = opts;
  const oilLevel =
    (wtiPx != null && wtiPx >= WTI_SPIKE_LEVEL) ||
    (brentPx != null && brentPx >= BRENT_SPIKE_LEVEL);
  const oilSharp =
    (wtiChg != null && wtiChg >= OIL_SHARP_PCT) ||
    (brentChg != null && brentChg >= OIL_SHARP_PCT);
  const freshBreach =
    oilLevel &&
    ((wtiChg != null && wtiChg >= OIL_FRESH_BREACH_PCT) ||
      (brentChg != null && brentChg >= OIL_FRESH_BREACH_PCT));
  const oilSpike = oilSharp || Boolean(freshBreach);
  const oilElevated = oilLevel && !oilSpike;
  const oilLit = oilSpike || oilElevated;

  let oilWeight = 0;
  if (oilSpike) {
    oilWeight =
      oilSharp && !freshBreach && !oilLevel ? OIL_SHARP_WEIGHT : OIL_SPIKE_WEIGHT;
  } else if (oilElevated) {
    oilWeight = OIL_ELEVATED_WEIGHT;
    // Decay: elevated-only with quiet aerial must not dominate execution narrative
    if (!opts.aerialElevated && !opts.aerialMass) {
      oilWeight = Math.min(oilWeight, OIL_ELEVATED_WEIGHT);
    }
  }

  const label = oilSpike
    ? `Oil spike (WTI≥$${WTI_SPIKE_LEVEL} / Brent≥$${BRENT_SPIKE_LEVEL} with fresh % OR ≥${OIL_SHARP_PCT}% d/d)`
    : oilElevated
      ? `Oil elevated (WTI≥$${WTI_SPIKE_LEVEL} / Brent≥$${BRENT_SPIKE_LEVEL}, no fresh % — weight ${oilWeight})`
      : `Oil spike (WTI≥$${WTI_SPIKE_LEVEL} / Brent≥$${BRENT_SPIKE_LEVEL} + fresh % OR ≥${OIL_SHARP_PCT}% d/d)`;

  let detailNote = "";
  if (oilSpike && oilSharp && !freshBreach) {
    detailNote = " · sharp % rule";
  } else if (oilSpike && freshBreach) {
    detailNote = " · fresh level+same-day % breach";
  } else if (oilElevated) {
    detailNote =
      !opts.aerialElevated && !opts.aerialMass
        ? " · elevated only (aerial quiet — not kinetic go)"
        : " · elevated only (no fresh %)";
  }

  return {
    oilElevated,
    oilSpike,
    oilLit,
    oilWeight,
    label,
    detailNote,
  };
}

export type DecisionBand =
  | "diplomacy_alive"
  | "talks_deteriorating"
  | "decision_being_made"
  | "execution_prep"
  | "imminent";

export type DecisionTier = 1 | 2 | 3;

export type DecisionSignal = {
  id: string;
  tier: DecisionTier;
  label: string;
  lit: boolean;
  weight: number;
  points: number;
  detail: string;
  at: string | null;
  source: string;
};

export type DecisionFootprint = {
  score: number;
  band: DecisionBand;
  statusLabel: string;
  decisionMade: boolean;
  diplomaticLit: number;
  executionLit: number;
  marketLit: number;
  signals: DecisionSignal[];
  verdict: string;
  nextTriggers: string[];
  gaps: string[];
  rulesSummary: string[];
  capped: boolean;
  capReason: string | null;
  asOf: string;
  inputs: {
    theaterAt: string | null;
    dealAt: string | null;
    intelAt: string | null;
  };
  stale?: boolean;
  fromCache?: boolean;
  servedAgeMs?: number;
  rebuilding?: boolean;
  degradedReason?: string | null;
};

type NewsItem = { title: string; link: string; pubDate: string };

function bandFromScore(score: number): DecisionBand {
  if (score >= 91) return "imminent";
  if (score >= 71) return "execution_prep";
  if (score >= 51) return "decision_being_made";
  if (score >= 31) return "talks_deteriorating";
  return "diplomacy_alive";
}

function statusLabel(band: DecisionBand): string {
  switch (band) {
    case "diplomacy_alive":
      return "Diplomacy alive";
    case "talks_deteriorating":
      return "Talks deteriorating";
    case "decision_being_made":
      return "Decision being made";
    case "execution_prep":
      return "Execution prep";
    case "imminent":
      return "Imminent (≤12h)";
  }
}

function parsePubMs(pubDate: string | null | undefined): number | null {
  if (!pubDate?.trim()) return null;
  const t = Date.parse(pubDate);
  return Number.isFinite(t) ? t : null;
}

function withinWindow(at: string | null, nowMs: number, windowMs: number): boolean {
  if (!at) return true; // undated live classifiers from deal/theater count as current
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return true;
  return nowMs - t <= windowMs;
}

export type IsraelUnilateralPlanning = {
  /** ≥2 distinct fresh ≤72h titles — lights Tier-1. */
  hit: boolean;
  /** ≥1 fresh ≤72h title — soft watch only. */
  softHit: boolean;
  contingent: boolean;
  title: string | null;
  at: string | null;
  titles: string[];
  rejected: string[];
  windowHours: number;
  corroboration: "multi_source" | "single" | "none";
};

/**
 * Israel unilateral / IDF go-alone planning leaks.
 * Honesty: ≤72h pubDate, prefer multi-source; reject evergreen "ready to strike"
 * without alone/unilateral; note contingent "if US pulls back" framing.
 */
export async function fetchIsraelUnilateralPlanning(
  nowMs = Date.now(),
): Promise<IsraelUnilateralPlanning> {
  const empty: IsraelUnilateralPlanning = {
    hit: false,
    softHit: false,
    contingent: false,
    title: null,
    at: null,
    titles: [],
    rejected: [],
    windowHours: UNILATERAL_WINDOW_MS / (60 * 60 * 1000),
    corroboration: "none",
  };
  try {
    const batches = await Promise.all([
      fetchGoogleNewsRss(
        '(Israel OR Netanyahu OR IDF OR "Channel 13") (unilateral OR "go it alone" OR "go alone" OR "fight Iran alone" OR "strike Iran alone" OR independently) (Iran) (strike OR attack OR war OR prepar)',
        8,
      ).catch(() => [] as NewsItem[]),
      fetchGoogleNewsRss(
        '("Channel 13" OR N13) Israel (Iran) (strike OR attack OR prepar OR alone OR unilateral)',
        6,
      ).catch(() => [] as NewsItem[]),
    ]);
    const seen = new Set<string>();
    const fresh: Array<{ title: string; at: string; contingent: boolean }> = [];
    const rejected: string[] = [];
    for (const item of batches.flat()) {
      const key = item.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const ms = parsePubMs(item.pubDate);
      if (ms == null || nowMs - ms < 0 || nowMs - ms > UNILATERAL_WINDOW_MS) {
        rejected.push(item.title);
        continue;
      }
      // Evergreen readiness without alone/unilateral language → noise.
      if (
        UNILATERAL_EVERGREEN_RE.test(item.title) &&
        !UNILATERAL_HIT_RE.test(item.title)
      ) {
        rejected.push(item.title);
        continue;
      }
      if (!UNILATERAL_HIT_RE.test(item.title)) {
        rejected.push(item.title);
        continue;
      }
      fresh.push({
        title: item.title,
        at: item.pubDate || new Date(ms).toISOString(),
        contingent: UNILATERAL_CONTINGENT_RE.test(item.title),
      });
    }
    const multi = fresh.length >= UNILATERAL_CORROBORATION_MIN;
    const soft = fresh.length >= 1;
    const top = fresh[0] ?? null;
    return {
      hit: multi,
      softHit: soft,
      contingent: fresh.some((f) => f.contingent),
      title: top?.title ?? null,
      at: top?.at ?? null,
      titles: fresh.map((f) => f.title),
      rejected: rejected.slice(0, 8),
      windowHours: empty.windowHours,
      corroboration: multi ? "multi_source" : soft ? "single" : "none",
    };
  } catch {
    return empty;
  }
}

async function fetchGoogleNewsRss(query: string, limit = 6): Promise<NewsItem[]> {
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

/** Extra diplomatic headlines not always covered by dealAlarm events. */
async function fetchDiplomaticExtras(nowMs: number): Promise<{
  trumpDone: { hit: boolean; title: string | null; at: string | null };
  bibiNoChoice: { hit: boolean; title: string | null; at: string | null };
  negotiationsSuspended: { hit: boolean; title: string | null; at: string | null };
  delegationReturning: { hit: boolean; title: string | null; at: string | null };
  embassyAdvisory: { hit: boolean; title: string | null; at: string | null };
}> {
  const empty = {
    trumpDone: { hit: false, title: null, at: null },
    bibiNoChoice: { hit: false, title: null, at: null },
    negotiationsSuspended: { hit: false, title: null, at: null },
    delegationReturning: { hit: false, title: null, at: null },
    embassyAdvisory: { hit: false, title: null, at: null },
  };
  try {
    const [trumpItems, bibiItems, suspItems, delItems, embItems] =
      await Promise.all([
        fetchGoogleNewsRss(
          '(Trump) ("done negotiating" OR "no more negotiations" OR "negotiations are over" OR "walking away" OR "won\'t negotiate") (Iran OR Hormuz OR Oman)',
          6,
        ).catch(() => [] as NewsItem[]),
        fetchGoogleNewsRss(
          '(Netanyahu OR Bibi) ("no choice" OR "no other choice" OR "defensive" OR "forced to act" OR "right to defend") (Iran OR Hezbollah OR strike OR war)',
          6,
        ).catch(() => [] as NewsItem[]),
        fetchGoogleNewsRss(
          '(Tasnim OR ONA OR "Oman News Agency" OR Iran OR Oman) (negotiations OR talks) (suspend OR suspended OR paused OR halted OR "called off" OR stalled)',
          6,
        ).catch(() => [] as NewsItem[]),
        fetchGoogleNewsRss(
          '("Israeli delegation" OR "Israel delegation") (returning OR "returning early" OR "left talks" OR "walked out" OR "headed home") -Rome',
          6,
        ).catch(() => [] as NewsItem[]),
        fetchGoogleNewsRss(
          '("embassy advisory" OR "embassy alert" OR "ordered departure" OR "drawdown" OR "emergency broadcast" OR Pikud OR "Home Front Command") (Israel OR Tehran OR Bahrain OR "Persian Gulf")',
          5,
        ).catch(() => [] as NewsItem[]),
      ]);

    const fresh = (items: NewsItem[], re: RegExp) => {
      for (const i of items) {
        if (!re.test(i.title)) continue;
        const ms = parsePubMs(i.pubDate);
        if (ms != null && nowMs - ms > DIPLOMATIC_WINDOW_MS * 3) continue; // 18h soft for RSS
        return {
          hit: true,
          title: i.title,
          at: i.pubDate || null,
        };
      }
      return { hit: false, title: null, at: null };
    };

    // Reject Rome-walkout pollution and Sde Teiman soldier walkouts.
    const ROME_OR_BASE_NOISE =
      /\bRome\b|Sde\s*Teiman|base\s+walkout|soldiers?\s+.{0,40}walkout/i;

    const delFresh = (() => {
      for (const i of delItems) {
        if (ROME_OR_BASE_NOISE.test(i.title)) continue;
        if (
          !/delegation|returning|left talks|walked out|headed home/i.test(
            i.title,
          )
        ) {
          continue;
        }
        const ms = parsePubMs(i.pubDate);
        if (ms != null && nowMs - ms > DIPLOMATIC_WINDOW_MS * 3) continue;
        return { hit: true, title: i.title, at: i.pubDate || null };
      }
      return { hit: false, title: null, at: null };
    })();

    return {
      trumpDone: fresh(
        trumpItems,
        /done\s+negotiat|no\s+more\s+negotiat|negotiations?\s+(are\s+)?over|walking\s+away|won'?t\s+negotiat|refuse[sd]?\s+to\s+negotiat/i,
      ),
      bibiNoChoice: fresh(
        bibiItems,
        /no\s+(other\s+)?choice|forced\s+to\s+act|right\s+to\s+defend|defensive\s+(strike|action|war)|must\s+strike|no\s+alternative/i,
      ),
      negotiationsSuspended: (() => {
        // Prefer Tasnim/ONA/mediation collapse — skip pure oil-desk "stalled talks" fluff.
        for (const i of suspItems) {
          const t = i.title;
          if (
            !/suspend|paused|halted|called\s+off|stalled|no\s+further\s+talks|talks?\s+(off|ended|over)/i.test(
              t,
            )
          ) {
            continue;
          }
          const primary =
            /Tasnim|ONA\b|Oman\s+News|mediation|Hormuz|Pezeshkian|Khamenei|White\s+House|Trump/i.test(
              t,
            );
          const oilDeskOnly =
            /\b(Citi|Goldman|JPMorgan|forecast|Brent|WTI|oil\s+market)/i.test(t) &&
            !/Tasnim|ONA\b|Oman\s+News|Hormuz|mediation/i.test(t);
          if (!primary || oilDeskOnly) continue;
          const ms = parsePubMs(i.pubDate);
          if (ms != null && nowMs - ms > DIPLOMATIC_WINDOW_MS * 3) continue;
          return { hit: true, title: t, at: i.pubDate || null };
        }
        return { hit: false, title: null, at: null };
      })(),
      delegationReturning: delFresh,
      embassyAdvisory: fresh(
        embItems,
        /embassy\s+(advisory|alert)|ordered\s+departure|drawdown|emergency\s+broadcast|Pikud|Home\s+Front\s+Command|evacuate/i,
      ),
    };
  } catch {
    return empty;
  }
}

function focus46cHistoryHint(): {
  volSpike: boolean;
  bidTighten: boolean;
  detail: string;
} {
  try {
    const database = getHistoryDb();
    if (!database) {
      return {
        volSpike: false,
        bidTighten: false,
        detail: "No local history DB — using live focus46c regime only.",
      };
    }
    const rows = database
      .prepare(
        `SELECT ts, volume, bid, ask
         FROM option_snapshots
         WHERE symbol = 'FRO' AND expiry = ? AND strike = ? AND type = 'call'
         ORDER BY ts DESC LIMIT 12`,
      )
      .all(FOCUS_EXPIRY, FOCUS_STRIKE) as Array<{
      ts: string;
      volume: number | null;
      bid: number | null;
      ask: number | null;
    }>;
    if (rows.length < 2) {
      return {
        volSpike: false,
        bidTighten: false,
        detail: "Insufficient $46c history snapshots.",
      };
    }
    const latest = rows[0]!;
    const prior = rows.slice(1);
    const priorVols = prior
      .map((r) => r.volume)
      .filter((v): v is number => v != null && v > 0);
    const avgPrior =
      priorVols.length > 0
        ? priorVols.reduce((a, b) => a + b, 0) / priorVols.length
        : null;
    const volSpike =
      latest.volume != null &&
      avgPrior != null &&
      latest.volume >= 200 &&
      latest.volume >= avgPrior * 2.5;

    const widths = prior
      .map((r) =>
        r.bid != null && r.ask != null && r.ask >= r.bid
          ? r.ask - r.bid
          : null,
      )
      .filter((w): w is number => w != null);
    const avgWidth =
      widths.length > 0
        ? widths.reduce((a, b) => a + b, 0) / widths.length
        : null;
    const latestWidth =
      latest.bid != null && latest.ask != null
        ? latest.ask - latest.bid
        : null;
    const bidTighten =
      latestWidth != null &&
      avgWidth != null &&
      avgWidth > 0.05 &&
      latestWidth <= avgWidth * 0.55;

    return {
      volSpike,
      bidTighten,
      detail: `hist vol ${latest.volume ?? "—"} vs avg ${avgPrior?.toFixed(0) ?? "—"} · width ${latestWidth?.toFixed(2) ?? "—"} vs avg ${avgWidth?.toFixed(2) ?? "—"}`,
    };
  } catch (err) {
    return {
      volSpike: false,
      bidTighten: false,
      detail: `History query failed: ${String(err).slice(0, 80)}`,
    };
  }
}

function sig(
  partial: Omit<DecisionSignal, "points"> & { lit: boolean; weight: number },
): DecisionSignal {
  return {
    ...partial,
    points: partial.lit ? partial.weight : 0,
  };
}

export async function buildDecisionFootprint(opts: {
  theater?: TheaterWatch | null;
  deal?: DealAlarmState | null;
  intel?: IntelAlarmState | null;
}): Promise<DecisionFootprint> {
  const asOf = new Date().toISOString();
  const nowMs = Date.parse(asOf);
  const watch = opts.theater ?? null;
  const deal = opts.deal ?? null;
  const intel = opts.intel ?? null;

  const [energy, extras, unilateral] = await Promise.all([
    getEnergyQuotes().catch(() => null),
    fetchDiplomaticExtras(nowMs),
    fetchIsraelUnilateralPlanning(nowMs),
  ]);
  const hist46 = focus46cHistoryHint();

  const dealEvents = deal?.events ?? [];
  const feeFromDeal = dealEvents.some(
    (e) =>
      (e.kind === "fee_dispute" ||
        e.kind === "us_rejects_fee" ||
        e.kind === "deal_signed_with_fee") &&
      withinWindow(e.detectedAt, nowMs, DIPLOMATIC_WINDOW_MS),
  );
  const feeFromTheater =
    watch?.stateMedia.regime === "no_deal_fees" ||
    watch?.stateMedia.regime === "fee_dispute_live";
  const feeLit = feeFromDeal || feeFromTheater;
  const feeTitle =
    dealEvents.find(
      (e) =>
        e.kind === "fee_dispute" ||
        e.kind === "us_rejects_fee" ||
        e.kind === "deal_signed_with_fee",
    )?.title ??
    watch?.stateMedia.feeDisputeHits[0] ??
    null;
  const feeAt =
    dealEvents.find(
      (e) => e.kind === "fee_dispute" || e.kind === "us_rejects_fee",
    )?.detectedAt ?? null;

  const suspFromDeal = dealEvents.some(
    (e) =>
      (e.kind === "oman_backs_out" || e.kind === "deal_breakdown") &&
      withinWindow(e.detectedAt, nowMs, DIPLOMATIC_WINDOW_MS),
  );
  const suspLit = suspFromDeal || extras.negotiationsSuspended.hit;
  const suspTitle =
    dealEvents.find(
      (e) => e.kind === "oman_backs_out" || e.kind === "deal_breakdown",
    )?.title ?? extras.negotiationsSuspended.title;
  const suspAt =
    dealEvents.find(
      (e) => e.kind === "oman_backs_out" || e.kind === "deal_breakdown",
    )?.detectedAt ?? extras.negotiationsSuspended.at;

  const trumpLit = extras.trumpDone.hit;
  const bibiLit = extras.bibiNoChoice.hit;
  const delLit = extras.delegationReturning.hit;
  const unilateralLit = unilateral.hit;

  // —— Tier 1 signals ——
  const t1: DecisionSignal[] = [
    sig({
      id: "fee_dispute",
      tier: 1,
      label: "Fee dispute / US reject–no-fees",
      lit: feeLit,
      weight: 12,
      detail: feeLit
        ? feeTitle ?? `stateMedia=${watch?.stateMedia.regime}`
        : "No hard fee/US-reject signal in deal alarm or state media.",
      at: feeAt,
      source: feeFromDeal ? "dealAlarm" : feeFromTheater ? "theater.stateMedia" : "—",
    }),
    sig({
      id: "negotiations_suspended",
      tier: 1,
      label: "Negotiations suspended (Tasnim/ONA)",
      lit: suspLit,
      weight: 14,
      detail: suspLit
        ? suspTitle ?? "Talks suspended / Oman backs out / Iran deal breakdown"
        : "No suspension / Oman-backs-out / breakdown in window.",
      at: suspAt,
      source: suspFromDeal ? "dealAlarm" : extras.negotiationsSuspended.hit ? "rss" : "—",
    }),
    sig({
      id: "trump_done_negotiating",
      tier: 1,
      label: 'Trump "done negotiating"',
      lit: trumpLit,
      weight: 12,
      detail: trumpLit
        ? extras.trumpDone.title ?? "Trump walk-away language"
        : "No Trump walk-away / done-negotiating headline in soft window.",
      at: extras.trumpDone.at,
      source: "rss",
    }),
    sig({
      id: "bibi_no_choice",
      tier: 1,
      label: 'Bibi "no choice / defensive"',
      lit: bibiLit,
      weight: 10,
      detail: bibiLit
        ? extras.bibiNoChoice.title ?? "Defensive / no-choice speech"
        : "No Netanyahu no-choice / defensive framing in soft window.",
      at: extras.bibiNoChoice.at,
      source: "rss",
    }),
    sig({
      id: "israeli_delegation_returning",
      tier: 1,
      label: "Israeli delegation returning early",
      lit: delLit,
      weight: 10,
      detail: delLit
        ? extras.delegationReturning.title ?? "Delegation returning"
        : "No general Israeli-delegation-returning hit (Rome walkout not revived).",
      at: extras.delegationReturning.at,
      source: "rss",
    }),
    sig({
      id: "israel_unilateral",
      tier: 1,
      label: "Israel unilateral / go-alone planning",
      lit: unilateralLit,
      weight: 8,
      detail: unilateralLit
        ? `${unilateral.contingent ? "Contingent framing · " : ""}${unilateral.title ?? "Multi-source unilateral planning"} (${unilateral.titles.length} ≤${unilateral.windowHours}h)`
        : unilateral.softHit
          ? `Soft single-source ≤${unilateral.windowHours}h (need ≥${UNILATERAL_CORROBORATION_MIN} for Tier-1): ${unilateral.title}`
          : unilateral.rejected.length
            ? `No fresh multi-source unilateral/go-alone ≤${unilateral.windowHours}h (${unilateral.rejected.length} evergreen/stale filtered).`
            : `No unilateral / go-alone / Channel-13 planning leak ≤${unilateral.windowHours}h.`,
      at: unilateral.at,
      source: "rss",
    }),
  ];

  const diplomaticLit = t1.filter((s) => s.lit).length;
  const decisionMade = diplomaticLit >= 2;
  // Cluster bump: 2+ door-slams → decision-made zone; 3+ heavier.
  const clusterBump = decisionMade ? (diplomaticLit >= 3 ? 20 : 15) : 0;

  // —— Tier 2 Execution ——
  const shekel =
    intel?.shekelAlarm ??
    intel?.bibi?.shekel ??
    null;
  const shekelSpiked =
    shekel?.spiked === true ||
    watch?.bibiSpoiler.shekel.regime === "spike_toward_4";
  const shekelDetail = shekel
    ? `USD/ILS ${shekel.price?.toFixed(4) ?? "—"} (${shekel.changePct != null ? `${shekel.changePct.toFixed(2)}%` : "—"}) · ${shekel.regime}`
    : watch
      ? `USD/ILS ${watch.bibiSpoiler.shekel.price?.toFixed(4) ?? "—"} · ${watch.bibiSpoiler.shekel.regime}`
      : "Shekel unavailable";

  const wtiPx = energy?.wti?.price ?? watch?.wtiCurve.near.price ?? null;
  const brentPx =
    energy?.brent?.price ?? watch?.brentCurve.near.price ?? null;
  const wtiChg = energy?.wti?.changePercent ?? watch?.wtiCurve.near.changePct ?? null;
  const brentChg = energy?.brent?.changePercent ?? null;

  const radioSign = watch?.bataanGhost.signs.find((s) => s.id === "radio_hole");
  const radioHot = radioSign?.status === "hot";
  const radioWarm = radioSign?.status === "warm";
  const radioLit = radioHot || radioWarm;

  const aerialElevated =
    watch?.aerial.regime === "elevated" ||
    watch?.aerial.regime === "mass_stack";
  const aerialMass = watch?.aerial.regime === "mass_stack";
  const aerialTaxis = watch?.bataanGhost.signs.find(
    (s) => s.id === "aerial_taxis",
  );
  const aerialLit =
    aerialElevated ||
    aerialTaxis?.status === "hot" ||
    aerialTaxis?.status === "warm";

  const oil = classifyOilSignal({
    wtiPx,
    brentPx,
    wtiChg,
    brentChg,
    aerialElevated,
    aerialMass,
  });
  const { oilElevated, oilSpike, oilLit, oilWeight } = oil;

  const embassyLit = extras.embassyAdvisory.hit;

  const t2: DecisionSignal[] = [
    sig({
      id: "shekel_spike",
      tier: 2,
      label: "Shekel spike (USD/ILS)",
      lit: shekelSpiked,
      weight: 14,
      detail: shekelDetail,
      at: intel?.evaluatedAt ?? watch?.bibiSpoiler.fetchedAt ?? null,
      source: shekel ? "intelAlarm" : "theater.shekel",
    }),
    sig({
      id: "oil_spike",
      tier: 2,
      label: oil.label,
      lit: oilLit,
      weight: oilWeight,
      detail: oilLit
        ? `WTI $${wtiPx?.toFixed(2) ?? "—"} (${wtiChg?.toFixed(1) ?? "—"}%) · Brent $${brentPx?.toFixed(2) ?? "—"} (${brentChg?.toFixed(1) ?? "—"}%)${oil.detailNote}`
        : `WTI $${wtiPx?.toFixed(2) ?? "—"} · Brent $${brentPx?.toFixed(2) ?? "—"} — below elevated/spike thresholds.`,
      at: energy?.wti?.fetchedAt ?? watch?.fetchedAt ?? null,
      source: energy?.wti?.source
        ? `energy:${energy.wti.source}`
        : energy
          ? "energy quotes"
          : "theater curves",
    }),
    sig({
      id: "radio_hole",
      tier: 2,
      label: "NOTAM / radio hole",
      lit: radioLit,
      weight: radioHot ? 12 : 6,
      detail: radioSign?.read ?? "Ghost radio_hole unavailable.",
      at: watch?.bataanGhost.fetchedAt ?? null,
      source: "theater.bataanGhost",
    }),
    sig({
      id: "aerial_surge",
      tier: 2,
      label: "US aircraft / aerial taxis / tankers",
      lit: !!aerialLit,
      weight: aerialMass ? 12 : aerialLit ? 6 : 6,
      detail: watch
        ? `${watch.aerial.tankerCount} tankers · ${watch.aerial.awacsCount} AWACS · ${watch.aerial.regime}`
        : "Aerial sample unavailable.",
      at: watch?.fetchedAt ?? null,
      source: "adsb.lol via theater",
    }),
    sig({
      id: "embassy_emergency",
      tier: 2,
      label: "Embassy advisory / emergency broadcast",
      lit: embassyLit,
      weight: 8,
      detail: embassyLit
        ? extras.embassyAdvisory.title ?? "Embassy / Home Front hit"
        : "No embassy advisory / Israeli emergency-broadcast hit (best-effort RSS).",
      at: extras.embassyAdvisory.at,
      source: "rss",
    }),
  ];

  const executionLit = t2.filter((s) => s.lit).length;

  // —— Tier 3 Market ——
  const poly = watch?.polymarket.ceasefire ?? null;
  // Gamma oneDayPriceChange is in probability fraction (−0.10 ≈ −10 pts).
  const poly1dPts =
    poly?.oneDayChange != null ? poly.oneDayChange * 100 : null;
  const polyDrop1d = poly1dPts != null && poly1dPts <= -10;
  // Soft: ≥6 pt 1d drop still counts at half weight via separate soft flag
  const polySoftDrop = !polyDrop1d && poly1dPts != null && poly1dPts <= -6;

  const focusRegime = watch?.focus46c.regime === "vol_bid_up";
  const focusVolLive =
    watch?.focus46c.volume != null && watch.focus46c.volume >= 200;
  const focusWidth = watch?.focus46c.width ?? null;
  const focusBid = watch?.focus46c.bid ?? null;
  const focusTightenLive =
    focusWidth != null &&
    focusBid != null &&
    focusWidth <= Math.max(0.15, focusBid * 0.25);
  const focusVolLit = focusRegime || hist46.volSpike || focusVolLive;
  const focusTighten = hist46.bidTighten || focusTightenLive;
  const focusLit = focusVolLit || focusTighten;
  const focusWeight = focusRegime
    ? 10
    : focusVolLit && focusTighten
      ? 10
      : focusVolLit
        ? 6
        : focusTighten
          ? 4
          : 6;

  const bdtiVal = watch?.bdti.latest?.value ?? null;
  const bdtiChg = watch?.bdti.changePct1d ?? null;
  const bdtiLevel = bdtiVal != null && bdtiVal > 2700;
  const bdtiSharp = bdtiChg != null && bdtiChg >= 8;
  const bdtiLit = bdtiLevel || bdtiSharp;

  const warHot = watch?.warRiskInsurance.regime === "spike_chatter";
  const warWarm = watch?.warRiskInsurance.regime === "mixed";
  const warLit = warHot || warWarm;

  const t3: DecisionSignal[] = [
    sig({
      id: "polymarket_ceasefire_drop",
      tier: 3,
      label: "Polymarket ceasefire drop",
      lit: polyDrop1d || polySoftDrop,
      weight: polyDrop1d ? 12 : polySoftDrop ? 7 : 12,
      detail: poly
        ? `Ceasefire ~${poly.yesPct ?? "—"}% · 1d Δ ${poly1dPts != null ? `${poly1dPts.toFixed(1)} pts` : "—"}. No 1h history — using 1d Δ only.`
        : "No ceasefire Polymarket row.",
      at: watch?.fetchedAt ?? null,
      source: "polymarket gamma (1d, not 1h)",
    }),
    sig({
      id: "fro_46c_vol_tighten",
      tier: 3,
      label: "FRO Sep $46c vol + bid/ask tighten",
      lit: focusLit,
      weight: focusWeight,
      detail: watch
        ? `regime=${watch.focus46c.regime} · bid $${watch.focus46c.bid?.toFixed(2) ?? "—"} ask $${watch.focus46c.ask?.toFixed(2) ?? "—"} vol ${watch.focus46c.volume ?? "—"} · ${hist46.detail}`
        : hist46.detail,
      at: watch?.fetchedAt ?? null,
      source: "theater.focus46c + history DB",
    }),
    sig({
      id: "bdti_spike",
      tier: 3,
      label: "BDTI spike (>2700 or sharp d/d)",
      lit: bdtiLit,
      weight: bdtiLevel ? 10 : 8,
      detail: `BDTI ${bdtiVal ?? "—"} · d/d ${bdtiChg?.toFixed(1) ?? "—"}%`,
      at: watch?.bdti.latest?.date ?? null,
      source: "theater.bdti",
    }),
    sig({
      id: "war_risk_cascade",
      tier: 3,
      label: "War-risk insurance cascade",
      lit: warLit,
      weight: warHot ? 8 : 4,
      detail: watch?.warRiskInsurance.read ?? "War-risk unavailable.",
      at: watch?.fetchedAt ?? null,
      source: "theater.warRiskInsurance",
    }),
  ];

  const marketLit = t3.filter((s) => s.lit).length;

  const signals = [...t1, ...t2, ...t3];
  let raw =
    8 + // baseline so quiet tape sits in diplomacy_alive, not zero
    signals.reduce((n, s) => n + s.points, 0) +
    clusterBump;

  // Cap: commercial-only (war-risk + fee) cannot hit 91 without execution/FX.
  // Oil elevated-alone does NOT count as execution/FX — need oilSpike.
  const hasExecutionOrFx =
    shekelSpiked ||
    oilSpike ||
    radioHot ||
    (radioWarm && aerialLit) ||
    aerialMass ||
    (aerialElevated && shekelSpiked) ||
    embassyLit;

  const commercialOnlyLean =
    (warLit || feeLit) &&
    !hasExecutionOrFx &&
    diplomaticLit <= 1 &&
    !shekelSpiked;

  let capped = false;
  let capReason: string | null = null;
  if (raw >= 91 && !hasExecutionOrFx) {
    raw = 88;
    capped = true;
    capReason =
      "Capped below Imminent: need Shekel/oil/NOTAM-hot/aerial mass (or embassy) — commercial + diplomatic alone cannot print 91–100.";
  } else if (commercialOnlyLean && raw > 50) {
    raw = Math.min(raw, 50);
    capped = true;
    capReason =
      "Capped at Talks deteriorating: war-risk + fee without broader diplomatic cluster or execution/FX.";
  }

  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const band = bandFromScore(score);

  const litLabels = signals.filter((s) => s.lit).map((s) => s.label);
  const verdictParts: string[] = [];
  if (decisionMade) {
    verdictParts.push(
      `Decision-made flag: ${diplomaticLit} Tier-1 door-slams co-lit (cluster +${clusterBump}) — not an auto 5-Lock RED.`,
    );
  }
  if (band === "imminent") {
    verdictParts.push(
      "Imminent band — treat next ≤12h as kinetic/execution risk window; prefer Hold stubs vs deal-hope fades.",
    );
  } else if (band === "execution_prep") {
    verdictParts.push(
      "Execution-prep band — footprints assembling; watch Shekel/oil/aerial for Imminent flip.",
    );
  } else if (band === "decision_being_made") {
    verdictParts.push(
      "Decision-being-made band — diplomacy slamming; market may still price deal hope. Text > Polymarket.",
    );
  } else if (band === "talks_deteriorating") {
    verdictParts.push(
      "Talks deteriorating — elevated watch; not yet a multi-domain go stack.",
    );
  } else {
    verdictParts.push(
      "Diplomacy alive / quiet stack — Decision Footprint is the primary aid; AIS is a secondary manual gap check only.",
    );
  }
  if (litLabels.length) {
    verdictParts.push(`Lit: ${litLabels.join(" · ")}.`);
  } else {
    verdictParts.push("No scored signals lit.");
  }
  if (capReason) verdictParts.push(capReason);

  const nextTriggers: string[] = [];
  if (!shekelSpiked) {
    nextTriggers.push("USD/ILS ≥3.85 or ≥3.6 with ≥+1.5% d/d (Shekel spike)");
  }
  if (!oilSpike) {
    nextTriggers.push(
      oilElevated
        ? `Oil fresh spike: ≥${OIL_SHARP_PCT}% d/d or level+≥${OIL_FRESH_BREACH_PCT}% same-day (elevated-only is not kinetic go)`
        : `WTI ≥$${WTI_SPIKE_LEVEL} or Brent ≥$${BRENT_SPIKE_LEVEL} with fresh % (≥${OIL_FRESH_BREACH_PCT}%) OR ≥${OIL_SHARP_PCT}% d/d`,
    );
  }
  if (!radioHot) {
    nextTriggers.push("Second Gulf/Bahrain NOTAM/TFR (radio_hole → hot)");
  }
  if (!aerialMass) {
    nextTriggers.push("Gulf aerial tankers → mass_stack (≥5)");
  }
  if (!decisionMade) {
    nextTriggers.push(
      "Second Tier-1 door-slam within ~6h (fee / suspend / Trump done / Bibi / delegation / unilateral)",
    );
  }
  if (!unilateralLit) {
    nextTriggers.push(
      "Israel unilateral / Channel-13 go-alone ≤72h multi-source (evergreen IDF-ready filtered)",
    );
  }
  if (!polyDrop1d) {
    nextTriggers.push(
      "Polymarket ceasefire 1d Δ ≤ −10 pts (1h Δ not stored — watch live)",
    );
  }
  if (!warHot) {
    nextTriggers.push("War-risk insurance → spike_chatter");
  }
  nextTriggers.push(
    "Manual AIS (MarineTraffic) remains a corroboration gap — not required for this score",
  );

  const gaps: string[] = [
    "Polymarket 1h Δ unavailable — scoring uses 1d price change only.",
    "No live AIS scrape — hull posture is manual/deep-link secondary, excluded from score.",
    "Embassy / emergency broadcast is best-effort Google News RSS (brittle).",
  ];
  if (!watch) gaps.push("Theater watch missing — Tier 2/3 degraded.");
  if (!deal) gaps.push("Deal alarm cache empty — fee/suspend lean on RSS + state media.");
  if (!intel) gaps.push("Intel alarm cache empty — Shekel from theater only.");

  const rulesSummary = [
    "Additive weights (Tier1 diplomatic · Tier2 execution · Tier3 market) + baseline 8 + cluster bump if ≥2 Tier1 lit.",
    "Bands: 0–30 diplomacy · 31–50 deteriorating · 51–70 decision · 71–90 execution prep · 91–100 imminent ≤12h.",
    "≥2 Tier1 door-slams → decisionMade +15/+20 bump (not auto 5-Lock RED).",
    "israel_unilateral: ≤72h multi-source go-alone/Channel-13 planning (not evergreen IDF-ready); contingent US-pullback framing still lights.",
    `Oil: level (WTI≥$${WTI_SPIKE_LEVEL}/Brent≥$${BRENT_SPIKE_LEVEL}) = elevated @ weight ${OIL_ELEVATED_WEIGHT}; full oil_spike only for ≥${OIL_SHARP_PCT}% d/d or fresh level+≥${OIL_FRESH_BREACH_PCT}% — elevated-only + dark aerial does not imply kinetic go.`,
    "Cap: cannot print 91+ without execution/FX (Shekel, oil spike, NOTAM-hot, aerial mass, or embassy).",
    "Commercial-only (war-risk+fee, ≤1 diplomatic, no FX/execution) capped at 50.",
  ];

  return {
    score,
    band,
    statusLabel: statusLabel(band),
    decisionMade,
    diplomaticLit,
    executionLit,
    marketLit,
    signals,
    verdict: verdictParts.join(" "),
    nextTriggers: nextTriggers.slice(0, 7),
    gaps,
    rulesSummary,
    capped,
    capReason,
    asOf,
    inputs: {
      theaterAt: watch?.fetchedAt ?? null,
      dealAt: deal?.evaluatedAt ?? null,
      intelAt: intel?.evaluatedAt ?? null,
    },
  };
}

export function decisionFootprintMarkdown(fp: DecisionFootprint | null): string {
  if (!fp) return "## Decision Footprint\n(unavailable)";
  const lit = fp.signals.filter((s) => s.lit);
  const dark = fp.signals.filter((s) => !s.lit);
  return [
    "## Decision Footprint Score",
    `**${fp.score}/100** · Status: **${fp.statusLabel}** · band=\`${fp.band}\`${fp.decisionMade ? " · **decisionMade**" : ""}`,
    fp.verdict,
    "",
    `Tier lit: diplomatic ${fp.diplomaticLit} · execution ${fp.executionLit} · market ${fp.marketLit}${fp.capped ? ` · capped (${fp.capReason})` : ""}`,
    `asOf ${fp.asOf}`,
    "",
    "### Signal stack",
    "| Tier | Signal | Lit | Pts | At |",
    "| --- | --- | --- | --- | --- |",
    ...fp.signals.map(
      (s) =>
        `| T${s.tier} | ${s.label} | ${s.lit ? "**YES**" : "no"} | ${s.points}/${s.weight} | ${s.at ?? "—"} |`,
    ),
    "",
    ...lit.map(
      (s) =>
        `- **T${s.tier} ${s.id}** (+${s.points}): ${s.detail}${s.at ? ` · ${s.at}` : ""}`,
    ),
    ...(dark.length
      ? ["", "Quiet:", ...dark.map((s) => `- T${s.tier} ${s.id}: ${s.detail}`)]
      : []),
    "",
    "### Next triggers",
    ...fp.nextTriggers.map((t) => `- ${t}`),
    "",
    "### Gaps / rules",
    ...fp.gaps.map((g) => `- ${g}`),
    ...fp.rulesSummary.map((r) => `- Rule: ${r}`),
  ].join("\n");
}

const DF_FRESH_TTL_MS = 45_000;
let dfLastGood: { value: DecisionFootprint; at: number } | null = null;

function hydrateDfLastGood(): void {
  if (dfLastGood) return;
  const disk = readLastGood<DecisionFootprint>("decision-footprint");
  if (disk) dfLastGood = disk;
}

export function getLastDecisionFootprint(): DecisionFootprint | null {
  hydrateDfLastGood();
  return dfLastGood?.value ?? null;
}

function emptyDecisionFootprint(): DecisionFootprint {
  return {
    score: 0,
    band: "diplomacy_alive",
    statusLabel: "Rebuilding — last-good missing after launch",
    decisionMade: false,
    diplomaticLit: 0,
    executionLit: 0,
    marketLit: 0,
    signals: [],
    verdict: "First paint after launch — footprint rebuild running.",
    nextTriggers: [],
    gaps: ["No last-good decision footprint on disk yet."],
    rulesSummary: [],
    capped: false,
    capReason: null,
    asOf: new Date().toISOString(),
    inputs: { theaterAt: null, dealAt: null, intelAt: null },
  };
}

export async function getDecisionFootprint(opts?: {
  force?: boolean;
}): Promise<DecisionFootprint> {
  const force = opts?.force === true;
  hydrateDfLastGood();
  return serveLastGood({
    flightKey: force ? "getDecisionFootprint:force" : "getDecisionFootprint",
    force,
    freshTtlMs: DF_FRESH_TTL_MS,
    label: "decision-footprint",
    persistKey: "decision-footprint",
    get: () => dfLastGood,
    set: (snap) => {
      dfLastGood = snap;
    },
    build: async () => {
      const theater =
        getLastGoodTheaterWatch() ?? (await warmTheaterWatch());
      let deal = getLatestDealAlarm();
      let intel = getLatestIntelAlarm();
      if (force) {
        try {
          deal = await evaluateDealAlarm();
        } catch {
          /* keep cache */
        }
        try {
          intel = await evaluateIntelAlarm();
        } catch {
          /* keep cache */
        }
      }
      const fp = await buildDecisionFootprint({ theater, deal, intel });
      dfLastGood = { value: fp, at: Date.now() };
      return fp;
    },
    empty: emptyDecisionFootprint,
  });
}
