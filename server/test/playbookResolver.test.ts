import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveLotteryAction, loadFroLotteryConfig } from "../playbook/actionResolver";
import type { ResolverInput } from "../playbook/types";

const config = loadFroLotteryConfig();

function base(over: Partial<ResolverInput> = {}): ResolverInput {
  const b: ResolverInput = {
    fro: {
      regime: "forming",
      bookAction: "hold",
      physicalGap: "lagging",
      froLotteryEdgePp: 5,
    },
    df: { score: 38, band: "talks_deteriorating" },
    ms: { feeFreeEdgePp: 5, lotteryEdgePp: 5 },
    strategy: { action: "hold" },
    deal: { actionBias: "watch", level: "quiet" },
    intel: { level: "green" },
    israel: {
      froGuidance: "no Israel-strike pre-launch stack — hold baseline",
      scenario: "quiet",
    },
    focus46cTotal: 5,
  };
  return {
    ...b,
    ...over,
    fro: { ...b.fro, ...(over.fro ?? {}) },
    df: { ...b.df, ...(over.df ?? {}) },
    ms: { ...b.ms, ...(over.ms ?? {}) },
    strategy: { ...b.strategy, ...(over.strategy ?? {}) },
    deal: { ...b.deal, ...(over.deal ?? {}) },
    intel: { ...b.intel, ...(over.intel ?? {}) },
    israel: { ...b.israel, ...(over.israel ?? {}) },
  };
}

describe("resolveLotteryAction", () => {
  it("HOLDs on catastrophe even when deal wants trim", () => {
    const r = resolveLotteryAction(
      base({
        fro: { regime: "catastrophe", bookAction: "hold", physicalGap: "lagging", froLotteryEdgePp: 0 },
        deal: { actionBias: "trim", level: "trim" },
      }),
      config,
    );
    assert.equal(r.action, "hold");
    assert.equal(r.conflict, true);
    assert.equal(r.addVetoed, true);
  });

  it("TRIMs on fee-free edge when not catastrophe", () => {
    const r = resolveLotteryAction(
      base({
        ms: { feeFreeEdgePp: 30, lotteryEdgePp: 0 },
        fro: { regime: "stall", bookAction: "watch", physicalGap: "unknown", froLotteryEdgePp: 0 },
      }),
      config,
    );
    assert.equal(r.action, "trim");
    assert.ok(r.quantity >= 1 && r.quantity <= 2);
    assert.equal(r.orderAction, "SELL_CLOSE");
  });

  it("vetoes ADD on intel RED and falls back to HOLD when strategy says add", () => {
    const r = resolveLotteryAction(
      base({
        intel: { level: "red" },
        strategy: { action: "add" },
        fro: { regime: "stall", bookAction: "watch", physicalGap: "lagging", froLotteryEdgePp: 0 },
      }),
      config,
    );
    assert.equal(r.action, "hold");
    assert.equal(r.addVetoed, true);
    assert.equal(r.conflict, true);
  });

  it("Allows ADD when strategy add and no veto", () => {
    const r = resolveLotteryAction(
      base({
        strategy: { action: "add" },
        israel: { froGuidance: "IGNORE aerial noise", scenario: "false_flag" },
        fro: { regime: "stall", bookAction: "watch", physicalGap: "lagging", froLotteryEdgePp: 0 },
      }),
      config,
    );
    assert.equal(r.action, "add");
    assert.equal(r.orderAction, "BUY_OPEN");
    assert.equal(r.quantity, 1);
  });

  it("HOLDs when lottery edge is strong", () => {
    const r = resolveLotteryAction(
      base({
        ms: { feeFreeEdgePp: 0, lotteryEdgePp: 22 },
        fro: { regime: "forming", bookAction: "hold", physicalGap: "lagging", froLotteryEdgePp: 22 },
      }),
      config,
    );
    assert.equal(r.action, "hold");
  });
});
