/**
 * FRO forward catalyst stack — physical shipping confirmation vs deal-crush paths.
 * Synthesizes PortWatch chokepoints, TD3C/BDTI, deal alarm, market surprise, theater.
 * Not a go gate — book action for Sep $46c lottery stubs only.
 */
import type { ChokepointSeries, ChokepointTransitsReport } from "./chokepointTransits";
import { fetchChokepointTransits } from "./chokepointTransits";
import type { BdtiReport } from "./bdti";
import { fetchBdtiSeries } from "./bdti";
import type { PhysicalMarkets, VlccTd3c } from "../physical";
import { getLastGoodPhysicalMarkets, getPhysicalMarkets } from "../physical";
import type { DealAlarmState } from "../dealAlarm";
import { evaluateDealAlarm, getLatestDealAlarm } from "../dealAlarm";
import type { MarketSurprise } from "./marketSurprise";
import { buildMarketSurprise } from "./marketSurprise";
import { buildDecisionFootprint } from "./decisionFootprint";
import type { TheaterWatch } from "../theaterWatch";
import { buildTheaterWatch, getLastGoodTheaterWatch } from "../theaterWatch";
import { evaluateIntelAlarm, getLatestIntelAlarm } from "../intelAlarm";
import type { PoliticsCalendarChip } from "./politicsCalendar";
import { buildPoliticsCalendarChip } from "./politicsCalendar";
import type { TankerTrackersFlowReport } from "./tankerTrackersFlow";
import { fetchTankerTrackersFlow } from "./tankerTrackersFlow";
import { serveLastGood } from "../lastGoodServe";
import { readLastGood } from "../lastGoodStore";
import { getLastMarketSurprise } from "./marketSurprise";

export type FroCatalystStatus =
  | "hot"
  | "warm"
  | "quiet"
  | "unknown"
  | "bearish";

export type FroCatalystRegime =
  | "stall"
  | "forming"
  | "physical_confirm"
  | "catastrophe"
  | "deal_crush";

export type FroPhysicalGap =
  | "confirmed"
  | "lagging"
  | "diverging"
  | "unknown";

export type FroBookAction = "hold" | "trim" | "watch" | "add";

export type FroCatalystCard = {
  id: string;
  label: string;
  status: FroCatalystStatus;
  read: string;
  metric: string | null;
  bookHint: FroBookAction;
  source: string;
  lit: boolean;
  priority: number;
};

export type FroCatalystReport = {
  asOf: string;
  regime: FroCatalystRegime;
  regimeLabel: string;
  verdict: string;
  bookAction: FroBookAction;
  bookSummary: string;
  physicalGap: FroPhysicalGap;
  physicalGapRead: string;
  catalysts: FroCatalystCard[];
  watchNext: string[];
  actionMap: Array<{ trigger: string; action: string }>;
  gaps: string[];
  inputs: {
    hormuzDate: string | null;
    hormuzTotal: number | null;
    hormuzTanker: number | null;
    hormuzLagDays: number | null;
    td3cWs: number | null;
    td3cLagDays: number | null;
    bdti5dPct: number | null;
    dealLevel: string | null;
    ceasefireYesPct: number | null;
    froLotteryEdgePp: number | null;
    portwatchLagNote: string;
    bdtiDate?: string | null;
    bdtiLagDays?: number | null;
    td3cAsOf?: string | null;
    /** TankerTrackers blockade-line / Hormuz flow (Mbpd). */
    ttFlowMbpd?: number | null;
    ttFlowHormuzMbpd?: number | null;
    ttFlowDate?: string | null;
    ttFlowLagDays?: number | null;
    ttFlowWindow?: string | null;
    /** TD34 Gulf of Oman → China from Baltic reprint (not Clarksons inside-Hormuz). */
    td34Ws?: number | null;
    td34Tce?: number | null;
  };
  stale?: boolean;
  fromCache?: boolean;
  servedAgeMs?: number;
  rebuilding?: boolean;
  degradedReason?: string | null;
};

