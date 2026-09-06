import type {
  DecisionFootprint,
  EtradeAccount,
  EtradeStatus,
  ExternalPosition,
  ExternalPositionsBook,
  HistoryStatus,
  IsraelStrikeManualState,
  IsraelStrikeTells,
  FroCatalystReport,
  KineticRewindReport,
  KineticStamp,
  MarketSurprise,
  Nav01Posture,
  NewsReaderArticle,
  NewsReaderJob,
  NewsReaderStage,
  NewsReaderStatus,
  OptionsChain,
  OptionsChainsAll,
  OrderPlaceResult,
  OrderPreview,
  OrdersList,
  OsintArchivePeak,
  OsintArchivePlaybackFrame,
  OsintArchiveStatus,
  PhysicalMarkets,
  Portfolio,
  PositionRow,
  StockQuote,
  TheaterWatch,
  TradingStatus,
  VolatilityReport,
} from "../types";

const FALLBACK_API = "http://127.0.0.1:3169";

let cachedBase: string | null = null;

export async function getApiBase(): Promise<string> {
  if (cachedBase) return cachedBase;
  if (window.tradehole?.getApiBase) {
    cachedBase = await window.tradehole.getApiBase();
  } else {
    cachedBase = FALLBACK_API;
  }
  return cachedBase;
}

export function isRequestTimeout(err: unknown): boolean {
  if (
    err instanceof DOMException &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  ) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /timed out/i.test(msg);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getApiBase();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    if (
      err instanceof DOMException &&
      (err.name === "AbortError" || err.name === "TimeoutError")
    ) {
      throw new Error(`Request timed out: ${path}`);
    }
    throw err;
  }
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return data;
}

export async function fetchQuote(symbol: string): Promise<StockQuote> {
  return api(`/api/quote/${encodeURIComponent(symbol)}`);
}

export type EnergyQuotesPayload = {
  wti: StockQuote;
  brent: StockQuote;
  heatingOil: StockQuote | null;
  gasoline: StockQuote | null;
  dieselCrackUsdPerBbl: number | null;
  gasolineCrackUsdPerBbl: number | null;
};

export async function fetchEnergy(): Promise<EnergyQuotesPayload> {
  return api("/api/energy");
}

export type ChartRange = "1d" | "1w" | "1m" | "3m" | "1y";

export type MarketChartPoint = {
  ts: string;
  close: number;
};

export type MarketChartSeries = {
  key: string;
  symbol: string;
  label: string;
  unit: string;
  priceDigits: number;
  points: MarketChartPoint[];
  last: number | null;
  change: number | null;
  changePercent: number | null;
  error?: string;
};

export type MarketChartsPayload = {
  range: ChartRange;
  fetchedAt: string;
  cached: boolean;
  series: MarketChartSeries[];
};

export async function fetchMarketCharts(range: ChartRange = "1y"): Promise<MarketChartsPayload> {
  return api(`/api/market/charts?range=${encodeURIComponent(range)}`, {
    signal: AbortSignal.timeout(30_000),
  });
}

export async function fetchMarketSnapshot(refresh = false): Promise<{
  fro: StockQuote;
  energy: EnergyQuotesPayload | null;
  options: OptionsChain | null;
  volatility: VolatilityReport | null;
  physical: PhysicalMarkets | null;
  partialErrors?: string[];
  history?: HistoryStatus;
  fetchedAt: string;
}> {
  const q = refresh ? "?refresh=1" : "";
  return api(`/api/market/snapshot${q}`, {
    signal: AbortSignal.timeout(refresh ? 55_000 : 45_000),
  });
}

