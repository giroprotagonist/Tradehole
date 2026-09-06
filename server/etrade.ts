import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

function apiBase(): string {
  return etradeEnv() === "production"
    ? "https://api.etrade.com"
    : "https://apisb.etrade.com";
}

/** OAuth request/access/renew share the same host as market APIs (sandbox ≠ prod). */
function oauthBase(): string {
  return apiBase();
}

type TokenPair = { token: string; tokenSecret: string };

let requestTokens: TokenPair | null = null;
/** When the pending request token was obtained (E*TRADE expires these in ~5 minutes). */
let requestTokenObtainedAt: number | null = null;
let accessTokens: TokenPair | null = null;
let authorizedAt: string | null = null;

const ACCESS_TOKEN_STALE_HINT =
  "E*TRADE rejected the access_token exchange (often HTTP 500 HTML). " +
  "Request tokens and verification codes expire in a few minutes and are single-use. " +
  "Click Open authorize URL again, paste the NEW code immediately, then Complete. " +
  "This is usually not a wrong password — do not reuse an old code.";

function requireKeys(): void {
  if (!consumerKey() || !consumerSecret()) {
    throw new Error(
      "Missing ETRADE_CONSUMER_KEY / ETRADE_CONSUMER_SECRET in .env",
    );
  }
}

