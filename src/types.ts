export type StockQuote = {
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  bid: number | null;
  ask: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  volume: number | null;
  marketCap: number | null;
  currency: string | null;
  shortName: string | null;
  marketState: string | null;
  source: string;
  fetchedAt: string;
};

export type OptionContract = {
  contractSymbol: string;
  strike: number;
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  change: number | null;
  percentChange: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
  inTheMoney: boolean | null;
  type: "call" | "put";
};

export type OptionsChain = {
  symbol: string;
  underlyingPrice: number | null;
  expirationDates: string[];
  selectedExpiry: string | null;
  calls: OptionContract[];
  puts: OptionContract[];
  source: string;
  fetchedAt: string;
};

export type PositionRow = {
  symbolDescription: string;
  symbol: string;
  quantity: number;
  pricePaid: number | null;
  marketValue: number | null;
  totalCost: number | null;
  totalGain: number | null;
  totalGainPct: number | null;
  daysGain: number | null;
  daysGainPct: number | null;
  typeCode: string | null;
};

export type Portfolio = {
  accountIdKey: string;
  positions: PositionRow[];
  totals: {
    marketValue: number;
    totalCost: number;
    totalGain: number;
    daysGain: number;
  };
};

export type TermPoint = {
  expiry: string;
  dte: number;
  atmIv: number | null;
  callIv: number | null;
  putIv: number | null;
};

export type SmilePoint = {
  strike: number;
  callIv: number | null;
  putIv: number | null;
  moneyness: number | null;
};

export type VolatilityReport = {
  symbol: string;
  spot: number | null;
  selectedExpiry: string | null;
  dte: number | null;
  atmIv: number | null;
  atmCallIv: number | null;
  atmPutIv: number | null;
  atmStrike: number | null;
  skew: number | null;
  skewNote: string;
  hv20: number | null;
  hv30: number | null;
  ivMinusHv20: number | null;
  ivRank: number | null;
  ivPercentile: number | null;
  snapshotCount: number;
  snapshotDays: number;
  positionFocus: {
    strike: number;
    type: "call" | "put";
    expiry: string | null;
    iv: number | null;
    moneyness: number | null;
    contractSymbol: string | null;
  } | null;
  termStructure: TermPoint[];
  smile: SmilePoint[];
  fetchedAt: string;
};

export type PhysicalMarkets = {
  brent: {
    eiaEuropeBrentSpot: {
      price: number | null;
      asOf: string | null;
      source: string;
      note: string;
    };
    brentFutures: StockQuote | null;
    spotMinusFutures: number | null;
    wtiFutures: StockQuote | null;
  };
  vlccTd3c: {
    worldscale: number | null;
    tceUsdPerDay: number | null;
    asOfLabel: string | null;
    sourceUrl: string | null;
    sourceTitle: string | null;
    excerpt: string | null;
    route: string;
    note: string;
  };
  fetchedAt: string;
  caveats: string[];
};

export type EtradeStatus = {
  configured: boolean;
  authorized: boolean;
  env: string;
  authorizedAt: string | null;
  apiBase: string;
};

export type TradingStatus = {
  enabled: boolean;
  previewTtlSeconds: number;
  defaults: {
    symbol: string;
    strike: number;
    expiry: string;
    callPut: "CALL";
    orderAction: "BUY_OPEN";
    quantity: number;
    priceType: "LIMIT";
    orderTerm: string;
    marketSession: string;
  };
};

export type OrderPreview = {
  previewToken: string;
  confirmPhrase: string;
  summary: string;
  previewId: string;
  clientOrderId: string;
  accountIdKey: string;
  totalOrderValue: number | null;
  estimatedCommission: number | null;
  estimatedTotalAmount: number | null;
  symbolDescription: string | null;
  messages: Array<{ type: string; code: number | null; description: string }>;
  expiresAt: string;
  env: string;
};

export type OrderPlaceResult = {
  ok: true;
  orderId: string | null;
  orderType: string | null;
  symbolDescription: string | null;
  summary: string;
  accountIdKey: string;
};

export type BrokerOrder = {
  orderId: string;
  orderType: string | null;
  status: string;
  orderValue: number | null;
  placedTime: string | null;
  executedTime: string | null;
  priceType: string | null;
  limitPrice: number | null;
  stopPrice: number | null;
  stopLimitPrice: number | null;
  offsetValue: number | null;
  orderTerm: string | null;
  marketSession: string | null;
  allOrNone: boolean | null;
  symbol: string | null;
  symbolDescription: string | null;
  osiKey: string | null;
  orderAction: string | null;
  quantity: number | null;
  orderedQuantity: number | null;
  filledQuantity: number | null;
  cancelQuantity: number | null;
  averageExecutionPrice: number | null;
  callPut: string | null;
  strikePrice: number | null;
  expiry: string | null;
  estimatedCommission: number | null;
  estimatedTotalAmount: number | null;
  messages: Array<{ type: string; code: number | null; description: string }>;
  events: Array<{ name: string; dateTime: string | null }>;
};

export type OrdersList = {
  accountIdKey: string;
  orders: BrokerOrder[];
  fetchedAt: string;
};

declare global {
  interface Window {
    tradehole?: {
      getApiBase: () => Promise<string>;
      loadTokens: () => Promise<{
        accessToken: string;
        accessTokenSecret: string;
      } | null>;
      saveTokens: (tokens: {
        accessToken: string;
        accessTokenSecret: string;
      }) => Promise<boolean>;
      clearTokens: () => Promise<boolean>;
      openExternal: (url: string) => Promise<void>;
    };
  }
}

export {};
