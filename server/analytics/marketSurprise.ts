/**
 * Market Surprise Score
 * ---------------------
 * For each major thesis: Edge = Reality% − Market% (percentage points).
 * Reality = Tradehole fused intel (Decision Footprint / theater / deal / locks).
 * Market  = Polymarket, options-implied, or honest FX/quiet proxies.
 *
 * Transparent weighted contributions — NOT ML. Honest when either side is thin.
 */
import {
  buildDecisionFootprint,
  fetchIsraelUnilateralPlanning,
  type DecisionFootprint,
  type IsraelUnilateralPlanning,
} from "./decisionFootprint";
import type { TheaterWatch } from "../theaterWatch";
import { getLastGoodTheaterWatch, warmTheaterWatch } from "../theaterWatch";
import type { DealAlarmState } from "../dealAlarm";
import { evaluateDealAlarm, getLatestDealAlarm } from "../dealAlarm";
import type { IntelAlarmState } from "../intelAlarm";
import { evaluateIntelAlarm, getLatestIntelAlarm } from "../intelAlarm";
import { serveLastGood } from "../lastGoodServe";
import { readLastGood } from "../lastGoodStore";

export type SurpriseConfidence = "low" | "med" | "high";

export type SurpriseVerdictKind =
  | "market_underprices"
  | "aligned"
  | "market_ahead";

export type SurpriseContribution = {
  id: string;
  side: "reality" | "market";
  label: string;
  /** Signed contribution toward that side's percentage (pp). */
  delta: number;
  lit: boolean;
  detail: string;
  source: string;
};

export type SurpriseThesis = {
  id: string;
  label: string;
  question: string;
  realityPct: number | null;
  marketPct: number | null;
  /** Reality − Market (pp). Null if either side missing. */
  edgePp: number | null;
  confidence: SurpriseConfidence;
  verdictKind: SurpriseVerdictKind | "unknown";
  verdict: string;
  contributions: SurpriseContribution[];
  gaps: string[];
  marketSource: string | null;
  realitySource: string;
};

export type MarketSurprise = {
  theses: SurpriseThesis[];
  asOf: string;
  notes: string[];
  rulesSummary: string[];
  inputs: {
    theaterAt: string | null;
    dealAt: string | null;
    intelAt: string | null;
    footprintScore: number | null;
  };
  stale?: boolean;
  fromCache?: boolean;
  servedAgeMs?: number;
  rebuilding?: boolean;
  degradedReason?: string | null;
};

const EDGE_ALIGN_PP = 8;
const FOCUS_EXPIRY = "2026-09-18";
const FOCUS_STRIKE = 46;

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function contrib(
  partial: Omit<SurpriseContribution, "lit"> & { lit?: boolean },
): SurpriseContribution {
  const lit = partial.lit ?? partial.delta !== 0;
  return { ...partial, lit };
}

/** Standard normal CDF (Abramowitz–Stegun 26.2.17). */
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

function daysToExpiry(expiry: string, now = new Date()): number | null {
  const t = Date.parse(`${expiry}T21:00:00Z`);
  if (!Number.isFinite(t)) return null;
  const d = (t - now.getTime()) / (24 * 60 * 60 * 1000);
  return d > 0.05 ? d : null;
}

/** Rough risk-neutral call ITM probability from IV (r≈0). */
function otmCallProbPct(
  spot: number,
  strike: number,
  iv: number,
  expiry: string,
): { pct: number; detail: string } | null {
  const days = daysToExpiry(expiry);
  if (days == null || iv <= 0 || spot <= 0 || strike <= 0) return null;
  const T = days / 365;
  const sigma = iv > 2 ? iv / 100 : iv; // accept decimal or percent
  if (sigma <= 0.01) return null;
  const d2 =
    (Math.log(spot / strike) - 0.5 * sigma * sigma * T) /
    (sigma * Math.sqrt(T));
  const pct = round1(normCdf(d2) * 100);
  return {
    pct: clamp(pct, 0.5, 99),
    detail: `N(d2)≈${pct}% · S=${spot.toFixed(2)} K=${strike} σ=${(sigma * 100).toFixed(0)}% T=${days.toFixed(0)}d`,
  };
}

function verdictFromEdge(
  edgePp: number | null,
  thesisNoun: string,
): { kind: SurpriseVerdictKind | "unknown"; verdict: string } {
  if (edgePp == null) {
    return {
      kind: "unknown",
      verdict: "Cannot score edge — market or reality side missing.",
    };
  }
  if (Math.abs(edgePp) < EDGE_ALIGN_PP) {
    return {
      kind: "aligned",
      verdict: `Aligned — reality and market within ±${EDGE_ALIGN_PP}pp on ${thesisNoun}.`,
    };
  }
  if (edgePp > 0) {
    return {
      kind: "market_underprices",
      verdict: `Market underprices ${thesisNoun} (edge +${edgePp.toFixed(0)}pp).`,
    };
  }
  return {
    kind: "market_ahead",
    verdict: `Market ahead on ${thesisNoun} (edge ${edgePp.toFixed(0)}pp).`,
  };
}