function createOAuth(): OAuth {
  requireKeys();
  const base = oauthBase();
  const oa = new OAuth(
    `${base}/oauth/request_token`,
    `${base}/oauth/access_token`,
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
  requestTokenObtainedAt = null;
  accessTokens = null;
  authorizedAt = null;
}

function clearPendingRequestToken(): void {
  requestTokens = null;
  requestTokenObtainedAt = null;
}

function formatAccessTokenError(err: unknown): string {
  const detail =
    typeof err === "object" && err && "data" in err
      ? String((err as { data?: unknown }).data)
      : typeof err === "object" && err && "statusCode" in err
        ? `status ${(err as { statusCode?: unknown }).statusCode}`
        : String(err ?? "");
  const status =
    typeof err === "object" && err && "statusCode" in err
      ? Number((err as { statusCode?: unknown }).statusCode)
      : NaN;
  const html500 =
    status === 500 ||
    /HTTP Status 500|Internal Server Error|<!doctype html/i.test(detail);
  const oauthProblem = detail.match(/oauth_problem=([a-zA-Z0-9_]+)/i)?.[1];
  if (html500 || oauthProblem === "token_expired" || oauthProblem === "token_rejected") {
    return `access_token failed: ${ACCESS_TOKEN_STALE_HINT}`;
  }
  const short = detail.replace(/\s+/g, " ").trim().slice(0, 280);
  return `access_token failed: ${short || JSON.stringify(err)}`;
}

export function startOAuth(): Promise<{ authorizeUrl: string }> {
  requireKeys();
  const oa = getOAuth();
  return new Promise((resolve, reject) => {
    oa.getOAuthRequestToken((err, token, tokenSecret) => {
      if (err || !token || !tokenSecret) {
        const detail =
          typeof err === "object" && err && "data" in err
            ? String((err as { data?: unknown }).data).slice(0, 600)
            : JSON.stringify(err);
        let msg = `request_token failed: ${detail || JSON.stringify(err)}`;
        if (/404|Not Found|<html|Apache Tomcat/i.test(msg)) {
          msg +=
            ` — HTML/404 from OAuth usually means sandbox/prod key mismatch.` +
            ` Set ETRADE_ENV to match your consumer key (sandbox→apisb.etrade.com,` +
            ` production→api.etrade.com). Current ETRADE_ENV=${etradeEnv()}, oauth host=${oauthBase()}.`;
        }
        reject(new Error(msg));
        return;
      }
      requestTokens = { token, tokenSecret };
      requestTokenObtainedAt = Date.now();
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
  const code = verifier.trim();
  if (!code) {
    return Promise.reject(new Error("Verification code required (paste the code from E*TRADE)"));
  }
  if (!requestTokens) {
    return Promise.reject(
      new Error(
        "No pending request token — click Open authorize URL first, then paste a fresh verification code",
      ),
    );
  }
  const ageMs =
    requestTokenObtainedAt != null ? Date.now() - requestTokenObtainedAt : null;
  if (ageMs != null && ageMs > 5 * 60 * 1000) {
    clearPendingRequestToken();
    return Promise.reject(
      new Error(
        `Request token is ~${Math.round(ageMs / 60000)} min old (E*TRADE expires them in ~5 min). ${ACCESS_TOKEN_STALE_HINT}`,
      ),
    );
  }
  const oa = getOAuth();
  const { token, tokenSecret } = requestTokens;
  return new Promise((resolve, reject) => {
    oa.getOAuthAccessToken(
      token,
      tokenSecret,
      code,
      (err, accessToken, accessTokenSecret) => {
        if (err || !accessToken || !accessTokenSecret) {
          // Burned/expired request tokens cannot be retried — force a fresh start.
          clearPendingRequestToken();
          reject(new Error(formatAccessTokenError(err)));
          return;
        }
        setAccessTokens(accessToken, accessTokenSecret);
        clearPendingRequestToken();
        resolve({ accessToken, accessTokenSecret });
      },
    );
  });
}

const SESSION_EXPIRED_MSG =
  "E*TRADE session expired — reconnect (Open authorize URL + verification code). Renew only works while the access token is still renewable (~2h idle).";

export function renewAccessToken(): Promise<void> {
  if (!accessTokens) {
    return Promise.reject(new Error("Not authorized"));
  }
  const oa = getOAuth();
  const { token, tokenSecret } = accessTokens;
  return new Promise((resolve, reject) => {
    oa.get(
      `${oauthBase()}/oauth/renew_access_token`,
      token,
      tokenSecret,
      (err) => {
        if (err) {
          if (isTokenExpiredError(err)) {
            clearSession();
            reject(new Error(SESSION_EXPIRED_MSG));
            return;
          }
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
  // E*TRADE sometimes returns 200 with an empty body (e.g. no open orders).
  if (!text) {
    return {} as T;
  }
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

function isTokenExpiredError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err && "data" in err
        ? String((err as { data?: unknown }).data)
        : String(err);
  return /token_expired|oauth_problem=token_expired/i.test(msg);
}

/** Serialize renew so concurrent 401s don't stampede E*TRADE. */
let renewInFlight: Promise<void> | null = null;

async function renewAccessTokenOnce(): Promise<void> {
  if (!renewInFlight) {
    renewInFlight = renewAccessToken().finally(() => {
      renewInFlight = null;
    });
  }
  await renewInFlight;
}

/**
 * E*TRADE access tokens expire after ~2h of idle time.
 * On token_expired, renew once and retry the call.
 * If renew itself fails (token past renew window), clear the session.
 */
async function withTokenRetry<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (!isTokenExpiredError(err) || !accessTokens) throw err;
    try {
      await renewAccessTokenOnce();
    } catch (renewErr) {
      if (isTokenExpiredError(renewErr) || String(renewErr).includes("session expired")) {
        clearSession();
        throw new Error(SESSION_EXPIRED_MSG);
      }
      throw renewErr;
    }
    return op();
  }
}

function apiGetRaw<T>(path: string): Promise<T> {
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

export function apiGet<T>(path: string): Promise<T> {
  return withTokenRetry(() => apiGetRaw<T>(path));
}

function apiPostRaw<T>(path: string, payload: unknown): Promise<T> {
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

export function apiPost<T>(path: string, payload: unknown): Promise<T> {
  return withTokenRetry(() => apiPostRaw<T>(path, payload));
}

function apiPutRaw<T>(path: string, payload: unknown): Promise<T> {
  if (!accessTokens) {
    return Promise.reject(new Error("Not authorized — complete E*TRADE OAuth first"));
  }
  const oa = getOAuth();
  const { jsonPath, url } = jsonApiPath(path);
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    oa.put(
      url,
      accessTokens!.token,
      accessTokens!.tokenSecret,
      body,
      "application/json",
      (err, responseBody) => {
        if (err) {
          reject(new Error(`E*TRADE PUT ${jsonPath}: ${etradeErrorDetail(err)}`));
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

export function apiPut<T>(path: string, payload: unknown): Promise<T> {
  return withTokenRetry(() => apiPutRaw<T>(path, payload));
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

function normalizeAccountRef(v: string): string {
  return v.replace(/\s+/g, "").trim();
}

/**
 * Resolve an E*TRADE accountIdKey from an opaque key, visible account number
 * (e.g. "456138105" / "456 138105"), or optional env default
 * (ETRADE_ACCOUNT_ID / ETRADE_ACCOUNT_ID_KEY). Falls back to the first account.
 */
export async function resolveAccount(
  accountIdKeyOrId?: string,
): Promise<{ key: string; account: EtradeAccount; accounts: EtradeAccount[] }> {
  const accounts = await listAccounts();
  if (!accounts.length) {
    throw new Error("No E*TRADE accounts found (sandbox may be empty)");
  }

  const explicit = accountIdKeyOrId?.trim() ? accountIdKeyOrId.trim() : undefined;
  const preferredEnv = (
    process.env.ETRADE_ACCOUNT_ID_KEY?.trim() ||
    process.env.ETRADE_ACCOUNT_ID?.trim() ||
    ""
  );
  const candidates = [explicit, preferredEnv].filter(Boolean) as string[];

  for (const raw of candidates) {
    const norm = normalizeAccountRef(raw);
    const match = accounts.find(
      (a) =>
        a.accountIdKey === raw ||
        a.accountIdKey === norm ||
        (a.accountId != null && normalizeAccountRef(String(a.accountId)) === norm),
    );
    if (match) {
      return { key: match.accountIdKey, account: match, accounts };
    }
    // Explicit request that didn't match — fail loud (don't silently use another account).
    if (raw === explicit) {
      throw new Error(
        `E*TRADE account not found for "${raw}". Known: ${accounts
          .map((a) => `${a.accountDesc ?? a.accountType ?? "acct"}:${a.accountId ?? a.accountIdKey}`)
          .join(", ")}`,
      );
    }
  }

  return { key: accounts[0].accountIdKey, account: accounts[0], accounts };
}

export async function resolveAccountIdKey(accountIdKeyOrId?: string): Promise<string> {
  const { key } = await resolveAccount(accountIdKeyOrId);
  return key;
}

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
  /** Set on Robinhood/external book rows (peer account; not merged into ET). */
  broker?: string | null;
  brokerTag?: string | null;
  externalId?: string | null;
  mark?: number | null;
  bid?: number | null;
  ask?: number | null;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientEtradeError(err: unknown): boolean {
  const msg = String(err);
  return /429|500|502|503|504|timeout|ECONNRESET|ETIMEDOUT|socket hang up|rate.?limit/i.test(
    msg,
  );
}

async function withTransientRetry<T>(
  label: string,
  op: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      if (!isTransientEtradeError(err) || i === attempts) break;
      const wait = 350 * i * i;
      console.warn(
        `[tradehole] ${label} failed (attempt ${i}/${attempts}), retry in ${wait}ms:`,
        String(err).slice(0, 200),
      );
      await sleep(wait);
    }
  }
  throw lastErr;
}

type PortfolioPage = {
  Position?: unknown;
  totalMarketValue?: number;
  marker?: string | number;
  next?: string;
  pageNumber?: number;
  totalPages?: number;
};

function assertNoEtradeErrorPayload(data: unknown, context: string): void {
  if (!data || typeof data !== "object") return;
  const row = data as Record<string, unknown>;
  const err =
    row.Error ??
    row.ErrorResponse ??
    row.error ??
    (row.PortfolioResponse as Record<string, unknown> | undefined)?.Error;
  if (!err) return;
  const detail =
    typeof err === "string"
      ? err
      : JSON.stringify(err).slice(0, 400);
  throw new Error(`E*TRADE ${context}: ${detail}`);
}

function mapPositionRow(pos: unknown): PositionRow {
  const p = pos as Record<string, unknown>;
  const product = (p.Product ?? {}) as Record<string, unknown>;
  const quick = (p.Quick ?? {}) as Record<string, unknown>;
  const complete = (p.Complete ?? {}) as Record<string, unknown>;
  const performance = (p.Performance ?? {}) as Record<string, unknown>;
  const symbol = String(product.symbol ?? p.symbolDescription ?? "—");
  const quantity = Number(p.quantity ?? 0);
  const pricePaid = num(p.pricePaid);
  const marketValue = num(p.marketValue);
  const totalCost =
    num(p.totalCost) ??
    (pricePaid != null ? pricePaid * Math.abs(quantity) : null);
  const totalGain =
    num(p.totalGain) ??
    num(quick.totalGain) ??
    num(complete.totalGain) ??
    num(performance.totalGain);
  const daysGain =
    num(p.daysGain) ??
    num(quick.daysGain) ??
    num(complete.daysGain) ??
    num(performance.daysGain);

  return {
    symbolDescription: String(p.symbolDescription ?? symbol),
    symbol,
    quantity,
    pricePaid,
    marketValue,
    totalCost,
    totalGain,
    totalGainPct:
      num(p.totalGainPct) ??
      num(quick.totalGainPct) ??
      num(complete.totalGainPct) ??
      num(performance.totalGainPct),
    daysGain,
    daysGainPct:
      num(p.daysGainPct) ??
      num(quick.daysGainPct) ??
      num(complete.daysGainPct) ??
      num(performance.daysGainPct),
    typeCode: product.securityType
      ? String(product.securityType)
      : p.positionType != null
        ? String(p.positionType)
        : null,
  };
}

async function fetchPortfolioPages(
  key: string,
  view: "QUICK" | "COMPLETE",
): Promise<{ positions: PositionRow[]; warnings: string[] }> {
  const positionsRaw: unknown[] = [];
  const warnings: string[] = [];
  let marker: string | undefined;

  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({
      count: "50",
      view,
    });
    if (marker) params.set("marker", marker);

    let data: {
      PortfolioResponse?: { AccountPortfolio?: PortfolioPage | PortfolioPage[] };
    };
    try {
      data = await withTransientRetry(
        `portfolio ${view} p${page}`,
        () =>
          apiGet(
            `/v1/accounts/${encodeURIComponent(key)}/portfolio?${params.toString()}`,
          ),
      );
    } catch (err) {
      // Keep first-page failures fatal for this view; later pages soft-fail.
      if (page === 0) throw err;
      warnings.push(
        `Stopped pagination at page ${page} (${view}): ${String(err).slice(0, 180)}`,
      );
      break;
    }

    assertNoEtradeErrorPayload(data, `portfolio ${view}`);
    const portfolios = asArray(data.PortfolioResponse?.AccountPortfolio);
    if (!portfolios.length) {
      if (page === 0) warnings.push(`Empty AccountPortfolio (${view})`);
      break;
    }

    let nextMarker: string | undefined;
    for (const p of portfolios) {
      positionsRaw.push(...asArray(p.Position));
      const m = p.marker != null ? String(p.marker).trim() : "";
      if (m) nextMarker = m;
    }
    if (!nextMarker || nextMarker === marker) break;
    marker = nextMarker;
    // Gentle pacing between pages — E*TRADE rate-limits bursty account reads.
    await sleep(120);
  }

  return { positions: positionsRaw.map(mapPositionRow), warnings };
}

export type PortfolioResult = {
  accountIdKey: string;
  accountId: string | null;
  accountDesc: string | null;
  accountType: string | null;
  accountMode: string | null;
  positions: PositionRow[];
  totals: {
    marketValue: number;
    totalCost: number;
    totalGain: number;
    daysGain: number;
  };
  warnings?: string[];
  view?: string;
  stale?: boolean;
  cachedAt?: string;
};

export async function getPortfolio(accountIdKeyOrId?: string): Promise<PortfolioResult> {
  const { key, account } = await resolveAccount(accountIdKeyOrId);

  // QUICK is what worked historically; COMPLETE is richer but flaky on some
  // IRA/Roth books and after-hours — try QUICK first, then COMPLETE.
  // Treat empty AccountPortfolio on QUICK as soft-fail (some books only
  // populate under COMPLETE); a truly empty account stays empty after both.
  let lastErr: unknown;
  let used: { positions: PositionRow[]; warnings: string[]; view: string } | null =
    null;
  for (const view of ["QUICK", "COMPLETE"] as const) {
    try {
      const page = await fetchPortfolioPages(key, view);
      const emptyQuick =
        view === "QUICK" &&
        page.positions.length === 0 &&
        page.warnings.some((w) => /Empty AccountPortfolio/i.test(w));
      if (emptyQuick) {
        lastErr = new Error(page.warnings.join("; ") || "empty QUICK portfolio");
        console.warn(
          `[tradehole] getPortfolio QUICK empty for ${account.accountDesc ?? key}; trying COMPLETE`,
        );
        continue;
      }
      used = { ...page, view };
      break;
    } catch (err) {
      lastErr = err;
      console.warn(
        `[tradehole] getPortfolio ${view} failed for ${account.accountDesc ?? key}:`,
        String(err).slice(0, 240),
      );
    }
  }
  if (!used) {
    const cached = readCachedPortfolio(key, account);
    if (cached) return cached;
    throw lastErr instanceof Error
      ? lastErr
      : new Error(String(lastErr ?? "portfolio fetch failed"));
  }

  const totals = used.positions.reduce(
    (acc, row) => {
      acc.marketValue += row.marketValue ?? 0;
      acc.totalCost += row.totalCost ?? 0;
      acc.totalGain += row.totalGain ?? 0;
      acc.daysGain += row.daysGain ?? 0;
      return acc;
    },
    { marketValue: 0, totalCost: 0, totalGain: 0, daysGain: 0 },
  );

  const result: PortfolioResult = {
    accountIdKey: key,
    accountId: account.accountId != null ? String(account.accountId) : null,
    accountDesc: account.accountDesc ?? account.accountName ?? null,
    accountType: account.accountType ?? null,
    accountMode: account.accountMode ?? null,
    positions: used.positions,
    totals,
    warnings: used.warnings.length ? used.warnings : undefined,
    view: used.view,
  };
  rememberPortfolioSnapshot(result);
  return result;
}

function portfolioCachePath(): string {
  const dir =
    process.env.TRADEHOLE_DATA_DIR ||
    path.join(os.homedir(), "Library", "Application Support", "Tradehole");
  return path.join(dir, "portfolio-cache.json");
}

function readCachedPortfolio(
  key: string,
  account: {
    accountId?: unknown;
    accountDesc?: string | null;
    accountName?: string | null;
    accountType?: string | null;
    accountMode?: string | null;
  },
): PortfolioResult | null {
  try {
    const raw = fs.readFileSync(portfolioCachePath(), "utf8");
    const json = JSON.parse(raw) as {
      portfolios?: Array<{
        accountIdKey?: string;
        accountId?: string | null;
        accountDesc?: string | null;
        accountType?: string | null;
        accountMode?: string | null;
        positions?: PositionRow[];
        totals?: PortfolioResult["totals"];
        view?: string;
      }>;
    };
    const row = (json.portfolios ?? []).find((p) => p.accountIdKey === key);
    if (!row?.positions || !row.totals) return null;
    return {
      accountIdKey: key,
      accountId:
        row.accountId ??
        (account.accountId != null ? String(account.accountId) : null),
      accountDesc:
        row.accountDesc ?? account.accountDesc ?? account.accountName ?? null,
      accountType: row.accountType ?? account.accountType ?? null,
      accountMode: row.accountMode ?? account.accountMode ?? null,
      positions: row.positions,
      totals: row.totals,
      warnings: ["Serving last-good portfolio cache after live E*TRADE failed."],
      view: row.view ?? "cache",
    };
  } catch {
    return null;
  }
}
export function rememberPortfolioSnapshot(row: PortfolioResult): void {
  try {
    const dir =
      process.env.TRADEHOLE_DATA_DIR ||
      path.join(os.homedir(), "Library", "Application Support", "Tradehole");
    const file = path.join(dir, "portfolio-cache.json");
    fs.mkdirSync(dir, { recursive: true });
    let existing: {
      cachedAt: string;
      accounts: unknown[];
      portfolios: Array<Record<string, unknown>>;
    } = { cachedAt: new Date().toISOString(), accounts: [], portfolios: [] };
    if (fs.existsSync(file)) {
      try {
        existing = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {
        /* reset */
      }
    }
    const next = (existing.portfolios ?? []).filter(
      (p) => p.accountIdKey !== row.accountIdKey,
    );
    next.push({
      accountIdKey: row.accountIdKey,
      accountId: row.accountId,
      accountDesc: row.accountDesc,
      accountType: row.accountType,
      accountMode: row.accountMode,
      positions: row.positions,
      totals: row.totals,
      view: row.view,
    });
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          cachedAt: new Date().toISOString(),
          accounts: existing.accounts ?? [],
          portfolios: next,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.warn("[tradehole] rememberPortfolioSnapshot failed:", err);
  }
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
  const key = await resolveAccountIdKey(opts?.accountIdKey);

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
