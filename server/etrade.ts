import { OAuth } from "oauth";

function consumerKey(): string {
  return process.env.ETRADE_CONSUMER_KEY ?? "";
}

function consumerSecret(): string {
  return process.env.ETRADE_CONSUMER_SECRET ?? "";
}

function etradeEnv(): string {
  return (process.env.ETRADE_ENV ?? "sandbox").toLowerCase();
}

const OAUTH_BASE = "https://api.etrade.com";

function apiBase(): string {
  return etradeEnv() === "production"
    ? "https://api.etrade.com"
    : "https://apisb.etrade.com";
}

type TokenPair = { token: string; tokenSecret: string };

let requestTokens: TokenPair | null = null;
let accessTokens: TokenPair | null = null;
let authorizedAt: string | null = null;

function requireKeys(): void {
  if (!consumerKey() || !consumerSecret()) {
    throw new Error(
      "Missing ETRADE_CONSUMER_KEY / ETRADE_CONSUMER_SECRET in .env",
    );
  }
}

function createOAuth(): OAuth {
  requireKeys();
  const oa = new OAuth(
    `${OAUTH_BASE}/oauth/request_token`,
    `${OAUTH_BASE}/oauth/access_token`,
    consumerKey(),
    consumerSecret(),
    "1.0",
    "oob",
    "HMAC-SHA1",
    undefined,
    {
      Accept: "*/*",
      Connection: "close",
      "User-Agent": "Tradehole/0.1",
      consumerKey: consumerKey(),
    },
  );
  // E*TRADE expects GET for request/access token endpoints
  oa.setClientOptions({
    requestTokenHttpMethod: "GET",
    accessTokenHttpMethod: "GET",
    followRedirects: true,
  });
  return oa;
}

function getOAuth(): OAuth {
  return createOAuth();
}

export function getAuthStatus(): {
  configured: boolean;
  authorized: boolean;
  env: string;
  authorizedAt: string | null;
  apiBase: string;
} {
  return {
    configured: Boolean(consumerKey() && consumerSecret()),
    authorized: Boolean(accessTokens?.token && accessTokens?.tokenSecret),
    env: etradeEnv(),
    authorizedAt,
    apiBase: apiBase(),
  };
}

export function setAccessTokens(token: string, tokenSecret: string): void {
  accessTokens = { token, tokenSecret };
  authorizedAt = new Date().toISOString();
}

export function clearSession(): void {
  requestTokens = null;
  accessTokens = null;
  authorizedAt = null;
}

export function startOAuth(): Promise<{ authorizeUrl: string }> {
  requireKeys();
  const oa = getOAuth();
  return new Promise((resolve, reject) => {
    oa.getOAuthRequestToken((err, token, tokenSecret) => {
      if (err || !token || !tokenSecret) {
        reject(new Error(`request_token failed: ${JSON.stringify(err)}`));
        return;
      }
      requestTokens = { token, tokenSecret };
      const authorizeUrl =
        `https://us.etrade.com/e/t/etws/authorize?key=${encodeURIComponent(consumerKey())}` +
        `&token=${encodeURIComponent(token)}`;
      resolve({ authorizeUrl });
    });
  });
}

export function completeOAuth(
  verifier: string,
): Promise<{ accessToken: string; accessTokenSecret: string }> {
  if (!requestTokens) {
    return Promise.reject(new Error("No pending request token — call start first"));
  }
  const oa = getOAuth();
  const { token, tokenSecret } = requestTokens;
  return new Promise((resolve, reject) => {
    oa.getOAuthAccessToken(
      token,
      tokenSecret,
      verifier,
      (err, accessToken, accessTokenSecret) => {
        if (err || !accessToken || !accessTokenSecret) {
          reject(new Error(`access_token failed: ${JSON.stringify(err)}`));
          return;
        }
        setAccessTokens(accessToken, accessTokenSecret);
        requestTokens = null;
        resolve({ accessToken, accessTokenSecret });
      },
    );
  });
}

export function renewAccessToken(): Promise<void> {
  if (!accessTokens) {
    return Promise.reject(new Error("Not authorized"));
  }
  const oa = getOAuth();
  const { token, tokenSecret } = accessTokens;
  return new Promise((resolve, reject) => {
    oa.get(
      `${OAUTH_BASE}/oauth/renew_access_token`,
      token,
      tokenSecret,
      (err) => {
        if (err) {
          reject(new Error(`renew failed: ${JSON.stringify(err)}`));
          return;
        }
        authorizedAt = new Date().toISOString();
        resolve();
      },
    );
  });
}

function jsonApiPath(path: string): { jsonPath: string; url: string } {
  const [pathname, query] = path.split("?");
  const jsonPath = pathname.endsWith(".json") ? pathname : `${pathname}.json`;
  const url = `${apiBase()}${jsonPath}${query ? `?${query}` : ""}`;
  return { jsonPath, url };
}