function confidenceFrom(
  realityOk: boolean,
  marketOk: boolean,
  realityGaps: number,
  marketGaps: number,
): SurpriseConfidence {
  if (!realityOk || !marketOk) return "low";
  if (realityGaps + marketGaps >= 2) return "low";
  if (realityGaps + marketGaps === 1) return "med";
  return "high";
}

function feeDisputeLive(
  deal: DealAlarmState | null,
  watch: TheaterWatch | null,
): boolean {
  if (watch?.stateMedia.regime === "fee_dispute_live") return true;
  if (watch?.stateMedia.regime === "no_deal_fees") return true;
  return (deal?.events ?? []).some(
    (e) =>
      e.kind === "fee_dispute" ||
      e.kind === "us_rejects_fee" ||
      e.kind === "deal_signed_with_fee",
  );
}

function scoreHormuzDisruption(opts: {
  footprint: DecisionFootprint | null;
  watch: TheaterWatch | null;
  deal: DealAlarmState | null;
  intel: IntelAlarmState | null;
}): SurpriseThesis {
  const { footprint, watch, deal, intel } = opts;
  const contributions: SurpriseContribution[] = [];
  const gaps: string[] = [];

  // —— Reality ——
  let reality = 28; // structural crisis baseline while thesis is live
  contributions.push(
    contrib({
      id: "hormuz_baseline",
      side: "reality",
      label: "Structural Hormuz crisis baseline",
      delta: 28,
      detail: "Live thesis baseline while Strait / fee corridor unsettled.",
      source: "rules",
    }),
  );

  if (footprint) {
    const bandBump: Record<DecisionFootprint["band"], number> = {
      diplomacy_alive: 0,
      talks_deteriorating: 8,
      decision_being_made: 16,
      execution_prep: 24,
      imminent: 32,
    };
    const bump = bandBump[footprint.band];
    reality += bump;
    contributions.push(
      contrib({
        id: "df_band",
        side: "reality",
        label: `Decision Footprint · ${footprint.statusLabel}`,
        delta: bump,
        lit: bump > 0,
        detail: `Score ${footprint.score}/100 · band=${footprint.band}${footprint.decisionMade ? " · decisionMade" : ""}`,
        source: "decisionFootprint",
      }),
    );
  } else {
    gaps.push("Decision Footprint unavailable for reality stack.");
  }

  const feeLit = feeDisputeLive(deal, watch);
  const feeDelta = feeLit ? 12 : 0;
  reality += feeDelta;
  contributions.push(
    contrib({
      id: "fee_dispute",
      side: "reality",
      label: "Fee dispute / no-deal-fees",
      delta: feeDelta,
      lit: feeLit,
      detail: feeLit
        ? `stateMedia=${watch?.stateMedia.regime ?? "—"} · deal events lit`
        : "No live fee-dispute / US-reject-fee signal.",
      source: feeLit ? "dealAlarm|theater.stateMedia" : "—",
    }),
  );

  const kineticHits = watch?.stateMedia.kineticHits ?? [];
  const kineticLit =
    kineticHits.length > 0 ||
    (watch?.stateMedia.items ?? []).some((i) =>
      /\b(Larak|US\s+forces?\s+strike|CENTCOM.{0,40}strike|strike.{0,40}Hormuz)\b/i.test(
        i.title,
      ),
    );
  const kineticDelta = kineticLit ? 10 : 0;
  reality += kineticDelta;
  contributions.push(
    contrib({
      id: "us_hormuz_kinetic",
      side: "reality",
      label: "US / Hormuz kinetic (Larak-class)",
      delta: kineticDelta,
      lit: kineticLit,
      detail: kineticLit
        ? kineticHits[0]?.slice(0, 140) ??
          "US/Hormuz kinetic headline in state-media tape."
        : "No US/Hormuz island kinetic in state-media window.",
      source: "theater.stateMedia",
    }),
  );

  const war = watch?.warRiskInsurance.regime;
  const warDelta =
    war === "spike_chatter" ? 12 : war === "mixed" ? 5 : 0;
  reality += warDelta;
  contributions.push(
    contrib({
      id: "war_risk",
      side: "reality",
      label: "War-risk insurance chatter",
      delta: warDelta,
      lit: warDelta > 0,
      detail: war
        ? `regime=${war} · ${watch?.warRiskInsurance.read?.slice(0, 120) ?? ""}`
        : "War-risk feed missing.",
      source: "theater.warRiskInsurance",
    }),
  );
  if (!war || war === "unknown") {
    gaps.push("War-risk regime thin/unknown.");
  }

  const ghost = watch?.bataanGhost;
  const ghostDelta =
    ghost?.formationRegime === "tight"
      ? 12
      : ghost?.formationRegime === "forming"
        ? 7
        : 0;
  reality += ghostDelta;
  contributions.push(
    contrib({
      id: "bataan_ghost",
      side: "reality",
      label: "Bataan ghost formation",
      delta: ghostDelta,
      lit: ghostDelta > 0,
      detail: ghost
        ? `${ghost.formationRegime} · score ${ghost.formationScore}/${ghost.formationMax}`
        : "Ghost cluster unavailable.",
      source: "theater.bataanGhost",
    }),
  );

  const lockCount = intel?.lockCount ?? 0;
  const lockDelta = Math.min(15, lockCount * 3);
  reality += lockDelta;
  contributions.push(
    contrib({
      id: "intel_locks",
      side: "reality",
      label: "5-Lock intel count",
      delta: lockDelta,
      lit: lockDelta > 0,
      detail: intel
        ? `${lockCount}/5 locks · level=${intel.level}`
        : "Intel alarm unavailable.",
      source: "intelAlarm",
    }),
  );

  const bdti = watch?.bdti;
  const bdtiHot =
    (bdti?.latest?.value != null && bdti.latest.value > 2700) ||
    (bdti?.changePct1d != null && bdti.changePct1d >= 8);
  const bdtiDelta = bdtiHot ? 6 : 0;
  reality += bdtiDelta;
  contributions.push(
    contrib({
      id: "bdti",
      side: "reality",
      label: "BDTI freight stress",
      delta: bdtiDelta,
      lit: bdtiHot,
      detail: bdti?.latest
        ? `BDTI ${bdti.latest.value} · 1d ${bdti.changePct1d?.toFixed(1) ?? "—"}%`
        : "BDTI unavailable.",
      source: "theater.bdti",
    }),
  );

  const realityPct = round1(clamp(reality));

  // —— Market: Hormuz "normal" Polymarket → disruption ≈ 100 − normal ——
  const hormuz = watch?.polymarket.hormuz ?? null;
  let marketPct: number | null = null;
  let marketSource: string | null = null;
  if (hormuz?.yesPct != null) {
    // Document: yes = "normal / reopen / transit ok" → disruption market = 100 − yes
    marketPct = round1(clamp(100 - hormuz.yesPct));
    marketSource = `Polymarket · ${hormuz.question.slice(0, 100)} (disruption≈100−normal ${hormuz.yesPct}%)`;
    contributions.push(
      contrib({
        id: "poly_hormuz_normal",
        side: "market",
        label: "Polymarket Hormuz normal → disruption",
        delta: marketPct,
        detail: `Normal/yes ${hormuz.yesPct}% → disruption market ${marketPct}%${hormuz.oneDayChange != null ? ` · 1d Δ ${(hormuz.oneDayChange * 100).toFixed(1)}¢` : ""}`,
        source: "polymarket gamma",
      }),
    );
  } else {
    gaps.push(
      "No active Hormuz Polymarket in theater top set — market side thin (skip expired).",
    );
    contributions.push(
      contrib({
        id: "poly_hormuz_missing",
        side: "market",
        label: "Polymarket Hormuz",
        delta: 0,
        lit: false,
        detail: "No hormuz market matched (closed/expired filtered out).",
        source: "polymarket gamma",
      }),
    );
  }

  const edgePp =
    marketPct != null ? round1(realityPct - marketPct) : null;
  const { kind, verdict } = verdictFromEdge(edgePp, "Hormuz disruption");
  const confidence = confidenceFrom(
    true,
    marketPct != null,
    gaps.filter((g) => /Footprint|War-risk|BDTI/i.test(g)).length,
    marketPct == null ? 1 : 0,
  );

  return {
    id: "hormuz_disruption",
    label: "Hormuz disruption / reopen failure",
    question:
      "Hormuz not normal by late Aug / disruption persists (reality vs Polymarket normal%).",
    realityPct,
    marketPct,
    edgePp,
    confidence,
    verdictKind: kind,
    verdict,
    contributions,
    gaps,
    marketSource,
    realitySource:
      "Decision Footprint band + fee_dispute + war-risk + ghost + locks + BDTI",
  };
}