const HORMUZ_COLLAPSE_TOTAL = 15;
const HORMUZ_COLLAPSE_TANKER = 5;
const TD3C_HOT_WS = 450;
const BDTI_STRUCTURAL_5D = 8;
const CAPE_DIVERSION_7D = 12;

function card(
  partial: Omit<FroCatalystCard, "lit"> & { lit?: boolean },
): FroCatalystCard {
  return { ...partial, lit: partial.lit ?? partial.status !== "quiet" };
}

export function scoreHormuzTransits(series: ChokepointSeries | undefined): {
  status: FroCatalystStatus;
  read: string;
  metric: string | null;
} {
  const latest = series?.latest;
  if (!latest) {
    return {
      status: "unknown",
      read: "IMF PortWatch Hormuz series unavailable — use MarineTraffic / straits.live for eyeballs.",
      metric: null,
    };
  }
  const avg30 = series?.avg30d;
  const ratio =
    avg30 != null && avg30 > 0 ? latest.nTotal / avg30 : null;
  const collapsed =
    latest.nTotal <= HORMUZ_COLLAPSE_TOTAL ||
    latest.nTanker <= HORMUZ_COLLAPSE_TANKER ||
    (ratio != null && ratio < 0.45);
  const soft =
    latest.nTotal <= 25 ||
    latest.nTanker <= 8 ||
    (ratio != null && ratio < 0.65);
  const metric = `${latest.date}: ${latest.nTotal} total / ${latest.nTanker} tanker · 30d avg ${avg30?.toFixed(0) ?? "—"}`;
  if (collapsed) {
    return {
      status: "hot",
      read: "Hormuz transit print collapsed vs norms — diplomatic closure or crisis routing. FRO tail getting real if sustained.",
      metric,
    };
  }
  if (soft) {
    return {
      status: "warm",
      read: "Hormuz transits depressed vs 30d average — elevated shipping stress; confirm with live AIS (PortWatch lags ~3–7d).",
      metric,
    };
  }
  return {
    status: "quiet",
    read: "Hormuz PortWatch print within normal band — do not infer live strait status from this alone.",
    metric,
  };
}

export function scorePhysicalGap(
  bdti: BdtiReport | null,
  td3c: VlccTd3c | null,
): { gap: FroPhysicalGap; read: string } {
  const b5 = bdti?.changePct5d;
  const ws = td3c?.worldscale;
  const lag = td3c?.lagDays;
  const bdtiHot = b5 != null && b5 >= BDTI_STRUCTURAL_5D;
  const td3cHot = ws != null && ws >= TD3C_HOT_WS;
  if (bdtiHot && td3cHot) {
    return {
      gap: "confirmed",
      read: `Freight confirming: BDTI +${b5!.toFixed(1)}% / 5d and TD3C WS ${ws} — physical catching up to fear.`,
    };
  }
  if (bdtiHot || td3cHot) {
    const part = bdtiHot
      ? `BDTI +${b5!.toFixed(1)}% / 5d`
      : `TD3C WS ${ws}`;
    return {
      gap: "lagging",
      read: `${part} elevated but full stack not aligned — watch next TD3C print and BDTI follow-through.`,
    };
  }
  if (lag != null && lag >= 7 && (b5 == null || Math.abs(b5) < 4)) {
    return {
      gap: "diverging",
      read: `Headline war premium without rate confirmation — TD3C lag ~${lag}d, BDTI ~flat. Classic insurance-bleed setup for $46c.`,
    };
  }
  return {
    gap: "unknown",
    read: "Physical proxies thin or stale — treat oil moves as necessary context, not sufficient for FRO calls.",
  };
}

