import type { PlaybookConfig, ResolvedAction, ResolverInput } from "./types";
import froLotteryJson from "./froLottery.json";

export function loadFroLotteryConfig(): PlaybookConfig {
  return froLotteryJson as PlaybookConfig;
}

function israelBlocksAdd(guidance: string, scenario: string): boolean {
  const g = guidance.toLowerCase();
  if (/\bignore\b/.test(g)) return false;
  if (scenario === "high_confidence_go" || scenario === "medium_confidence") {
    return true;
  }
  return /\bhold\b|\bwatch\b/.test(g);
}

/**
 * Merge fro-catalyst / DF / MS / strategy / deal / intel / Israel into one action.
 * Pure — unit-testable without live APIs.
 */
export function resolveLotteryAction(
  input: ResolverInput,
  config: PlaybookConfig,
): ResolvedAction {
  const reasons: string[] = [];
  const vetoReasons: string[] = [];
  let conflict = false;
  let addVetoed = false;

  const froAction = input.fro.bookAction;
  const dealBias = input.deal.actionBias;
  const lotteryEdge =
    input.ms.lotteryEdgePp ?? input.fro.froLotteryEdgePp ?? null;
  const feeFreeEdge = input.ms.feeFreeEdgePp;
  const regime = input.fro.regime;
  const catastrophe = regime === "catastrophe";
  const physicalConfirm =
    regime === "physical_confirm" || input.fro.physicalGap === "confirmed";

  if (israelBlocksAdd(input.israel.froGuidance, input.israel.scenario)) {
    addVetoed = true;
    vetoReasons.push(
      `Israel guidance blocks ADD (${input.israel.scenario || "desk"} · ${input.israel.froGuidance.slice(0, 80)})`,
    );
  }
  if (input.intel.level === "red") {
    addVetoed = true;
    vetoReasons.push("5-Lock RED — ADD vetoed (HOLD/watch only)");
  }
  if (froAction === "trim") {
    addVetoed = true;
    vetoReasons.push("Fro-catalyst bookAction=trim — ADD vetoed");
  }
  if (dealBias === "trim") {
    addVetoed = true;
    vetoReasons.push("Deal-alarm actionBias=trim — ADD vetoed");
  }
  if (input.fro.stale || input.fro.physicalGap === "unknown") {
    addVetoed = true;
    vetoReasons.push("Physical/intel stale or unknown — ADD vetoed");
  }

  const wantTrimFromFro = froAction === "trim";
  const wantTrimFromDeal = dealBias === "trim";
  const wantTrimFromFee =
    feeFreeEdge != null &&
    feeFreeEdge >= config.thresholds.feeFreeTrimEdgePp &&
    !catastrophe;
  const wantTrimFromLottery =
    lotteryEdge != null &&
    lotteryEdge <= config.thresholds.lotteryTrimEdgePp &&
    !catastrophe;

  const wantHoldCatastrophe = catastrophe;
  const wantHoldPhysical = physicalConfirm;
  const wantHoldLottery =
    lotteryEdge != null && lotteryEdge >= config.thresholds.lotteryHoldEdgePp;
  const wantHoldDf =
    config.thresholds.dfHoldBands.includes(input.df.band) &&
    dealBias !== "trim" &&
    froAction !== "trim";

  const wantWatch =
    (input.fro.physicalGap === "diverging" && regime === "stall") ||
    froAction === "watch";

  const wantAdd = input.strategy.action === "add" && !addVetoed;

  // Catastrophe wins over trim chatter.
  if (wantHoldCatastrophe) {
    if (wantTrimFromFro || wantTrimFromDeal || wantTrimFromFee) {
      conflict = true;
      reasons.push(
        "Trim signals present but regime=catastrophe — HOLD lottery stubs",
      );
    } else {
      reasons.push("Fro-catalyst regime=catastrophe — HOLD insurance stubs");
    }
    return finish(
      "hold",
      reasons,
      "Trim if fee-free deal / reopen prints or physical collapse unwinds",
      conflict,
      addVetoed,
      vetoReasons,
      input.focus46cTotal,
      config,
    );
  }

  if (wantTrimFromFro || wantTrimFromDeal || wantTrimFromFee || wantTrimFromLottery) {
    if (wantHoldLottery || wantHoldDf || wantHoldPhysical) {
      conflict = true;
      reasons.push("Hold and trim sources disagree — TRIM bias from deal/fee path");
    }
    if (wantTrimFromFro) reasons.push("Fro-catalyst bookAction=trim");
    if (wantTrimFromDeal) reasons.push(`Deal-alarm trim (${input.deal.level})`);
    if (wantTrimFromFee) {
      reasons.push(
        `Fee-free edge +${feeFreeEdge!.toFixed(0)}pp ≥ ${config.thresholds.feeFreeTrimEdgePp} — blink/TRIM path underpriced`,
      );
    }
    if (wantTrimFromLottery) {
      reasons.push(
        `Lottery edge ${lotteryEdge!.toFixed(0)}pp ≤ ${config.thresholds.lotteryTrimEdgePp} — market ahead on crisis`,
      );
    }
    return finish(
      "trim",
      reasons,
      "Abort trim if Hormuz transit collapses further or seizure/hull hit prints",
      conflict,
      addVetoed,
      vetoReasons,
      input.focus46cTotal,
      config,
    );
  }

  if (wantHoldPhysical || wantHoldLottery || wantHoldDf || froAction === "hold") {
    if (wantHoldPhysical) reasons.push("Physical confirm / fro physical gap confirmed");
    if (wantHoldLottery) {
      reasons.push(
        `Lottery edge +${lotteryEdge!.toFixed(0)}pp ≥ ${config.thresholds.lotteryHoldEdgePp}`,
      );
    }
    if (wantHoldDf) {
      reasons.push(`Decision Footprint band=${input.df.band} (score ${input.df.score})`);
    }
    if (froAction === "hold" && reasons.length === 0) {
      reasons.push("Fro-catalyst bookAction=hold");
    }
    if (wantAdd) {
      conflict = true;
      reasons.push("Strategy-intel ADD subordinated to HOLD bias");
    }
    return finish(
      "hold",
      reasons,
      "Invalidation: deal crush / fee-free blink / ceasefire melt-up without shipping break",
      conflict,
      addVetoed,
      vetoReasons,
      input.focus46cTotal,
      config,
    );
  }

  if (wantAdd) {
    reasons.push("Strategy-intel action=add and no hard veto");
    return finish(
      "add",
      reasons,
      "Cancel if spread widens, fro flips trim, or physical goes unknown",
      conflict,
      addVetoed,
      vetoReasons,
      input.focus46cTotal,
      config,
    );
  }

  if (addVetoed && input.strategy.action === "add") {
    reasons.push(...vetoReasons);
    reasons.push("Strategy wanted ADD but vetoed — default HOLD");
    return finish(
      "hold",
      reasons,
      "Re-check when Israel/intel/deal vetoes clear",
      true,
      addVetoed,
      vetoReasons,
      input.focus46cTotal,
      config,
    );
  }

  if (wantWatch) {
    reasons.push(
      input.fro.physicalGap === "diverging"
        ? "Physical gap diverging — WATCH, do not add"
        : "Fro-catalyst bookAction=watch",
    );
    return finish(
      "watch",
      reasons,
      "Upgrade to HOLD on physical confirm; trim on deal crush",
      conflict,
      addVetoed,
      vetoReasons,
      input.focus46cTotal,
      config,
    );
  }

  reasons.push("No strong playbook signal — none");
  return finish(
    "none",
    reasons,
    "Wait for fro-catalyst / DF / deal shift",
    conflict,
    addVetoed,
    vetoReasons,
    input.focus46cTotal,
    config,
  );
}

function finish(
  action: ResolvedAction["action"],
  reasons: string[],
  invalidation: string,
  conflict: boolean,
  addVetoed: boolean,
  vetoReasons: string[],
  focus46cTotal: number,
  config: PlaybookConfig,
): ResolvedAction {
  let quantity = 0;
  let orderAction: ResolvedAction["orderAction"] = null;
  if (action === "add") {
    quantity = config.gates.maxAddQty;
    orderAction = "BUY_OPEN";
  } else if (action === "trim") {
    const held = Math.max(0, focus46cTotal);
    quantity = Math.min(
      config.gates.maxTrimQty,
      Math.max(1, Math.floor(held / 2)),
      held,
    );
    if (held <= 0) {
      quantity = 0;
      orderAction = null;
    } else {
      orderAction = "SELL_CLOSE";
    }
  }
  return {
    action,
    reasons: reasons.slice(0, 5),
    invalidation,
    conflict,
    addVetoed,
    vetoReasons,
    quantity,
    orderAction,
  };
}