function scoreFeeFreeDeal(opts: {
  watch: TheaterWatch | null;
  deal: DealAlarmState | null;
}): SurpriseThesis {
  const { watch, deal } = opts;
  const contributions: SurpriseContribution[] = [];
  const gaps: string[] = [];

  let reality = 32; // modest baseline that some deal path exists
  contributions.push(
    contrib({
      id: "deal_baseline",
      side: "reality",
      label: "Deal-path baseline",
      delta: 32,
      detail: "Corridor talks exist; fee-free / blink is the contested branch.",
      source: "rules",
    }),
  );

  const feeLit = feeDisputeLive(deal, watch);
  const feeDelta = feeLit ? -22 : 0;
  reality += feeDelta;
  contributions.push(
    contrib({
      id: "fee_dispute_inverse",
      side: "reality",
      label: "Fee dispute live (inverse)",
      delta: feeDelta,
      lit: feeLit,
      detail: feeLit
        ? `Fee fight active (${watch?.stateMedia.regime ?? deal?.stateMediaRegime ?? "—"}) — fee-free path less likely.`
        : "No hard fee-dispute — fee-free path not blocked by this signal.",
      source: "dealAlarm|theater.stateMedia",
    }),
  );

  const events = deal?.events ?? [];
  const blink = events.some((e) => e.kind === "us_blink");
  const blinkDelta = blink ? 28 : 0;
  reality += blinkDelta;
  contributions.push(
    contrib({
      id: "us_blink",
      side: "reality",
      label: "US blink → TRIM path",
      delta: blinkDelta,
      lit: blink,
      detail: blink
        ? events.find((e) => e.kind === "us_blink")?.title?.slice(0, 140) ??
          "us_blink armed"
        : "No us_blink event in deal alarm.",
      source: "dealAlarm",
    }),
  );

  const acceptKinds = events.filter(
    (e) => e.kind === "us_accepts_deal" || e.kind === "deal_signed_no_fee",
  );
  const acceptLit = acceptKinds.length > 0;
  const acceptDelta = acceptLit ? 20 : 0;
  reality += acceptDelta;
  contributions.push(
    contrib({
      id: "us_accept",
      side: "reality",
      label: "US accept / fee-free signature chatter",
      delta: acceptDelta,
      lit: acceptLit,
      detail: acceptLit
        ? acceptKinds[0]?.title?.slice(0, 140) ?? "accept event lit"
        : "No US-accept / no-fee signature event.",
      source: "dealAlarm",
    }),
  );

  const bias = deal?.actionBias;
  const trimDelta =
    bias === "trim" ? 10 : bias === "buy" ? -8 : bias === "hold" ? -4 : 0;
  reality += trimDelta;
  contributions.push(
    contrib({
      id: "deal_bias",
      side: "reality",
      label: "Deal alarm action bias",
      delta: trimDelta,
      lit: trimDelta !== 0,
      detail: deal
        ? `actionBias=${deal.actionBias} · level=${deal.level}`
        : "Deal alarm unavailable.",
      source: "dealAlarm",
    }),
  );
  if (!deal) gaps.push("Deal alarm unavailable — reality lean thin.");

  const stateDeal = watch?.stateMedia.regime === "deal_announced";
  const hopeDelta = stateDeal ? 8 : 0;
  reality += hopeDelta;
  contributions.push(
    contrib({
      id: "state_media_deal",
      side: "reality",
      label: "State-media deal hope",
      delta: hopeDelta,
      lit: stateDeal,
      detail: `regime=${watch?.stateMedia.regime ?? "—"}`,
      source: "theater.stateMedia",
    }),
  );

  const realityPct = round1(clamp(reality, 5, 95));

  // Market: prefer blockade-end / Hormuz reopen; ceasefire is a weak proxy for fee-free.
  const poly = watch?.polymarket;
  const ceasefire = poly?.ceasefire ?? null;
  const blockadeEnd =
    poly?.top.find(
      (m) =>
        /blockade/i.test(m.question) &&
        /(end|lift|remove|over|cease)/i.test(m.question),
    ) ?? null;
  const hormuzReopen =
    poly?.hormuz ??
    poly?.top.find(
      (m) =>
        /hormuz/i.test(m.question) &&
        /(normal|reopen|return|traffic)/i.test(m.question),
    ) ??
    null;
  // Prefer markets that map to corridor/deal path; Israel×Iran ceasefire ≠ fee-free.
  const marketRow = blockadeEnd ?? hormuzReopen ?? ceasefire;
  const usedCeasefireProxy =
    !!marketRow &&
    marketRow === ceasefire &&
    !blockadeEnd &&
    !hormuzReopen;
  let marketPct: number | null = null;
  let marketSource: string | null = null;
  if (marketRow?.yesPct != null) {
    marketPct = round1(clamp(marketRow.yesPct));
    marketSource = `Polymarket · ${marketRow.question.slice(0, 100)}`;
    if (usedCeasefireProxy) {
      gaps.push(
        "Fee-free market side using Israel×Iran ceasefire as weak proxy — ceasefire ≠ fee-free corridor / blockade-end.",
      );
    }
    contributions.push(
      contrib({
        id: "poly_ceasefire",
        side: "market",
        label: blockadeEnd
          ? "Polymarket blockade-end"
          : hormuzReopen && marketRow === hormuzReopen
            ? "Polymarket Hormuz reopen/normal"
            : "Polymarket ceasefire (weak fee-free proxy)",
        delta: marketPct,
        detail: `Yes ${marketPct}%${marketRow.oneDayChange != null ? ` · 1d Δ ${(marketRow.oneDayChange * 100).toFixed(1)}¢` : ""} · vol24h ${marketRow.volume24hr ?? "—"}${usedCeasefireProxy ? " · NOT fee-free" : ""}`,
        source: "polymarket gamma",
      }),
    );
  } else {
    gaps.push(
      "No active ceasefire / blockade-end / Hormuz-reopen Polymarket — market side skipped (expired filtered).",
    );
    contributions.push(
      contrib({
        id: "poly_deal_missing",
        side: "market",
        label: "Polymarket deal proxy",
        delta: 0,
        lit: false,
        detail: "No ceasefire/blockade-end/Hormuz-reopen market in active set.",
        source: "polymarket gamma",
      }),
    );
  }

  const edgePp =
    marketPct != null ? round1(realityPct - marketPct) : null;
  const { kind, verdict } = verdictFromEdge(
    edgePp,
    "fee-free / blink-TRIM path",
  );

  return {
    id: "fee_free_blink",
    label: "Fee-free deal / US blink TRIM",
    question:
      "Fee-free corridor deal or US blink (TRIM) path vs ceasefire-ish market.",
    realityPct,
    marketPct,
    edgePp,
    confidence: confidenceFrom(!!deal || !!watch, marketPct != null, gaps.length > 1 ? 1 : 0, marketPct == null ? 1 : 0),
    verdictKind: kind,
    verdict,
    contributions,
    gaps,
    marketSource,
    realitySource: "Inverse fee_dispute + us_blink / dealAlarm bias + state media",
  };
}