function parseEtradeBody<T>(jsonPath: string, body: unknown): T {
  const text = String(body ?? "").trim();
  if (text.startsWith("<")) {
    throw new Error(
      `E*TRADE returned XML for ${jsonPath} (expected JSON). Body: ${text.slice(0, 200)}`,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch (parseErr) {
    throw new Error(
      `JSON parse failed for ${jsonPath}: ${String(parseErr)} · body: ${text.slice(0, 200)}`,
    );
  }
}

function etradeErrorDetail(err: unknown): string {
  if (typeof err === "object" && err && "data" in err) {
    return String((err as { data?: unknown }).data).slice(0, 600);
  }
  return JSON.stringify(err);
}

function apiGet<T>(path: string): Promise<T> {
  if (!accessTokens) {
    return Promise.reject(new Error("Not authorized — complete E*TRADE OAuth first"));
  }
  const oa = getOAuth();
  const { jsonPath, url } = jsonApiPath(path);
  return new Promise((resolve, reject) => {
    oa.get(url, accessTokens!.token, accessTokens!.tokenSecret, (err, body) => {
      if (err) {
        reject(new Error(`E*TRADE GET ${jsonPath}: ${etradeErrorDetail(err)}`));
        return;
      }
      try {
        resolve(parseEtradeBody<T>(jsonPath, body));
      } catch (parseErr) {
        reject(parseErr);
      }
    });
  });
}

export function apiPost<T>(path: string, payload: unknown): Promise<T> {
  if (!accessTokens) {
    return Promise.reject(new Error("Not authorized — complete E*TRADE OAuth first"));
  }
  const oa = getOAuth();
  const { jsonPath, url } = jsonApiPath(path);
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    oa.post(
      url,
      accessTokens!.token,
      accessTokens!.tokenSecret,
      body,
      "application/json",
      (err, responseBody) => {
        if (err) {
          reject(new Error(`E*TRADE POST ${jsonPath}: ${etradeErrorDetail(err)}`));
          return;
        }
        try {
          resolve(parseEtradeBody<T>(jsonPath, responseBody));
        } catch (parseErr) {
          reject(parseErr);
        }
      },
    );
  });
}

