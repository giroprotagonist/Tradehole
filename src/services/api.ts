import type {
  EtradeStatus,
  OptionsChain,
  OrderPlaceResult,
  OrderPreview,
  OrdersList,
  PhysicalMarkets,
  Portfolio,
  StockQuote,
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

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getApiBase();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return data;
}

export async function fetchMarketSnapshot(): Promise<{
  fro: StockQuote;
  energy: { wti: StockQuote; brent: StockQuote };
  options: OptionsChain;
  volatility: VolatilityReport;
  physical: PhysicalMarkets;
  fetchedAt: string;
}> {
  return api("/api/market/snapshot");
}

export async function fetchOptions(symbol: string, expiry?: string): Promise<OptionsChain> {
  const q = expiry ? `?expiry=${encodeURIComponent(expiry)}` : "";
  return api(`/api/options/${encodeURIComponent(symbol)}${q}`);
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

export async function fetchPortfolio(accountIdKey?: string): Promise<Portfolio> {
  const q = accountIdKey ? `?accountIdKey=${encodeURIComponent(accountIdKey)}` : "";
  return api(`/api/etrade/portfolio${q}`);
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

export async function fetchIronsightStatus(): Promise<{
  up: boolean;
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