export async function fetchTheaterWatch(
  refresh = false,
): Promise<TheaterWatch> {
  // lite=1 skips DF/MS attach so Map stamps/overlays return before client abort.
  const q = refresh
    ? `?lite=1&refresh=1&_=${Date.now()}`
    : "?lite=1";
  return api(`/api/theater-watch${q}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(75_000),
  });
}

export async function fetchDecisionFootprint(
  refresh = false,
): Promise<DecisionFootprint> {
  const q = refresh ? "?refresh=1" : "";
  return api(`/api/decision-footprint${q}`, {
    signal: AbortSignal.timeout(55_000),
  });
}

export async function fetchMarketSurprise(
  refresh = false,
): Promise<MarketSurprise> {
  const q = refresh ? "?refresh=1" : "";
  return api(`/api/market-surprise${q}`, {
    signal: AbortSignal.timeout(55_000),
  });
}

export async function fetchFroCatalyst(
  refresh = false,
): Promise<FroCatalystReport> {
  const q = refresh ? "?refresh=1" : "";
  return api(`/api/fro-catalyst${q}`, {
    signal: AbortSignal.timeout(75_000),
  });
}

export async function fetchPlaybookProposal(
  refresh = false,
): Promise<import("../types").TradeProposal> {
  const q = refresh ? "?refresh=1" : "";
  return api(`/api/playbook/proposals${q}`, {
    signal: AbortSignal.timeout(90_000),
  });
}

export async function fetchPlaybookLatest(): Promise<{
  proposal: import("../types").TradeProposal | null;
  asOf: string;
}> {
  return api("/api/playbook/latest", {
    signal: AbortSignal.timeout(10_000),
  });
}

export async function decidePlaybookProposal(
  id: string,
  body: {
    decision: "accepted" | "rejected" | "snoozed" | "accepted_manual";
    note?: string;
    orderId?: string;
    fillPrice?: number;
    pnl?: number;
  },
): Promise<{
  proposal: import("../types").TradeProposal | null;
  decision: unknown;
}> {
  return api(`/api/playbook/proposals/${encodeURIComponent(id)}/decision`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchPlaybookJournal(limit = 40): Promise<{
  summary: import("../types").TradeJournalSummary;
  entries: Array<Record<string, unknown>>;
  asOf: string;
}> {
  return api(`/api/playbook/journal?limit=${limit}`, {
    signal: AbortSignal.timeout(15_000),
  });
}

export async function fetchKineticRewind(opts?: {
  target?: string;
  eventAt?: string;
  refresh?: boolean;
}): Promise<KineticRewindReport> {
  const q = new URLSearchParams();
  if (opts?.target) q.set("target", opts.target);
  if (opts?.eventAt) q.set("eventAt", opts.eventAt);
  if (opts?.refresh) q.set("refresh", "1");
  const qs = q.toString();
  return api(`/api/kinetic-rewind${qs ? `?${qs}` : ""}`, {
    signal: AbortSignal.timeout(45_000),
  });
}

export async function stampKineticRewind(body: {
  targetId: string;
  eventAt: string;
  headline?: string;
  note?: string;
  link?: string | null;
}): Promise<KineticStamp> {
  return api("/api/kinetic-rewind/stamp", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchIsraelStrikeTells(
  refresh = false,
): Promise<IsraelStrikeTells> {
  const q = refresh ? "?refresh=1" : "";
  return api(`/api/israel-strike-tells${q}`, {
    signal: AbortSignal.timeout(90_000),
  });
}

/** Last-good IST + theater for clipboard — server must not rebuild. */
export async function fetchMapCopyBoard(): Promise<{
  israelStrike: IsraelStrikeTells | null;
  israelStrikeAgeMs: number | null;
  theater: TheaterWatch | null;
  asOf: string;
}> {
  return api("/api/map-copy-board", {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
}

export async function setIsraelStrikeManual(body: {
  nav01?: {
    posture?: Nav01Posture;
    note?: string;
    navyCount?: number | null;
    navyThreshold?: number;
  };
}): Promise<IsraelStrikeManualState> {
  return api("/api/israel-strike-tells/manual", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchOptions(symbol: string, expiry?: string): Promise<OptionsChain> {
  const q = expiry ? `?expiry=${encodeURIComponent(expiry)}` : "";
  return api(`/api/options/${encodeURIComponent(symbol)}${q}`);
}

export async function fetchAllOptionsChains(symbol: string): Promise<OptionsChainsAll> {
  return api(`/api/options/${encodeURIComponent(symbol)}/all`, {
    signal: AbortSignal.timeout(120_000),
  });
}

export async function fetchEtradeStatus(): Promise<EtradeStatus> {
  return api("/api/etrade/status");
}

export async function startEtradeOAuth(): Promise<{ authorizeUrl: string }> {
  return api("/api/etrade/oauth/start", { method: "POST" });
}

export async function completeEtradeOAuth(verifier: string): Promise<{
  ok: boolean;
  tokens: { accessToken: string; accessTokenSecret: string };
}> {
  return api("/api/etrade/oauth/complete", {
    method: "POST",
    body: JSON.stringify({ verifier }),
  });
}

export async function restoreEtradeTokens(tokens: {
  accessToken: string;
  accessTokenSecret: string;
}): Promise<EtradeStatus & { ok: boolean }> {
  return api("/api/etrade/oauth/restore", {
    method: "POST",
    body: JSON.stringify(tokens),
  });
}

export async function logoutEtrade(): Promise<{ ok: boolean }> {
  return api("/api/etrade/oauth/logout", { method: "POST" });
}

export async function renewEtrade(): Promise<EtradeStatus & { ok: boolean }> {
  return api("/api/etrade/oauth/renew", { method: "POST" });
}

export async function fetchEtradeAccounts(): Promise<EtradeAccount[]> {
  return api("/api/etrade/accounts");
}

export async function fetchPortfolio(accountIdKey?: string): Promise<Portfolio> {
  const q = accountIdKey ? `?accountIdKey=${encodeURIComponent(accountIdKey)}` : "";
  return api(`/api/etrade/portfolio${q}`, {
    signal: AbortSignal.timeout(25_000),
  });
}

export async function fetchExternalPositions(): Promise<ExternalPositionsBook> {
  return api("/api/external-positions");
}

export async function addExternalPosition(body: {
  broker?: string;
  symbol: string;
  expiry: string;
  strike: number;
  callPut: "call" | "put";
  quantity: number;
  avgCost: number;
  boughtAt?: string | null;
  notes?: string | null;
}): Promise<{ position: ExternalPosition; marked: PositionRow | null }> {
  return api("/api/external-positions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateExternalPosition(
  id: string,
  body: Partial<{
    broker: string;
    symbol: string;
    expiry: string;
    strike: number;
    callPut: "call" | "put";
    quantity: number;
    avgCost: number;
    boughtAt: string | null;
    notes: string | null;
  }>,
): Promise<{ position: ExternalPosition; marked: PositionRow | null }> {
  return api(`/api/external-positions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteExternalPosition(
  id: string,
): Promise<{ ok: boolean }> {
  return api(`/api/external-positions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function fetchOrders(opts?: {
  accountIdKey?: string;
  status?: string;
  symbol?: string;
  count?: number;
}): Promise<OrdersList> {
  const params = new URLSearchParams();
  if (opts?.accountIdKey) params.set("accountIdKey", opts.accountIdKey);
  if (opts?.status) params.set("status", opts.status);
  if (opts?.symbol) params.set("symbol", opts.symbol);
  if (opts?.count != null) params.set("count", String(opts.count));
  const q = params.toString() ? `?${params}` : "";
  return api(`/api/etrade/orders${q}`);
}

export async function fetchTradingStatus(): Promise<TradingStatus> {
  return api("/api/etrade/trading/status");
}

export async function previewEtradeOrder(body: {
  accountIdKey?: string;
  symbol?: string;
  callPut?: "CALL" | "PUT";
  expiry?: string;
  strike?: number;
  orderAction?: string;
  quantity?: number;
  priceType?: "LIMIT" | "MARKET" | "TRAILING_STOP_CNST";
  limitPrice?: number;
  trailAmount?: number;
  orderTerm?: "GOOD_FOR_DAY" | "GOOD_UNTIL_CANCEL";
  marketSession?: "REGULAR" | "EXTENDED";
}): Promise<OrderPreview> {
  return api("/api/etrade/orders/preview", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function placeEtradeOrder(
  previewToken: string,
  confirm: string,
): Promise<OrderPlaceResult> {
  return api("/api/etrade/orders/place", {
    method: "POST",
    body: JSON.stringify({ previewToken, confirm }),
  });
}

export async function cancelEtradeOrder(body: {
  orderId: string | number;
  confirm: string;
  accountIdKey?: string;
}): Promise<{
  ok: true;
  orderId: string;
  cancelTime: string | null;
  accountId: string | null;
  confirmPhrase: string;
  messages: Array<{ type: string; code: number | null; description: string }>;
}> {
  return api("/api/etrade/orders/cancel", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchBookSummary(): Promise<BookSummary> {
  return api("/api/book-summary");
}

export type BookSummary = {
  asOf: string;
  focus46cTotal: number;
  legs: Array<{
    account: string;
    accountIdKey: string;
    symbol: string;
    description: string;
    quantity: number;
    avgCost: number | null;
    kind: "option" | "equity";
  }>;
  byAccount: Array<{
    account: string;
    accountIdKey: string;
    focus46c: number;
    legs: BookSummary["legs"];
  }>;
};

export async function fetchIronsightStatus(): Promise<{
  up: boolean;
  feedsFresh?: boolean;
  healthy?: boolean;
  telegramAgeMs?: number | null;
  newsAgeMs?: number | null;
  telegramCount?: number;
  newsCount?: number;
  url: string;
  status: number;
}> {
  return api("/api/ironsight/status");
}

export async function fetchLlmDossier(symbol = "FRO"): Promise<{
  symbol: string;
  generatedAt: string;
  byteLength: number;
  sources: Record<string, "ok" | "error">;
  text: string;
}> {
  return api(`/api/dossier/${encodeURIComponent(symbol)}/meta`);
}

export async function fetchHistoryStatus(): Promise<HistoryStatus> {
  return api("/api/history/status");
}

export async function fetchOsintArchiveStatus(): Promise<OsintArchiveStatus> {
  return api("/api/osint-archive/status");
}

export async function fetchOsintArchiveRange(opts: {
  at: string;
  windowMs?: number;
  kinds?: string[];
}): Promise<OsintArchivePlaybackFrame> {
  const q = new URLSearchParams();
  q.set("at", opts.at);
  if (opts.windowMs != null) q.set("windowMs", String(opts.windowMs));
  if (opts.kinds?.length) q.set("kinds", opts.kinds.join(","));
  return api(`/api/osint-archive/range?${q.toString()}`);
}

export async function fetchOsintArchivePeaks(opts?: {
  from?: string;
  to?: string;
  limit?: number;
}): Promise<{ from: string; to: string; peaks: OsintArchivePeak[] }> {
  const q = new URLSearchParams();
  if (opts?.from) q.set("from", opts.from);
  if (opts?.to) q.set("to", opts.to);
  if (opts?.limit != null) q.set("limit", String(opts.limit));
  const qs = q.toString();
  return api(`/api/osint-archive/peaks${qs ? `?${qs}` : ""}`);
}

export async function fetchHistorySeries(opts: {
  symbol?: string;
  expiry?: string;
  strike?: number;
  type?: "call" | "put";
  from?: string;
}): Promise<{
  symbol: string;
  expiry: string;
  strike: number;
  type: string;
  series: Array<{
    ts: string;
    spot: number | null;
    bid: number | null;
    ask: number | null;
    last: number | null;
    volume: number | null;
    openInterest: number | null;
    iv: number | null;
  }>;
  stock: Array<{
    ts: string;
    price: number | null;
    volume: number | null;
    high: number | null;
    low: number | null;
  }>;
}> {
  const q = new URLSearchParams();
  if (opts.symbol) q.set("symbol", opts.symbol);
  if (opts.expiry) q.set("expiry", opts.expiry);
  if (opts.strike != null) q.set("strike", String(opts.strike));
  if (opts.type) q.set("type", opts.type);
  if (opts.from) q.set("from", opts.from);
  return api(`/api/history/series?${q.toString()}`);
}

export async function fetchHistoryFlow(opts?: {
  symbol?: string;
  days?: number;
}): Promise<{
  symbol: string;
  events: FlowEventRow[];
}> {
  const q = new URLSearchParams();
  if (opts?.symbol) q.set("symbol", opts.symbol);
  if (opts?.days != null) q.set("days", String(opts.days));
  return api(`/api/history/flow?${q.toString()}`);
}

export type FlowEventRow = {
  id: number;
  ts: string;
  kind: string;
  symbol: string;
  expiry: string | null;
  strike: number | null;
  type: string | null;
  severity: string;
  message: string;
  metrics: Record<string, unknown> | null;
};

export async function fetchHistoryAlerts(opts?: {
  symbol?: string;
  since?: string;
}): Promise<{
  symbol: string;
  alerts: FlowEventRow[];
  status: HistoryStatus;
}> {
  const q = new URLSearchParams();
  if (opts?.symbol) q.set("symbol", opts.symbol);
  if (opts?.since) q.set("since", opts.since);
  return api(`/api/history/alerts?${q.toString()}`);
}

export async function fetchHistoryHeatmap(opts?: {
  symbol?: string;
  expiry?: string;
}): Promise<{
  symbol: string;
  expiry: string;
  ts: string | null;
  cells: Array<{
    strike: number;
    type: "call" | "put";
    volume: number | null;
    openInterest: number | null;
    iv: number | null;
    bid: number | null;
    ask: number | null;
    last: number | null;
  }>;
}> {
  const q = new URLSearchParams();
  if (opts?.symbol) q.set("symbol", opts.symbol);
  if (opts?.expiry) q.set("expiry", opts.expiry);
  return api(`/api/history/heatmap?${q.toString()}`);
}

export type EverythingExportOpts = {
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

export type ShekelAlarmSnapshot = {
  symbol: string;
  price: number | null;
  changePct: number | null;
  threshold: number;
  spikeFloor: number;
  spikeHard: number;
  rocFloor: number;
  rocPct: number;
  spiked: boolean;
  regime: "quiet" | "firm" | "spiked" | "unknown";
  rule: string;
  read: string;
};

export type IntelAlarmState = {
  locks: Array<{
    id: 1 | 2 | 3 | 4 | 5;
    name: string;
    short: string;
    triggered: boolean;
    source: "auto" | "manual" | "mixed" | "unknown";
    read: string;
    evidence: Record<string, unknown>;
    links: Array<{ label: string; href: string }>;
    limit: string;
  }>;
  lockCount: number;
  level: "green" | "yellow" | "red";
  threeLockStack: boolean;
  bibiTrigger: boolean;
  bibi: {
    shekel: ShekelAlarmSnapshot;
    nuclearStrikeNews: {
      hit: boolean;
      titles: string[];
      rejectedStale: string[];
      windowHours: number;
      corroboration: "multi_source" | "none";
    };
    read: string;
  };
  /** Dedicated USD/ILS spike alarm (same FX rules as Bibi shekel leg). */
  shekelAlarm: ShekelAlarmSnapshot;
  redReason: "five_lock" | "three_lock_stack" | "bibi_plus_locks" | null;
  reads: string[];
  evaluatedAt: string;
  manual: Record<string, unknown>;
  previousLevel: "green" | "yellow" | "red" | null;
  transitioned: boolean;
  limits: string[];
  rule: string;
};

/** Read Theater-watch + 5-Lock manual postures from localStorage (client-only). */
export function readAisExportOpts(): EverythingExportOpts {
  try {
    return {
      aisStatus: localStorage.getItem("tradehole.ais.hormuzStatus"),
      aisNote: localStorage.getItem("tradehole.ais.hormuzNote"),
      bataanStatus: localStorage.getItem("tradehole.kharg.bataanStatus"),
      bataanNote: localStorage.getItem("tradehole.kharg.bataanNote"),
      boxerStatus: localStorage.getItem("tradehole.kharg.boxerStatus"),
      boxerNote: localStorage.getItem("tradehole.kharg.boxerNote"),
      newYorkStatus: localStorage.getItem("tradehole.kharg.newYorkStatus"),
      newYorkNote: localStorage.getItem("tradehole.kharg.newYorkNote"),
      irgcStatus: localStorage.getItem("tradehole.kharg.irgcStatus"),
      irgcNote: localStorage.getItem("tradehole.kharg.irgcNote"),
      capeStatus: localStorage.getItem("tradehole.kharg.capeStatus"),
      capeNote: localStorage.getItem("tradehole.kharg.capeNote"),
      romeStatus: localStorage.getItem("tradehole.bibi.romeStatus"),
      romeNote: localStorage.getItem("tradehole.bibi.romeNote"),
      bataanSog: localStorage.getItem("tradehole.intel.bataanSog"),
      bataanCourse: localStorage.getItem("tradehole.intel.bataanCourse"),
      bataanLat: localStorage.getItem("tradehole.intel.bataanLat"),
      bataanLon: localStorage.getItem("tradehole.intel.bataanLon"),
      boxerSog: localStorage.getItem("tradehole.intel.boxerSog"),
      boxerCourse: localStorage.getItem("tradehole.intel.boxerCourse"),
      boxerLat: localStorage.getItem("tradehole.intel.boxerLat"),
      boxerLon: localStorage.getItem("tradehole.intel.boxerLon"),
      newYorkSog: localStorage.getItem("tradehole.intel.newYorkSog"),
      newYorkCourse: localStorage.getItem("tradehole.intel.newYorkCourse"),
      newYorkLat: localStorage.getItem("tradehole.intel.newYorkLat"),
      newYorkLon: localStorage.getItem("tradehole.intel.newYorkLon"),
      vlccDivertCount: localStorage.getItem("tradehole.intel.vlccDivertCount"),
      navwarnForce: localStorage.getItem("tradehole.intel.navwarnForce"),
      irgcForce: localStorage.getItem("tradehole.intel.irgcForce"),
      capeForce: localStorage.getItem("tradehole.intel.capeForce"),
      intelAlarmNote: localStorage.getItem("tradehole.intel.note"),
    };
  } catch {
    return {};
  }
}

function exportBody(opts: EverythingExportOpts) {
  return {
    aisStatus: opts.aisStatus ?? null,
    aisNote: opts.aisNote ?? null,
    bataanStatus: opts.bataanStatus ?? null,
    bataanNote: opts.bataanNote ?? null,
    boxerStatus: opts.boxerStatus ?? null,
    boxerNote: opts.boxerNote ?? null,
    newYorkStatus: opts.newYorkStatus ?? null,
    newYorkNote: opts.newYorkNote ?? null,
    amphibStatus: opts.amphibStatus ?? opts.bataanStatus ?? null,
    amphibNote: opts.amphibNote ?? opts.bataanNote ?? null,
    irgcStatus: opts.irgcStatus ?? null,
    irgcNote: opts.irgcNote ?? null,
    capeStatus: opts.capeStatus ?? null,
    capeNote: opts.capeNote ?? null,
    romeStatus: opts.romeStatus ?? null,
    romeNote: opts.romeNote ?? null,
    bataanSog: opts.bataanSog ?? null,
    bataanCourse: opts.bataanCourse ?? null,
    bataanLat: opts.bataanLat ?? null,
    bataanLon: opts.bataanLon ?? null,
    boxerSog: opts.boxerSog ?? null,
    boxerCourse: opts.boxerCourse ?? null,
    boxerLat: opts.boxerLat ?? null,
    boxerLon: opts.boxerLon ?? null,
    newYorkSog: opts.newYorkSog ?? null,
    newYorkCourse: opts.newYorkCourse ?? null,
    newYorkLat: opts.newYorkLat ?? null,
    newYorkLon: opts.newYorkLon ?? null,
    vlccDivertCount: opts.vlccDivertCount ?? null,
    navwarnForce: opts.navwarnForce ?? null,
    irgcForce: opts.irgcForce ?? null,
    capeForce: opts.capeForce ?? null,
    intelAlarmNote: opts.intelAlarmNote ?? null,
  };
}

export async function fetchIntelAlarm(
  refresh = false,
): Promise<IntelAlarmState> {
  const q = refresh ? "?refresh=1" : "";
  return api(`/api/intel-alarm${q}`);
}

export async function postIntelAlarmManual(body: {
  bataanSog?: number | null;
  bataanCourse?: number | null;
  bataanLat?: number | null;
  bataanLon?: number | null;
  bataanLockForce?: boolean | null;
  boxerSog?: number | null;
  boxerCourse?: number | null;
  boxerLat?: number | null;
  boxerLon?: number | null;
  newYorkSog?: number | null;
  newYorkCourse?: number | null;
  newYorkLat?: number | null;
  newYorkLon?: number | null;
  vlccDivertCount?: number | null;
  navwarnForce?: boolean | null;
  irgcForce?: boolean | null;
  capeForce?: boolean | null;
  note?: string | null;
}): Promise<IntelAlarmState> {
  return api("/api/intel-alarm/manual", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type DealAlarmEvent = {
  id: string;
  kind: string;
  severity: "info" | "warn" | "critical";
  action: "hold" | "trim" | "watch" | "buy" | "red";
  title: string;
  read: string;
  source: string;
  link: string | null;
  detectedAt: string;
};

export type DealAlarmState = {
  evaluatedAt: string;
  level: "quiet" | "watch" | "hold" | "trim" | "buy" | "red";
  read: string;
  actionBias: "hold" | "trim" | "watch" | "buy" | "red" | "none";
  events: DealAlarmEvent[];
  warRiskRegime: string;
  stateMediaRegime: string;
  froPrice: number | null;
  froChangePct: number | null;
  bataan: {
    lat: number | null;
    lon: number | null;
    baselineLat: number;
    baselineLon: number;
    status: string | null;
    region: string | null;
    moved: boolean;
    read: string;
  };
  checklist: Array<{
    id: string;
    label: string;
    priority: string;
    status: string;
    action: string;
  }>;
  links: Array<{ label: string; href: string }>;
  sources: Record<string, string>;
};

export async function fetchDealAlarm(
  refresh = false,
): Promise<DealAlarmState> {
  const q = refresh ? "?refresh=1" : "";
  return api(`/api/deal-alarm${q}`);
}

export async function fetchAiPack(
  symbol = "FRO",
  opts: EverythingExportOpts = {},
): Promise<{
  symbol: string;
  generatedAt: string;
  text: string;
  byteLength: number;
  files: Array<{ name: string; content: string; mediaType: string }>;
}> {
  return api(`/api/export/${encodeURIComponent(symbol)}/ai-pack`, {
    method: "POST",
    body: JSON.stringify(exportBody(opts)),
  });
}

/** Fast 7-bucket FRO/Hormuz OSINT markdown pack (paste into another LLM). */
export async function fetchOsintPack(
  symbol = "FRO",
  opts: EverythingExportOpts = {},
): Promise<{
  symbol: string;
  generatedAt: string;
  markdown: string;
  byteLength: number;
  sources: Record<string, "ok" | "error" | "partial">;
}> {
  return api(`/api/export/${encodeURIComponent(symbol)}/osint-pack`, {
    method: "POST",
    body: JSON.stringify(exportBody(opts)),
  });
}

/** Size-capped DeepSeek web-UI paste (~30k chars default). */
export type DeepSeekPasteResult = {
  symbol: string;
  generatedAt: string;
  markdown: string;
  chars: number;
  tokensEstimate: number;
  maxChars: number;
  softWarnChars: number;
  softWarn: boolean;
  truncated: boolean;
  sectionsIncluded: string[];
  sectionsDropped: string[];
  schemaVersion: string;
};

export async function fetchDeepSeekPaste(
  symbol = "FRO",
  opts: EverythingExportOpts & { maxChars?: number } = {},
): Promise<DeepSeekPasteResult> {
  return api(`/api/deepseek-paste`, {
    method: "POST",
    body: JSON.stringify({
      symbol,
      maxChars: opts.maxChars,
      ...exportBody(opts),
    }),
  });
}

export function downloadDeepSeekMarkdown(
  markdown: string,
  symbol = "FRO",
): void {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const day = new Date().toISOString().slice(0, 10);
  a.download = `tradehole-${symbol}-deepseek-${day}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function downloadAiBundle(
  symbol = "FRO",
  opts: EverythingExportOpts = {},
): Promise<void> {
  const base = await getApiBase();
  const res = await fetch(
    `${base}/api/export/${encodeURIComponent(symbol)}/ai-bundle.zip`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(exportBody(opts)),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tradehole-${symbol}-everything.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function fetchNewsReaderStatus(): Promise<NewsReaderStatus> {
  return api("/api/news-reader/status", {
    signal: AbortSignal.timeout(8_000),
  });
}

export async function fetchNewsReaderArticles(opts?: {
  limit?: number;
  offset?: number;
  status?: string;
  region?: string;
}): Promise<{
  articles: NewsReaderArticle[];
  total: number;
  region?: string;
}> {
  const params = new URLSearchParams();
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  if (opts?.offset != null) params.set("offset", String(opts.offset));
  if (opts?.status) params.set("status", opts.status);
  if (opts?.region) params.set("region", opts.region);
  const q = params.toString();
  return api(`/api/news-reader/articles${q ? `?${q}` : ""}`, {
    signal: AbortSignal.timeout(12_000),
  });
}

export async function fetchNewsReaderRegions(): Promise<{
  packs: Array<{
    id: string;
    label: string;
    short: string;
    layers: string;
  }>;
}> {
  return api("/api/news-reader/regions", {
    signal: AbortSignal.timeout(5_000),
  });
}

export async function runNewsReader(body: {
  stages?: NewsReaderStage;
  limit?: number;
  summarizeLimit?: number;
  telegramMode?: "web";
  model?: string;
}): Promise<{ accepted: boolean; job: NewsReaderJob }> {
  return api("/api/news-reader/run", {
    method: "POST",
    body: JSON.stringify({
      stages: body.stages ?? "all",
      limit: body.limit ?? 100,
      summarizeLimit: body.summarizeLimit,
      telegramMode: "web",
      model: body.model,
    }),
    signal: AbortSignal.timeout(15_000),
  });
}

export async function fetchNewsReaderExport(opts?: {
  limit?: number;
  status?: string;
}): Promise<{
  generatedAt: string;
  count: number;
  articles: NewsReaderArticle[];
}> {
  const params = new URLSearchParams();
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  params.set("status", opts?.status ?? "summarized");
  return api(`/api/news-reader/export?${params}`, {
    signal: AbortSignal.timeout(15_000),
  });
}

/** Standalone IRONSIGHT news pack ZIP (RSS + best-effort article bodies + robust Telegram dump). */
export async function downloadNewsPack(opts?: {
  conflict?: string;
  fetchLimit?: number;
  /** Default robust — full toolkit 30d dump + broad + RU light. */
  telegram?: "robust" | "deep" | "sample";
}): Promise<{
  articles: number;
  fetchedOk: number;
  fetchedFail: number;
  telegram: number;
  telegramMode: string;
}> {
  const base = await getApiBase();
  const params = new URLSearchParams();
  params.set("conflict", opts?.conflict ?? "all");
  if (opts?.fetchLimit != null) {
    params.set("fetchLimit", String(opts.fetchLimit));
  }
  params.set("telegram", opts?.telegram ?? "robust");
  const res = await fetch(`${base}/api/news-pack.zip?${params}`);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  const articles = Number(res.headers.get("X-News-Pack-Articles") ?? 0);
  const fetchedOk = Number(res.headers.get("X-News-Pack-Fetched-Ok") ?? 0);
  const fetchedFail = Number(res.headers.get("X-News-Pack-Fetched-Fail") ?? 0);
  const telegram = Number(res.headers.get("X-News-Pack-Telegram") ?? 0);
  const telegramMode = res.headers.get("X-News-Pack-Telegram-Mode") ?? "robust";
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "tradehole-news-pack.zip";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { articles, fetchedOk, fetchedFail, telegram, telegramMode };
}