function scoreFroLottery(opts: {
  footprint: DecisionFootprint | null;
  watch: TheaterWatch | null;
}): SurpriseThesis {
  const { footprint, watch } = opts;
  const contributions: SurpriseContribution[] = [];
  const gaps: string[] = [];

  let reality = 12; // lottery baseline
  contributions.push(
    contrib({
      id: "lottery_baseline",
      side: "reality",
      label: "OTM lottery baseline",
      delta: 12,
      detail: `Sep $${FOCUS_STRIKE}c is a crisis lottery — low base unless footprint/freight tilt.`,
      source: "rules",
    }),
  );

  if (footprint) {
    const dfDelta = round1(footprint.score * 0.35);
    reality += dfDelta;
    contributions.push(
      contrib({
        id: "df_tilt",
        side: "reality",
        label: "Decision Footprint tilt",
        delta: dfDelta,
        detail: `${footprint.score}/100 × 0.35 → +${dfDelta}pp toward crisis lottery paying.`,
        source: "decisionFootprint",
      }),
    );
  } else {
    gaps.push("Decision Footprint missing — reality lottery lean thin.");
  }

  const war = watch?.warRiskInsurance.regime;
  const warDelta = war === "spike_chatter" ? 12 : war === "mixed" ? 5 : 0;
  reality += warDelta;
  contributions.push(
    contrib({
      id: "war_risk_lottery",
      side: "reality",
      label: "War-risk tilt",
      delta: warDelta,
      lit: warDelta > 0,
      detail: `regime=${war ?? "—"}`,
      source: "theater.warRiskInsurance",
    }),
  );

  const bdti = watch?.bdti;
  const bdtiHot =
    (bdti?.latest?.value != null && bdti.latest.value > 2700) ||
    (bdti?.changePct1d != null && bdti.changePct1d >= 8);
  const bdtiDelta = bdtiHot ? 10 : 0;
  reality += bdtiDelta;
  contributions.push(
    contrib({
      id: "bdti_lottery",
      side: "reality",
      label: "BDTI / freight tilt",
      delta: bdtiDelta,
      lit: bdtiHot,
      detail: bdti?.latest
        ? `BDTI ${bdti.latest.value} · 1d ${bdti.changePct1d?.toFixed(1) ?? "—"}%`
        : "BDTI unavailable.",
      source: "theater.bdti",
    }),
  );

  const focus = watch?.focus46c;
  const regimeDelta =
    focus?.regime === "vol_bid_up" ? 8 : focus?.regime === "bid_collapse" ? -5 : 0;
  reality += regimeDelta;
  contributions.push(
    contrib({
      id: "focus46_regime",
      side: "reality",
      label: "FRO Sep $46c regime",
      delta: regimeDelta,
      lit: regimeDelta !== 0,
      detail: focus
        ? `${focus.regime} · bid ${focus.bid ?? "—"} · IV ${focus.iv != null ? (focus.iv > 2 ? focus.iv : focus.iv * 100).toFixed(0) + "%" : "—"}`
        : "focus46c unavailable.",
      source: "theater.focus46c",
    }),
  );

  const realityPct = round1(clamp(reality, 3, 90));

  // Market: IV → N(d2) OTM call probability; fallback mid/spot rough
  let marketPct: number | null = null;
  let marketSource: string | null = null;
  if (focus?.froPrice != null && focus.iv != null && focus.iv > 0) {
    const approx = otmCallProbPct(
      focus.froPrice,
      FOCUS_STRIKE,
      focus.iv,
      focus.expiry || FOCUS_EXPIRY,
    );
    if (approx) {
      marketPct = approx.pct;
      marketSource = `Options IV N(d2) · FRO Sep $${FOCUS_STRIKE}c`;
      contributions.push(
        contrib({
          id: "iv_nd2",
          side: "market",
          label: "Options-implied OTM prob (N(d2))",
          delta: marketPct,
          detail: approx.detail,
          source: focus.source ?? "options",
        }),
      );
    }
  }

  if (marketPct == null && focus?.bid != null && focus.froPrice != null && focus.froPrice > 0) {
    // Honest rough: extrinsic bid / spot as weak lottery proxy (not true prob)
    const rough = round1(clamp((focus.bid / focus.froPrice) * 100 * 2.5, 2, 60));
    marketPct = rough;
    marketSource = `Rough bid/spot proxy · Sep $${FOCUS_STRIKE}c (not true RN prob)`;
    gaps.push(
      "IV missing — using rough bid/spot proxy for market lottery % (low confidence).",
    );
    contributions.push(
      contrib({
        id: "bid_proxy",
        side: "market",
        label: "Bid/spot rough lottery proxy",
        delta: marketPct,
        detail: `bid $${focus.bid.toFixed(2)} / spot $${focus.froPrice.toFixed(2)} → ~${marketPct}% (heuristic ×2.5)`,
        source: focus.source ?? "options",
      }),
    );
  }

  if (marketPct == null) {
    gaps.push("No IV or bid for Sep $46c — market lottery side unavailable.");
    contributions.push(
      contrib({
        id: "options_missing",
        side: "market",
        label: "Options market",
        delta: 0,
        lit: false,
        detail: "focus46c IV/bid unavailable.",
        source: "theater.focus46c",
      }),
    );
  }

  const edgePp =
    marketPct != null ? round1(realityPct - marketPct) : null;
  const { kind, verdict } = verdictFromEdge(edgePp, "FRO crisis lottery");
  const conf: SurpriseConfidence =
    marketPct != null && focus?.iv != null
      ? footprint
        ? "med"
        : "low"
      : "low";

  return {
    id: "fro_46c_lottery",
    label: `FRO crisis lottery (Sep $${FOCUS_STRIKE}c)`,
    question: `FRO ≫ spot into Sep $${FOCUS_STRIKE}c — crisis lottery vs options-implied.`,
    realityPct,
    marketPct,
    edgePp,
    confidence: conf,
    verdictKind: kind,
    verdict,
    contributions,
    gaps,
    marketSource,
    realitySource: "Decision Footprint ×0.35 + BDTI/war-risk + $46c regime",
  };
}

