import { buildFroCatalyst } from "../analytics/froCatalyst";
import { getDecisionFootprint } from "../analytics/decisionFootprint";
import { getMarketSurprise } from "../analytics/marketSurprise";
import { buildStrategyIntel } from "../analytics/strategyIntel";
import { getLastIsraelStrikeTells } from "../analytics/israelStrikeTells";
import { getLatestDealAlarm } from "../dealAlarm";
import { getLatestIntelAlarm } from "../intelAlarm";
import { buildBookSummary } from "../bookSummary";
import { getLastGoodTheaterWatch } from "../theaterWatch";
import { loadFroLotteryConfig, resolveLotteryAction } from "./actionResolver";
import { evaluateQualityGates } from "./qualityGates";
import { debitUsedToday, insertProposal, newProposalId } from "./journal";
import type { ResolverInput, TradeProposal } from "./types";

function thesisEdge(
  surprise: Awaited<ReturnType<typeof getMarketSurprise>> | null,
  id: string,
): number | null {
  const t = surprise?.theses?.find((x) => x.id === id);
  return t?.edgePp ?? null;
}

export async function buildLotteryProposal(opts?: {
  force?: boolean;
}): Promise<TradeProposal> {
  const config = loadFroLotteryConfig();
  const force = opts?.force === true;

  const [fro, df, surprise, strategy] = await Promise.all([
    buildFroCatalyst({ force }),
    getDecisionFootprint({ force }),
    getMarketSurprise({ force }),
    buildStrategyIntel("FRO").catch(() => null),
  ]);

  const deal = getLatestDealAlarm();
  const intel = getLatestIntelAlarm();
  const israelSnap = getLastIsraelStrikeTells();
  const israel = israelSnap?.tells ?? null;
  const book = buildBookSummary();
  const theater = getLastGoodTheaterWatch();
  const focusQuote = theater?.focus46c
    ? {
        bid: theater.focus46c.bid ?? null,
        ask: theater.focus46c.ask ?? null,
        last: theater.focus46c.last ?? null,
      }
    : strategy?.focusPrints?.find(
        (p) => p.expiry === config.focus.expiry && p.strike === config.focus.strike,
      ) ?? null;

  const froStale =
    Boolean((fro as { stale?: boolean }).stale) ||
    fro.physicalGap === "unknown";

  const input: ResolverInput = {
    fro: {
      regime: fro.regime,
      bookAction: fro.bookAction,
      physicalGap: fro.physicalGap,
      froLotteryEdgePp: fro.inputs.froLotteryEdgePp,
      stale: froStale,
    },
    df: {
      score: df.score,
      band: df.band,
    },
    ms: {
      feeFreeEdgePp: thesisEdge(surprise, "fee_free_blink"),
      lotteryEdgePp:
        thesisEdge(surprise, "fro_46c_lottery") ?? fro.inputs.froLotteryEdgePp,
    },
    strategy: {
      action: strategy?.action.action ?? "unknown",
    },
    deal: {
      actionBias: deal?.actionBias ?? "none",
      level: deal?.level ?? "quiet",
    },
    intel: {
      level: intel?.level ?? "green",
    },
    israel: {
      froGuidance: israel?.froGuidance ?? "hold baseline",
      scenario: israel?.scenario ?? "unknown",
    },
    focus46cTotal: book.focus46cTotal,
  };

  const resolved = resolveLotteryAction(input, config);
  let action = resolved.action;
  let quantity = resolved.quantity;
  let orderAction = resolved.orderAction;
  const reasons = [...resolved.reasons];

  const debitToday = debitUsedToday();
  const gates = evaluateQualityGates({
    config,
    action,
    quote: focusQuote
      ? {
          bid: focusQuote.bid ?? null,
          ask: focusQuote.ask ?? null,
          last: "last" in focusQuote ? (focusQuote.last as number | null) : null,
        }
      : null,
    debitToday,
  });

  if (action === "add" && !gates.ok) {
    reasons.push(`ADD blocked by gates: ${gates.blockedBy.join("; ")}`);
    action = "hold";
    quantity = 0;
    orderAction = null;
  }

  if (action === "trim" && quantity <= 0) {
    reasons.push("TRIM signaled but no focus $46c inventory — advice only");
    orderAction = null;
  }

  const limitPriceHint =
    action === "add"
      ? (focusQuote?.ask ?? focusQuote?.last ?? null)
      : action === "trim"
        ? (focusQuote?.bid ?? focusQuote?.last ?? null)
        : null;

  const proposal: TradeProposal = {
    id: newProposalId(),
    asOf: new Date().toISOString(),
    book: "lottery",
    action,
    contract: { ...config.focus },
    quantity,
    orderAction,
    accountHint: action === "add" || action === "trim" ? "etrade" : "either",
    reasons: reasons.slice(0, 6),
    invalidation: resolved.invalidation,
    sources: {
      fro: `${fro.regime}/${fro.bookAction}`,
      df: `${df.band}:${df.score}`,
      ms: `fee=${input.ms.feeFreeEdgePp ?? "—"} lot=${input.ms.lotteryEdgePp ?? "—"}`,
      strategy: strategy?.action.action ?? "n/a",
      deal: `${deal?.level ?? "—"}/${deal?.actionBias ?? "—"}`,
      intel: intel?.level ?? "—",
      israel: israel?.scenario ?? "—",
    },
    gates,
    conflict: resolved.conflict,
    status: "open",
    limitPriceHint,
  };

  insertProposal(proposal);
  return proposal;
}