export function scoreCapeDiversion(series: ChokepointSeries | undefined): {
  status: FroCatalystStatus;
  read: string;
  metric: string | null;
} {
  const latest = series?.latest;
  if (!latest) {
    return {
      status: "unknown",
      read: "Cape PortWatch unavailable.",
      metric: null,
    };
  }
  const chg = series?.changePct7d;
  const metric = `${latest.date}: ${latest.nTotal} total · 7d ${chg != null ? `${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%` : "—"}`;
  if (chg != null && chg >= CAPE_DIVERSION_7D) {
    return {
      status: "warm",
      read: "Cape transit count rising vs ~7d ago — diversion proxy warming (lagged; Bab/Hormuz stress often leads).",
      metric,
    };
  }
  if (chg != null && chg >= 6) {
    return {
      status: "quiet",
      read: "Cape counts edging up — watch for Bab + Hormuz combo before calling structural reroute.",
      metric,
    };
  }
  return {
    status: "quiet",
    read: "No Cape diversion signal in lagged PortWatch print.",
    metric,
  };
}

function surpriseThesis(
  surprise: MarketSurprise | null,
  id: string,
): MarketSurprise["theses"][0] | null {
  return surprise?.theses.find((t) => t.id === id) ?? null;
}

export function buildFroCatalystFromInputs(input: {
  chokepoints: ChokepointTransitsReport | null;
  physical: PhysicalMarkets | null;
  bdti: BdtiReport | null;
  deal: DealAlarmState | null;
  surprise: MarketSurprise | null;
  theater: TheaterWatch | null;
  politics?: PoliticsCalendarChip | null;
  ttFlow?: TankerTrackersFlowReport | null;
}): FroCatalystReport {
  const asOf = new Date().toISOString();
  const td3c = input.physical?.vlccTd3c ?? null;
  const hormuzScore = scoreHormuzTransits(input.chokepoints?.hormuz);
  const capeScore = scoreCapeDiversion(input.chokepoints?.cape);
  const { gap: physicalGap, read: physicalGapRead } = scorePhysicalGap(
    input.bdti,
    td3c,
  );

  const hormuzDisruption = surpriseThesis(input.surprise, "hormuz_disruption");
  const feeFree = surpriseThesis(input.surprise, "fee_free_blink");
  const froLottery = surpriseThesis(input.surprise, "fro_46c_lottery");

  const ceasefireYes = input.theater?.polymarket?.ceasefire?.yesPct ?? null;
  // Hormuz MOU Sunday deadline is PAST/DISABLED — do not warm this card off calendar.
  const lebanonRegime = input.theater?.eastAfricaCape?.regime;
  const dipHot = input.theater?.eastAfricaCape?.signals?.some(
    (s) => s.lit && s.status === "hot",
  );

  const catalysts: FroCatalystCard[] = [];

  catalysts.push(
    card({
      id: "hormuz_transits",
      label: "Hormuz transit collapse (PortWatch)",
      status: hormuzScore.status,
      read: hormuzScore.read,
      metric: hormuzScore.metric,
      bookHint: hormuzScore.status === "hot" ? "hold" : "watch",
      source: input.chokepoints?.source ?? "IMF PortWatch",
      priority: 1,
    }),
  );

  const tt = input.ttFlow?.latest ?? null;
  catalysts.push(
    card({
      id: "tt_hormuz_flow",
      label: "Hormuz crude flow (TankerTrackers)",
      status:
        tt != null && tt.bpdMillions <= 4
          ? "hot"
          : tt != null && tt.bpdMillions <= 6
            ? "warm"
            : tt != null
              ? "quiet"
              : "unknown",
      read:
        tt != null
          ? `TT ${tt.windowLabel}: ~${tt.bpdMillions.toFixed(1)}M bpd via blockade line${tt.hormuzMbpd != null ? ` (${tt.hormuzMbpd.toFixed(1)}M through Hormuz)` : ""}. Live AIS research — not IMF transit counts.`
          : "TankerTrackers Hormuz flow unavailable — check t.me/tankerTrackers.",
      metric:
        tt != null
          ? `${tt.asOfDate ?? "—"} · ~${tt.bpdMillions.toFixed(1)}M bpd`
          : null,
      bookHint: tt != null && tt.bpdMillions <= 5 ? "hold" : "watch",
      source: "TankerTrackers Telegram",
      priority: 2,
    }),
  );

  catalysts.push(
    card({
      id: "physical_confirm",
      label: "TD3C + BDTI physical confirmation",
      status:
        physicalGap === "confirmed"
          ? "hot"
          : physicalGap === "diverging"
            ? "warm"
            : physicalGap === "lagging"
              ? "warm"
              : "unknown",
      read: physicalGapRead,
      metric:
        td3c?.worldscale != null
          ? `TD3C WS ${td3c.worldscale}${td3c.lagDays != null ? ` · lag ${td3c.lagDays}d` : ""} · BDTI 5d ${input.bdti?.changePct5d != null ? `${input.bdti.changePct5d >= 0 ? "+" : ""}${input.bdti.changePct5d.toFixed(1)}%` : "—"}`
          : input.bdti?.latest
            ? `BDTI ${input.bdti.latest.value} · 5d ${input.bdti.changePct5d != null ? `${input.bdti.changePct5d >= 0 ? "+" : ""}${input.bdti.changePct5d.toFixed(1)}%` : "—"}`
            : null,
      bookHint:
        physicalGap === "confirmed"
          ? "hold"
          : physicalGap === "diverging"
            ? "watch"
            : "hold",
      source: "Baltic reprint + StockQ BDTI",
      priority: 2,
    }),
  );

  catalysts.push(
    card({
      id: "hormuz_escalation",
      label: "Hormuz military re-escalation / fee path",
      status:
        hormuzDisruption?.realityPct != null && hormuzDisruption.realityPct >= 55
          ? "hot"
          : hormuzDisruption?.edgePp != null && hormuzDisruption.edgePp > 8
            ? "warm"
            : "quiet",
      read:
        hormuzDisruption?.verdict ??
        "Watch fee / IRGC seizure / kinetic Hormuz headlines — MOU Sunday deadline is PAST/DISABLED; tanker orbits alone do not pay $46c.",
      metric:
        hormuzDisruption != null
          ? `Reality ${hormuzDisruption.realityPct ?? "—"}% · Market ${hormuzDisruption.marketPct ?? "—"}% · edge ${hormuzDisruption.edgePp != null ? `${hormuzDisruption.edgePp >= 0 ? "+" : ""}${hormuzDisruption.edgePp.toFixed(0)}pp` : "—"}`
          : null,
      bookHint: "hold",
      source: "Market Surprise (MOU calendar arm DISABLED)",
      priority: 3,
    }),
  );

  catalysts.push(
    card({
      id: "deal_crush",
      label: "Deal / ceasefire crush (IV risk)",
      status:
        feeFree?.edgePp != null && feeFree.edgePp <= -40
          ? "bearish"
          : input.deal?.actionBias === "trim"
            ? "bearish"
            : ceasefireYes != null && ceasefireYes >= 88
              ? "warm"
              : "quiet",
      read:
        feeFree?.verdict ??
        input.deal?.read ??
        (ceasefireYes != null
          ? `Polymarket ceasefire ~${ceasefireYes.toFixed(0)}% — market can sell crisis on any headline deal.`
          : "Monitor fee-free / US blink / signature alarms."),
      metric:
        feeFree != null
          ? `Fee-free edge ${feeFree.edgePp != null ? `${feeFree.edgePp >= 0 ? "+" : ""}${feeFree.edgePp.toFixed(0)}pp` : "—"} · ceasefire ${ceasefireYes != null ? `${ceasefireYes.toFixed(0)}%` : "—"}`
          : ceasefireYes != null
            ? `Ceasefire yes ${ceasefireYes.toFixed(0)}%`
            : null,
      bookHint:
        feeFree?.edgePp != null && feeFree.edgePp <= -40
          ? "trim"
          : input.deal?.actionBias === "trim"
            ? "trim"
            : "watch",
      source: "Deal alarm + Polymarket + Market Surprise",
      priority: 4,
    }),
  );

  catalysts.push(
    card({
      id: "cape_diversion",
      label: "Cape diversion (PortWatch proxy)",
      status: capeScore.status,
      read: capeScore.read,
      metric: capeScore.metric,
      bookHint: capeScore.status === "warm" ? "hold" : "watch",
      source: "IMF PortWatch chokepoint7",
      priority: 5,
    }),
  );

  catalysts.push(
    card({
      id: "merchant_incident",
      label: "Merchant hull / seizure headline",
      status: input.deal?.events.some(
        (e) =>
          e.kind === "black_sea_spillover" ||
          e.kind === "war_risk_spike" ||
          /seiz|board|hull|tanker/i.test(e.title),
      )
        ? "hot"
        : "quiet",
      read: input.deal?.events.find((e) =>
        /seiz|board|hull|tanker|war.risk/i.test(e.title),
      )?.read ??
        "No fresh IRGC seizure / hull-hit alarm in deal watch window — one incident reprices faster than diplomacy.",
      metric: input.deal?.events.length
        ? `${input.deal.events.length} deal-window event(s) · level ${input.deal.level}`
        : null,
      bookHint: input.deal?.events.some((e) => e.action === "hold") ? "hold" : "watch",
      source: "Deal alarm RSS",
      priority: 6,
    }),
  );

  catalysts.push(
    card({
      id: "fro_lottery_edge",
      label: "Sep $46c crisis lottery edge",
      status:
        froLottery?.edgePp != null && froLottery.edgePp >= 20
          ? "hot"
          : froLottery?.edgePp != null && froLottery.edgePp >= 8
            ? "warm"
            : froLottery?.edgePp != null && froLottery.edgePp <= -8
              ? "bearish"
              : "quiet",
      read:
        froLottery?.verdict ??
        "Market Surprise fro_46c_lottery thesis unavailable this run.",
      metric:
        froLottery != null
          ? `Reality ${froLottery.realityPct ?? "—"}% · Market ${froLottery.marketPct ?? "—"}% · edge ${froLottery.edgePp != null ? `${froLottery.edgePp >= 0 ? "+" : ""}${froLottery.edgePp.toFixed(0)}pp` : "—"}`
          : null,
      bookHint:
        froLottery?.edgePp != null && froLottery.edgePp >= 20
          ? "hold"
          : froLottery?.edgePp != null && froLottery.edgePp <= -8
            ? "trim"
            : "hold",
      source: "Market Surprise + options-implied",
      priority: 7,
    }),
  );

  catalysts.push(
    card({
      id: "lebanon_redsea",
      label: "Lebanon / Red Sea freight spillover",
      status:
        lebanonRegime === "hot" || dipHot
          ? "warm"
          : lebanonRegime === "forming"
            ? "quiet"
            : "quiet",
      read:
        input.theater?.eastAfricaCape?.read ??
        "East Africa / Bab / Lebanon freight watch — second-order for FRO unless Gulf shipping stops.",
      metric: input.theater?.eastAfricaCape?.regime ?? null,
      bookHint: "watch",
      source: "Theater eastAfricaCape",
      priority: 8,
    }),
  );

  catalysts.sort((a, b) => a.priority - b.priority);

  let regime: FroCatalystRegime = "stall";
  if (
    catalysts.some(
      (c) =>
        c.id === "deal_crush" &&
        (c.status === "bearish" || c.bookHint === "trim"),
    ) &&
    catalysts.find((c) => c.id === "physical_confirm")?.status !== "hot"
  ) {
    regime = "deal_crush";
  } else if (
    hormuzScore.status === "hot" &&
    (physicalGap === "confirmed" || physicalGap === "lagging")
  ) {
    regime = "catastrophe";
  } else if (physicalGap === "confirmed") {
    regime = "physical_confirm";
  } else if (
    hormuzScore.status !== "quiet" ||
    catalysts.find((c) => c.id === "hormuz_escalation")?.status === "hot"
  ) {
    regime = "forming";
  }

  const regimeLabels: Record<FroCatalystRegime, string> = {
    stall: "Messy stall — fear without full rates",
    forming: "Catastrophe forming — shipping stress building",
    physical_confirm: "Physical confirming — rates catching headlines",
    catastrophe: "Shipping emergency — hold lottery stubs",
    deal_crush: "Deal-crush risk — IV / Polymarket overhang",
  };

  const trimVotes = catalysts.filter((c) => c.bookHint === "trim").length;
  const holdVotes = catalysts.filter(
    (c) => c.bookHint === "hold" && c.lit,
  ).length;

  let bookAction: FroBookAction = "hold";
  let bookSummary =
    "HOLD Sep $46c stubs — insurance against physical lag; do not add on KC orbits alone.";
  if (trimVotes >= 2) {
    bookAction = "trim";
    bookSummary =
      "TRIM bias — deal path + market ahead on ceasefire/fee; consider 1–2 stubs if headline deal lands.";
  } else if (
    regime === "catastrophe" ||
    (physicalGap === "confirmed" && froLottery?.edgePp != null && froLottery.edgePp >= 15)
  ) {
    bookAction = "hold";
    bookSummary =
      "HOLD all stubs — physical + chokepoint stack aligning; lottery edge still positive.";
  } else if (physicalGap === "diverging" && regime === "stall") {
    bookAction = "watch";
    bookSummary =
      "WATCH — slow bleed risk while TD3C lags; keep stubs but do not size up without rate prints.";
  } else if (holdVotes >= 3) {
    bookAction = "hold";
    bookSummary =
      "HOLD — multiple bullish catalysts lit; tail alive despite Polymarket peace pricing.";
  }

  const verdictParts: string[] = [regimeLabels[regime], physicalGapRead];
  if (froLottery?.edgePp != null && froLottery.edgePp >= 15) {
    verdictParts.push(
      `Market underprices Sep $46c lottery by ~${froLottery.edgePp.toFixed(0)}pp.`,
    );
  }
  if (ceasefireYes != null && ceasefireYes >= 85) {
    verdictParts.push(
      `Polymarket ceasefire ~${ceasefireYes.toFixed(0)}% caps rallies unless shipping breaks.`,
    );
  }

  const watchNext = [
    "IRGC / US incident in Hormuz (seizure → second seizure)",
    "Iran operational strait closure headline + transit stay ≤10/day",
    "Next TD3C / BDTI print jumps ≥20% week-on-week",
    "Trump–Oman–Iran partial reopen or fee deal (trim trigger)",
    "FRO +5% on oil with $46c flat (gamma sell-the-news — do not add)",
  ];

  const actionMap: FroCatalystReport["actionMap"] = [
    {
      trigger: "Hormuz transit ≤10/day + new seizure or strike",
      action: "Hold all 4 stubs — tail getting real",
    },
    {
      trigger: "TD3C/BDTI spike on next print",
      action: "Hold — physical finally confirming",
    },
    {
      trigger: "Hormuz deal progressing + VLCCs moving",
      action: "Trim 1–2 stubs",
    },
    {
      trigger: "FRO +5% on oil, $46c flat/down",
      action: "Do not add — sell-the-news / long gamma",
    },
    {
      trigger: "Lebanon only, Hormuz quiet, TD3C flat",
      action: "Insurance bleed — stubs OK, not an add",
    },
  ];

  const gaps: string[] = [
    "IMF PortWatch lags live AIS ~3–7 days — use MarineTraffic for same-day Hormuz.",
    "No free live Baltic TD3C FFA — weekly reprint only.",
    "FRO catalyst stack does not score Israel AER High-go — aerial orbits are context only.",
  ];
  if (!input.chokepoints?.hormuz.latest) {
    gaps.push("PortWatch Hormuz unavailable this run.");
  }
  if (!td3c?.worldscale) {
    gaps.push("TD3C WS print missing — physical card may be stale.");
  }
  if (!tt) {
    gaps.push(
      "TankerTrackers Hormuz flow not parsed — t.me/tankerTrackers posts ~weekly 7d averages.",
    );
  }

  const td34 = td3c?.relatedRoutes?.find((r) => r.code === "TD34") ?? null;

  return {
    asOf,
    regime,
    regimeLabel: regimeLabels[regime],
    verdict: verdictParts.join(" · "),
    bookAction,
    bookSummary,
    physicalGap,
    physicalGapRead,
    catalysts,
    watchNext,
    actionMap,
    gaps,
    inputs: {
      hormuzDate: input.chokepoints?.hormuz.latest?.date ?? null,
      hormuzTotal: input.chokepoints?.hormuz.latest?.nTotal ?? null,
      hormuzTanker: input.chokepoints?.hormuz.latest?.nTanker ?? null,
      hormuzLagDays: input.chokepoints?.dataLagDays ?? null,
      td3cWs: td3c?.worldscale ?? null,
      td3cLagDays: td3c?.lagDays ?? null,
      bdti5dPct: input.bdti?.changePct5d ?? null,
      dealLevel: input.deal?.level ?? null,
      ceasefireYesPct: ceasefireYes,
      froLotteryEdgePp: froLottery?.edgePp ?? null,
      portwatchLagNote: input.chokepoints?.lagNote ?? "PortWatch ~3–7d lag",
      bdtiDate: input.bdti?.latest?.date ?? null,
      bdtiLagDays: input.bdti?.lagDays ?? null,
      td3cAsOf: td3c?.asOfIso ?? td3c?.asOfLabel ?? null,
      ttFlowMbpd: tt?.bpdMillions ?? null,
      ttFlowHormuzMbpd: tt?.hormuzMbpd ?? null,
      ttFlowDate: tt?.asOfDate ?? null,
      ttFlowLagDays: tt?.lagDays ?? null,
      ttFlowWindow: tt?.windowLabel ?? null,
      td34Ws: td34?.worldscale ?? null,
      td34Tce: td34?.tceUsdPerDay ?? null,
    },
  };
}

const FRO_CATALYST_CACHE_MS = 90_000;
let froCatalystCache: { at: number; report: FroCatalystReport } | null = null;

function hydrateFroLastGood(): void {
  if (froCatalystCache) return;
  const disk = readLastGood<FroCatalystReport>("fro-catalyst");
  if (disk) froCatalystCache = { at: disk.at, report: disk.value };
}

function getPriorFroInputs(): FroCatalystReport["inputs"] | null {
  hydrateFroLastGood();
  return froCatalystCache?.report?.inputs ?? readLastGood<FroCatalystReport>("fro-catalyst")?.value?.inputs ?? null;
}

/** Keep TD3C/TD34 from physical last-good when a live scrape returns no WS print. */
function coalescePhysical(fresh: PhysicalMarkets | null): PhysicalMarkets | null {
  const lg = getLastGoodPhysicalMarkets();
  if (!fresh) return lg;
  if (fresh.vlccTd3c?.worldscale != null) return fresh;
  if (!lg?.vlccTd3c?.worldscale) return fresh;
  return {
    ...fresh,
    vlccTd3c: {
      ...fresh.vlccTd3c,
      ...lg.vlccTd3c,
      relatedRoutes: lg.vlccTd3c.relatedRoutes?.length
        ? lg.vlccTd3c.relatedRoutes
        : fresh.vlccTd3c.relatedRoutes,
    },
  };
}

/** Rehydrate PortWatch metrics from the last fro-catalyst snapshot when ArcGIS is slow/down. */
function synthesizeChokepointsFromPrior(
  prior: FroCatalystReport["inputs"] | null,
): ChokepointTransitsReport | null {
  if (
    !prior?.hormuzDate ||
    prior.hormuzTotal == null ||
    prior.hormuzTanker == null
  ) {
    return null;
  }
  const day: ChokepointSeries["latest"] = {
    date: prior.hormuzDate,
    nTotal: prior.hormuzTotal,
    nTanker: prior.hormuzTanker,
    nCargo: 0,
    nContainer: 0,
    nDryBulk: 0,
  };
  const series = (id: string, name: string, portid: string): ChokepointSeries => ({
    id,
    name,
    portid,
    latest: id === "hormuz" ? day : null,
    prev: null,
    changePct7d: null,
    avg7d: null,
    avg30d: null,
    points: id === "hormuz" ? [day!] : [],
    note: "Rehydrated from fro-catalyst last-good — live PortWatch fetch unavailable this run.",
  });
  return {
    asOf: new Date().toISOString(),
    dataAsOf: prior.hormuzDate,
    dataLagDays: prior.hormuzLagDays,
    source: "IMF PortWatch Daily_Chokepoints_Data (last-good rehydrate)",
    portal: "https://portwatch.imf.org/",
    lagNote: prior.portwatchLagNote,
    hormuz: series("hormuz", "Strait of Hormuz", "chokepoint6"),
    bab: series("bab", "Bab el-Mandeb Strait", "chokepoint4"),
    cape: series("cape", "Cape of Good Hope", "chokepoint7"),
    read: "PortWatch live fetch failed — serving Hormuz print from fro-catalyst last-good.",
    deepLinks: [],
  };
}

function emptyFroCatalyst(): FroCatalystReport {
  hydrateFroLastGood();
  const cached = froCatalystCache?.report;
  if (cached?.inputs?.td3cWs != null || cached?.inputs?.hormuzTotal != null) {
    return cached;
  }
  const prior = getPriorFroInputs();
  return buildFroCatalystFromInputs({
    chokepoints: synthesizeChokepointsFromPrior(prior),
    physical: getLastGoodPhysicalMarkets(),
    bdti: null,
    deal: null,
    surprise: null,
    theater: getLastGoodTheaterWatch(),
    politics: buildPoliticsCalendarChip(),
  });
}

export async function buildFroCatalyst(opts?: {
  force?: boolean;
}): Promise<FroCatalystReport> {
  const force = opts?.force === true;
  hydrateFroLastGood();
  return serveLastGood({
    flightKey: force ? "buildFroCatalyst:force" : "buildFroCatalyst",
    force,
    freshTtlMs: FRO_CATALYST_CACHE_MS,
    label: "fro-catalyst",
    persistKey: "fro-catalyst",
    get: () =>
      froCatalystCache
        ? { value: froCatalystCache.report, at: froCatalystCache.at }
        : null,
    set: (snap) => {
      froCatalystCache = { at: snap.at, report: snap.value };
    },
    build: () => rebuildFroCatalyst(force),
    empty: emptyFroCatalyst,
  });
}

async function rebuildFroCatalyst(force: boolean): Promise<FroCatalystReport> {
  const priorInputs = getPriorFroInputs();
  const [chokeS, physicalS, bdtiS, ttS] = await Promise.allSettled([
    fetchChokepointTransits(),
    getPhysicalMarkets({ force }),
    fetchBdtiSeries(),
    fetchTankerTrackersFlow(),
  ]);

  // Never block FRO on a theater rebuild — last-good theater, kick warm in background.
  const theater: TheaterWatch | null = getLastGoodTheaterWatch();
  void buildTheaterWatch().catch(() => undefined);

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

  let surprise: MarketSurprise | null = getLastMarketSurprise();
  if (force || !surprise) {
    if (theater) {
      try {
        const footprint = await buildDecisionFootprint({
          theater,
          deal,
          intel,
        });
        surprise = await buildMarketSurprise({
          theater,
          deal,
          intel,
          footprint,
        });
      } catch {
        /* partial report */
      }
    }
  }

  let chokepoints =
    chokeS.status === "fulfilled" ? chokeS.value : null;
  if (!chokepoints?.hormuz?.latest) {
    chokepoints = synthesizeChokepointsFromPrior(priorInputs) ?? chokepoints;
  }

  const report = buildFroCatalystFromInputs({
    chokepoints,
    physical: coalescePhysical(
      physicalS.status === "fulfilled" ? physicalS.value : null,
    ),
    bdti: bdtiS.status === "fulfilled" ? bdtiS.value : null,
    ttFlow: ttS.status === "fulfilled" ? ttS.value : null,
    deal,
    surprise,
    theater,
    politics: theater?.politicsCalendar ?? buildPoliticsCalendarChip(),
  });
  froCatalystCache = { at: Date.now(), report };
  return report;
}