function scoreBibiShekel(opts: {
  watch: TheaterWatch | null;
  intel: IntelAlarmState | null;
  unilateral: IsraelUnilateralPlanning | null;
}): SurpriseThesis {
  const { watch, intel, unilateral } = opts;
  const contributions: SurpriseContribution[] = [];
  const gaps: string[] = [];

  let reality = 10;
  contributions.push(
    contrib({
      id: "spoiler_baseline",
      side: "reality",
      label: "Spoiler baseline",
      delta: 10,
      detail: "Always-some Bibi/cabinet spoiler risk while Lebanon/Iran open.",
      source: "rules",
    }),
  );

  const shekel = intel?.shekelAlarm ?? intel?.bibi?.shekel ?? null;
  const spiked = shekel?.spiked === true;
  const shekelDelta = spiked ? 35 : shekel?.regime === "firm" ? 12 : 0;
  reality += shekelDelta;
  contributions.push(
    contrib({
      id: "shekel_spike",
      side: "reality",
      label: "Shekel spike alarm",
      delta: shekelDelta,
      lit: shekelDelta > 0,
      detail: shekel
        ? `USD/ILS ${shekel.price?.toFixed(4) ?? "—"} · ${shekel.regime} · spiked=${shekel.spiked}`
        : "Shekel alarm unavailable.",
      source: "intelAlarm.shekelAlarm",
    }),
  );
  if (!shekel) gaps.push("Shekel alarm missing.");

  const bibi = intel?.bibiTrigger === true;
  const bibiDelta = bibi ? 18 : 0;
  reality += bibiDelta;
  contributions.push(
    contrib({
      id: "bibi_trigger",
      side: "reality",
      label: "Bibi secondary trigger",
      delta: bibiDelta,
      lit: bibi,
      detail: intel
        ? `bibiTrigger=${intel.bibiTrigger} · level=${intel.level}`
        : "Intel alarm unavailable.",
      source: "intelAlarm",
    }),
  );

  const rome = watch?.bibiSpoiler?.romeTalks.regime;
  // Rome live walkout arm is PAST — never add Reality pp for walkout_chatter.
  const romeDelta = 0;
  reality += romeDelta;
  contributions.push(
    contrib({
      id: "rome_spoiler",
      side: "reality",
      label: "Rome / Bibi spoiler cluster",
      delta: romeDelta,
      lit: false,
      detail: `rome regime=${rome ?? "calendar_gap"} — walkout arm DISABLED; next round September; not same-day binary`,
      source: "theater.bibiSpoiler",
    }),
  );

  // Fresh unilateral / go-alone planning (not evergreen IDF-ready).
  const uniDelta = unilateral?.hit
    ? unilateral.contingent
      ? 8
      : 12
    : unilateral?.softHit
      ? 4
      : 0;
  reality += uniDelta;
  contributions.push(
    contrib({
      id: "israel_unilateral",
      side: "reality",
      label: "Israel unilateral / go-alone planning",
      delta: uniDelta,
      lit: uniDelta > 0,
      detail: unilateral
        ? unilateral.hit || unilateral.softHit
          ? `${unilateral.corroboration}${unilateral.contingent ? " · contingent US-pullback framing" : ""} · ${unilateral.title ?? "—"}`
          : unilateral.rejected.length
            ? `${unilateral.rejected.length} evergreen/stale filtered · no fresh go-alone ≤${unilateral.windowHours}h`
            : `No unilateral/go-alone ≤${unilateral.windowHours}h`
        : "Unilateral classifier unavailable.",
      source: "decisionFootprint.israel_unilateral",
    }),
  );

  if (intel?.level === "red") {
    reality += 10;
    contributions.push(
      contrib({
        id: "intel_red",
        side: "reality",
        label: "Intel alarm RED",
        delta: 10,
        detail: `redReason=${intel.redReason ?? "—"}`,
        source: "intelAlarm",
      }),
    );
  }

  const realityPct = round1(clamp(reality, 5, 95));

  // Market: hard — use "quiet FX" as low market-priced spoiler
  // If shekel already spiked hard toward 4.0, FX has partially priced it.
  let marketPct: number;
  let marketDetail: string;
  if (shekel?.price != null && shekel.price >= 3.95) {
    marketPct = 48;
    marketDetail = `USD/ILS ${shekel.price.toFixed(4)} near crisis — FX partially pricing spoiler.`;
  } else if (spiked) {
    marketPct = 35;
    marketDetail = `Shekel spiked but below ~3.95 — FX pricing some spoiler risk.`;
  } else if (shekel?.regime === "firm") {
    marketPct = 22;
    marketDetail = "Shekel firm — mild FX pricing of spoiler.";
  } else {
    marketPct = 14;
    marketDetail =
      "Quiet FX proxy — market assumed to underprice Bibi/cabinet spoiler when USD/ILS calm.";
    gaps.push(
      "No Polymarket for Bibi spoiler — market side is a quiet-FX heuristic (honest gap).",
    );
  }
  marketPct = round1(marketPct);
  contributions.push(
    contrib({
      id: "quiet_fx_proxy",
      side: "market",
      label: "Quiet-FX market proxy",
      delta: marketPct,
      detail: marketDetail,
      source: "shekel FX heuristic (not Polymarket)",
    }),
  );

  const edgePp = round1(realityPct - marketPct);
  const { kind, verdict } = verdictFromEdge(edgePp, "Bibi/Shekel spoiler");

  return {
    id: "bibi_shekel_spoiler",
    label: "Bibi / Shekel spoiler",
    question:
      "Cabinet/strike spoiler risk vs quiet FX (no clean prediction market).",
    realityPct,
    marketPct,
    edgePp,
    confidence: shekel
      ? spiked || bibi || (unilateral?.hit ?? false)
        ? "med"
        : "low"
      : "low",
    verdictKind: kind,
    verdict,
    contributions,
    gaps,
    marketSource: "Quiet FX heuristic (USD/ILS) — not a prediction market",
    realitySource:
      "shekelAlarm + bibiTrigger + Rome + unilateral planning + intel RED",
  };
}

