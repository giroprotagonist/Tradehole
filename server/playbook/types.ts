export type PlaybookAction = "hold" | "trim" | "watch" | "add" | "none";

export type PlaybookAccountHint = "etrade" | "robinhood" | "either";

export type PlaybookFocus = {
  symbol: string;
  expiry: string;
  strike: number;
  callPut: "call" | "put";
};

export type PlaybookConfig = {
  book: "lottery";
  focus: PlaybookFocus;
  gates: {
    maxSpreadPct: number;
    maxWidth: number;
    maxAddQty: number;
    maxTrimQty: number;
    maxDebitPerDay: number;
    rthOnlyForAdd: boolean;
  };
  thresholds: {
    lotteryHoldEdgePp: number;
    lotteryTrimEdgePp: number;
    feeFreeTrimEdgePp: number;
    dfHoldBands: string[];
  };
  notes?: string;
};

export type ResolverInput = {
  fro: {
    regime: string;
    bookAction: string;
    physicalGap: string;
    froLotteryEdgePp: number | null;
    stale?: boolean;
  };
  df: {
    score: number;
    band: string;
  };
  ms: {
    feeFreeEdgePp: number | null;
    lotteryEdgePp: number | null;
  };
  strategy: {
    action: string;
  };
  deal: {
    actionBias: string;
    level: string;
  };
  intel: {
    level: string;
  };
  israel: {
    froGuidance: string;
    scenario: string;
  };
  focus46cTotal: number;
};

export type ResolvedAction = {
  action: PlaybookAction;
  reasons: string[];
  invalidation: string;
  conflict: boolean;
  addVetoed: boolean;
  vetoReasons: string[];
  quantity: number;
  orderAction: "BUY_OPEN" | "SELL_CLOSE" | null;
};

export type QualityGateResult = {
  ok: boolean;
  blockedBy: string[];
  spreadPct: number | null;
  width: number | null;
  inRth: boolean;
  debitToday: number;
};

export type TradeProposal = {
  id: string;
  asOf: string;
  book: "lottery";
  action: PlaybookAction;
  contract: PlaybookFocus;
  quantity: number;
  orderAction: "BUY_OPEN" | "SELL_CLOSE" | null;
  accountHint: PlaybookAccountHint;
  reasons: string[];
  invalidation: string;
  sources: {
    fro?: string;
    df?: string;
    ms?: string;
    strategy?: string;
    deal?: string;
    intel?: string;
    israel?: string;
  };
  gates: QualityGateResult;
  conflict: boolean;
  status: "open" | "accepted" | "rejected" | "snoozed" | "expired" | "accepted_manual";
  limitPriceHint: number | null;
};

export type ProposalDecision = {
  decision: "accepted" | "rejected" | "snoozed" | "accepted_manual";
  note?: string;
  orderId?: string;
  fillPrice?: number;
  pnl?: number;
};