export type EtradeAccount = {
  accountIdKey: string;
  accountId?: string;
  accountName?: string;
  accountDesc?: string;
  accountMode?: string;
  accountStatus?: string;
  accountType?: string;
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

export async function listAccounts(): Promise<EtradeAccount[]> {
  const data = await apiGet<{
    AccountListResponse?: { Accounts?: { Account?: EtradeAccount | EtradeAccount[] } };
  }>("/v1/accounts/list");
  const raw = data.AccountListResponse?.Accounts?.Account;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export async function getPortfolio(accountIdKey?: string): Promise<{
  accountIdKey: string;
  positions: PositionRow[];
  totals: {
    marketValue: number;
    totalCost: number;
    totalGain: number;
    daysGain: number;
  };
}> {
  let key = accountIdKey;
  if (!key) {
    const accounts = await listAccounts();
    if (!accounts.length) {
      throw new Error("No E*TRADE accounts found (sandbox may be empty)");
    }
    key = accounts[0].accountIdKey;
  }

  const data = await apiGet<{
    PortfolioResponse?: {
      AccountPortfolio?:
        | {
            Position?: unknown;
            totalMarketValue?: number;
          }
        | Array<{ Position?: unknown; totalMarketValue?: number }>;
    };
  }>(`/v1/accounts/${encodeURIComponent(key)}/portfolio`);

  const portfolios = asArray(data.PortfolioResponse?.AccountPortfolio);
  const positionsRaw = portfolios.flatMap((p) => asArray(p.Position));

  const positions: PositionRow[] = positionsRaw.map((pos) => {
    const p = pos as Record<string, unknown>;
    const product = (p.Product ?? {}) as Record<string, unknown>;
    const quick = (p.Quick ?? {}) as Record<string, unknown>;
    const symbol = String(product.symbol ?? p.symbolDescription ?? "—");
    const quantity = Number(p.quantity ?? 0);
    const pricePaid = num(p.pricePaid);
    const marketValue = num(p.marketValue);
    const totalCost =
      num(p.totalCost) ??
      (pricePaid != null ? pricePaid * Math.abs(quantity) : null);
    const totalGain = num(p.totalGain) ?? num(quick.totalGain);
    const daysGain = num(p.daysGain) ?? num(quick.daysGain);

    return {
      symbolDescription: String(p.symbolDescription ?? symbol),
      symbol,
      quantity,
      pricePaid,
      marketValue,
      totalCost,
      totalGain,
      totalGainPct: num(p.totalGainPct) ?? num(quick.totalGainPct),
      daysGain,
      daysGainPct: num(p.daysGainPct) ?? num(quick.daysGainPct),
      typeCode: product.securityType ? String(product.securityType) : null,
    };
  });

  const totals = positions.reduce(
    (acc, row) => {
      acc.marketValue += row.marketValue ?? 0;
      acc.totalCost += row.totalCost ?? 0;
      acc.totalGain += row.totalGain ?? 0;
      acc.daysGain += row.daysGain ?? 0;
      return acc;
    },
    { marketValue: 0, totalCost: 0, totalGain: 0, daysGain: 0 },
  );

  return { accountIdKey: key, positions, totals };
}

export type OrderStatus =
  | "OPEN"
  | "EXECUTED"
  | "CANCELLED"
  | "INDIVIDUAL_FILLS"
  | "CANCEL_REQUESTED"
  | "EXPIRED"
  | "REJECTED"
  | string;

export type BrokerOrder = {
  orderId: string;
  orderType: string | null;
  status: OrderStatus;
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

function epochToIso(v: unknown): string | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  // E*TRADE sometimes returns ms, sometimes seconds-ish large ints
  const ms = v > 1e12 ? v : v > 1e10 ? v : v * 1000;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export async function listOrders(opts?: {
  accountIdKey?: string;
  status?: string;
  count?: number;
  symbol?: string;
}): Promise<{ accountIdKey: string; orders: BrokerOrder[]; fetchedAt: string }> {
  let key = opts?.accountIdKey;
  if (!key) {
    const accounts = await listAccounts();
    if (!accounts.length) {
      throw new Error("No E*TRADE accounts found");
    }
    key = accounts[0].accountIdKey;
  }

  const params = new URLSearchParams();
  params.set("count", String(Math.min(100, Math.max(1, opts?.count ?? 50))));
  if (opts?.status) params.set("status", opts.status);
  if (opts?.symbol) params.set("symbol", opts.symbol.toUpperCase());

  const data = await apiGet<{
    OrdersResponse?: {
      Order?: unknown;
      marker?: string;
    };
  }>(`/v1/accounts/${encodeURIComponent(key)}/orders?${params.toString()}`);

  const ordersRaw = asArray(data.OrdersResponse?.Order);
  const orders: BrokerOrder[] = ordersRaw.map((raw) => {
    const o = raw as Record<string, unknown>;
    const details = asArray(o.OrderDetail as unknown);
    const detail = (details[0] ?? {}) as Record<string, unknown>;
    const instruments = asArray(detail.Instrument as unknown);
    const inst = (instruments[0] ?? {}) as Record<string, unknown>;
    const product = (inst.Product ?? {}) as Record<string, unknown>;
    const messages = asArray(
      (detail.messages as { Message?: unknown } | undefined)?.Message,
    ).map((m) => {
      const row = m as Record<string, unknown>;
      return {
        type: String(row.type ?? "INFO"),
        code: typeof row.code === "number" ? row.code : null,
        description: String(row.description ?? ""),
      };
    });
    const events = asArray(
      (o.Events as { Event?: unknown } | undefined)?.Event ??
        (detail.Events as { Event?: unknown } | undefined)?.Event,
    ).map((e) => {
      const row = e as Record<string, unknown>;
      return {
        name: String(row.name ?? ""),
        dateTime: epochToIso(row.dateTime),
      };
    });

    const ey = num(product.expiryYear);
    const em = num(product.expiryMonth);
    const ed = num(product.expiryDay);
    const expiry =
      ey != null && em != null && ed != null
        ? `${ey}-${pad2(em)}-${pad2(ed)}`
        : null;

    const orderId =
      o.orderId != null
        ? String(o.orderId)
        : detail.orderNumber != null
          ? String(detail.orderNumber)
          : "—";

    return {
      orderId,
      orderType: o.orderType != null ? String(o.orderType) : null,
      status: String(detail.status ?? o.status ?? "UNKNOWN"),
      orderValue: num(detail.orderValue) ?? num(o.orderValue),
      placedTime: epochToIso(detail.placedTime) ?? epochToIso(o.placedTime),
      executedTime:
        epochToIso(detail.executedTime) ?? epochToIso(o.executedTime),
      priceType: detail.priceType != null ? String(detail.priceType) : null,
      limitPrice: num(detail.limitPrice),
      stopPrice: num(detail.stopPrice),
      stopLimitPrice: num(detail.stopLimitPrice),
      offsetValue: num(detail.offsetValue),
      orderTerm: detail.orderTerm != null ? String(detail.orderTerm) : null,
      marketSession:
        detail.marketSession != null ? String(detail.marketSession) : null,
      allOrNone:
        typeof detail.allOrNone === "boolean" ? detail.allOrNone : null,
      symbol: product.symbol != null ? String(product.symbol) : null,
      symbolDescription:
        inst.symbolDescription != null
          ? String(inst.symbolDescription)
          : null,
      osiKey: inst.osiKey != null ? String(inst.osiKey) : null,
      orderAction: inst.orderAction != null ? String(inst.orderAction) : null,
      quantity: num(inst.quantity),
      orderedQuantity: num(inst.orderedQuantity),
      filledQuantity: num(inst.filledQuantity),
      cancelQuantity: num(inst.cancelQuantity),
      averageExecutionPrice: num(inst.averageExecutionPrice),
      callPut: product.callPut != null ? String(product.callPut) : null,
      strikePrice: num(product.strikePrice),
      expiry,
      estimatedCommission: num(detail.estimatedCommission),
      estimatedTotalAmount: num(detail.estimatedTotalAmount),
      messages,
      events,
    };
  });

  return {
    accountIdKey: key,
    orders,
    fetchedAt: new Date().toISOString(),
  };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