export async function buildMarketSurprise(opts: {
  theater?: TheaterWatch | null;
  deal?: DealAlarmState | null;
  intel?: IntelAlarmState | null;
  footprint?: DecisionFootprint | null;
}): Promise<MarketSurprise> {
  const asOf = new Date().toISOString();
  const watch = opts.theater ?? null;
  const deal = opts.deal ?? null;
  const intel = opts.intel ?? null;
  const footprint = opts.footprint ?? null;

  const unilateral = await fetchIsraelUnilateralPlanning(Date.parse(asOf));

  const theses: SurpriseThesis[] = [
    scoreHormuzDisruption({ footprint, watch, deal, intel }),
    scoreFeeFreeDeal({ watch, deal }),
    scoreFroLottery({ footprint, watch }),
    scoreBibiShekel({ watch, intel, unilateral }),
  ];

  return {
    theses,
    asOf,
    notes: [
      "Edge = Reality% − Market% (percentage points). Positive → market underprices the thesis.",
      "Reality is Tradehole fused intel (transparent weights), not ML.",
      "Market from Polymarket / options IV when available; otherwise honest proxies with low confidence.",
      "AIS is Layer-3 gap only — not in any surprise formula.",
    ],
    rulesSummary: [
      `Aligned if |edge| < ${EDGE_ALIGN_PP}pp; else market_underprices (edge>0) or market_ahead (edge<0).`,
      "Hormuz: market disruption ≈ 100 − Polymarket Hormuz-normal %. Reality = baseline + DF band + fee + war-risk + ghost + locks + BDTI.",
      "Fee-free/blink: market prefers blockade-end, else Hormuz reopen/normal (weak), else Israel×Iran ceasefire (weakest — ≠ fee-free). Reality = baseline − fee_dispute + us_blink + accept + deal bias.",
      `FRO lottery: market ≈ N(d2) from Sep $${FOCUS_STRIKE}c IV (or bid/spot proxy). Reality = DF×0.35 + war-risk + BDTI + $46c regime.`,
      "Bibi/Shekel: market = quiet-FX heuristic. Reality = shekel spike + bibi + Rome + unilateral/go-alone planning + intel RED.",
    ],
    inputs: {
      theaterAt: watch?.fetchedAt ?? null,
      dealAt: deal?.evaluatedAt ?? null,
      intelAt: intel?.evaluatedAt ?? null,
      footprintScore: footprint?.score ?? null,
    },
  };
}

export function marketSurpriseMarkdown(ms: MarketSurprise | null): string {
  if (!ms) return "## Market Surprise Score\n(unavailable)";
  const rows = ms.theses.map((t) => {
    const edge =
      t.edgePp == null
        ? "—"
        : `${t.edgePp >= 0 ? "+" : ""}${t.edgePp.toFixed(0)}pp`;
    return `| ${t.label} | ${t.realityPct ?? "—"}% | ${t.marketPct ?? "—"}% | ${edge} | ${t.confidence} | ${t.verdict} |`;
  });
  const detailBlocks = ms.theses.flatMap((t) => [
    "",
    `### ${t.label} (\`${t.id}\`)`,
    t.question,
    `**Reality ${t.realityPct ?? "—"}%** · **Market ${t.marketPct ?? "—"}%** · **Edge ${t.edgePp == null ? "—" : `${t.edgePp >= 0 ? "+" : ""}${t.edgePp}pp`}** · conf=${t.confidence}`,
    t.verdict,
    `Reality stack: ${t.realitySource}`,
    `Market: ${t.marketSource ?? "(none)"}`,
    "",
    "Contributions:",
    ...t.contributions
      .filter((c) => c.lit || c.side === "market")
      .map(
        (c) =>
          `- [${c.side}] **${c.label}** ${c.delta >= 0 ? "+" : ""}${c.delta}: ${c.detail} _(src: ${c.source})_`,
      ),
    ...(t.gaps.length
      ? ["Gaps:", ...t.gaps.map((g) => `- ${g}`)]
      : []),
  ]);

  return [
    "## Market Surprise Score",
    `Edge = Reality − Market (pp). asOf ${ms.asOf}`,
    "",
    "| Thesis | Reality | Market | Edge | Conf | Verdict |",
    "| --- | ---: | ---: | ---: | --- | --- |",
    ...rows,
    "",
    ...ms.notes.map((n) => `- ${n}`),
    "",
    "### Rules",
    ...ms.rulesSummary.map((r) => `- ${r}`),
    ...detailBlocks,
  ].join("\n");
}

const MS_FRESH_TTL_MS = 45_000;
let msLastGood: { value: MarketSurprise; at: number } | null = null;

function hydrateMsLastGood(): void {
  if (msLastGood) return;
  const disk = readLastGood<MarketSurprise>("market-surprise");
  if (disk) msLastGood = disk;
}

export function getLastMarketSurprise(): MarketSurprise | null {
  hydrateMsLastGood();
  return msLastGood?.value ?? null;
}

function emptyMarketSurprise(): MarketSurprise {
  return {
    theses: [],
    asOf: new Date().toISOString(),
    notes: ["Rebuilding market surprise — no last-good yet after launch."],
    rulesSummary: [],
    inputs: {
      theaterAt: null,
      dealAt: null,
      intelAt: null,
      footprintScore: null,
    },
  };
}

export async function getMarketSurprise(opts?: {
  force?: boolean;
}): Promise<MarketSurprise> {
  const force = opts?.force === true;
  hydrateMsLastGood();
  return serveLastGood({
    flightKey: force ? "getMarketSurprise:force" : "getMarketSurprise",
    force,
    freshTtlMs: MS_FRESH_TTL_MS,
    label: "market-surprise",
    persistKey: "market-surprise",
    get: () => msLastGood,
    set: (snap) => {
      msLastGood = snap;
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
      const footprint = await buildDecisionFootprint({
        theater,
        deal,
        intel,
      });
      const surprise = await buildMarketSurprise({
        theater,
        deal,
        intel,
        footprint,
      });
      msLastGood = { value: surprise, at: Date.now() };
      return surprise;
    },
    empty: emptyMarketSurprise,
  });
}
