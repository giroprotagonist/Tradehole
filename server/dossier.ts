import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import YahooFinance from "yahoo-finance2";
import { getEnergyQuotes, getOptionsChain, getStockQuote } from "./market";
import { getVolatilityReport } from "./volatility";
import { getAuthStatus, getPortfolio, listAccounts, listOrders, resolveAccount } from "./etrade";
import {
  etradeMarketAvailable,
  etradeOptionQuoteSymbol,
  getEtradeRawQuotes,
} from "./etradeMarket";
import { getPhysicalMarkets } from "./physical";
import { buildDecisionIntel } from "./intel";
import { buildHistoryDigest } from "./history/digest";
import {
  listMarkedExternalPositions,
  sumExternalTotals,
} from "./externalPositions";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const FOCUS_EXPIRY = "2026-09-18";
const FOCUS_STRIKE = 46;

const QUOTE_SUMMARY_MODULES = [
  "assetProfile",
  "summaryDetail",
  "defaultKeyStatistics",
  "financialData",
  "calendarEvents",
  "recommendationTrend",
  "upgradeDowngradeHistory",
  "earnings",
  "earningsHistory",
  "earningsTrend",
  "institutionOwnership",
  "majorHoldersBreakdown",
  "insiderTransactions",
  "price",
  "quoteType",
] as const;

type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

async function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await p };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function dataDir(): string {
  if (process.env.TRADEHOLE_DATA_DIR) return process.env.TRADEHOLE_DATA_DIR;
  return path.join(os.homedir(), "Library", "Application Support", "Tradehole");
}

function readIvSnapshots(symbol: string): unknown {
  try {
    const p = path.join(dataDir(), "iv-snapshots", `${symbol.toUpperCase()}.json`);
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    return { error: String(err) };
  }
}

function compactJson(value: unknown, maxLen = 180_000): string {
  const text = JSON.stringify(value, (_k, v) => {
    if (typeof v === "bigint") return v.toString();
    if (v instanceof Date) return v.toISOString();
    return v;
  }, 2);
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}\n… [truncated ${text.length - maxLen} chars]`;
}

function section(title: string, body: string): string {
  return `\n## ${title}\n\n${body.trim()}\n`;
}

function ageSeconds(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((nowMs - t) / 1000));
}

function fmtAge(sec: number | null): string {
  if (sec == null) return "unknown";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
}

type YahooSearchResult = {
  news?: Array<{
    title?: string;
    relatedTickers?: string[];
    [k: string]: unknown;
  }>;
  quotes?: unknown[];
  [k: string]: unknown;
};

/** Prefer company-name Yahoo search; filter to ticker-relevant headlines when possible. */
async function fetchCompanyNews(symbol: string, companyName: string | null): Promise<unknown> {
  const query = companyName
    ? `"${companyName.replace(/\s+/g, " ").trim()}" ${symbol} OR "${symbol}" tanker OR Frontline`
    : `"${symbol}" tanker OR shipping OR VLCC`;
  const raw = (await yahooFinance.search(query, {
    quotesCount: 8,
    newsCount: 30,
  })) as YahooSearchResult;

  const news = Array.isArray(raw.news) ? raw.news : [];
  const sym = symbol.toUpperCase();
  const nameUpper = companyName?.toUpperCase() ?? "";
  const nameTokens = nameUpper
    .split(/\s+/)
    .filter((t) => t.length >= 5 && !["PLC", "INC", "LTD", "CORP", "ASA"].includes(t));

  const filtered = news.filter((n) => {
    const tickers = (n.relatedTickers ?? []).map((t) => String(t).toUpperCase());
    if (tickers.includes(sym)) return true;
    const title = String(n.title ?? "").toUpperCase();
    // Require ticker as a token (not substring of unrelated words).
    if (new RegExp(`\\b${sym}\\b`).test(title)) return true;
    if (nameUpper && title.includes(nameUpper)) return true;
    // Multi-token company match only (avoids "Front" false positives from first token).
    if (nameTokens.length >= 1 && nameTokens.every((t) => title.includes(t))) {
      return true;
    }
    return false;
  });

  return {
    searchQuery: query,
    newsFilter:
      filtered.length > 0 ? "ticker_strict" : "empty_no_unfiltered_fallback",
    newsCount: filtered.length,
    news: filtered,
    quotes: raw.quotes ?? [],
    note:
      filtered.length > 0
        ? `Ticker-strict Yahoo news for ${sym} (${filtered.length}/${news.length} matched).`
        : `No ticker-strict headlines for ${sym}; omitting raw Yahoo results (query "${query}" often returns unrelated ticker collisions).`,
  };
}

async function fetchAllOptions(symbol: string): Promise<unknown> {
  const first = await getOptionsChain(symbol);
  const expiries = first.expirationDates;
  const chains = [];
  for (const expiry of expiries) {
    try {
      const chain =
        expiry === first.selectedExpiry ? first : await getOptionsChain(symbol, expiry);
      chains.push({
        expiry: chain.selectedExpiry,
        underlyingPrice: chain.underlyingPrice,
        source: chain.source,
        fetchedAt: chain.fetchedAt,
        callCount: chain.calls.length,
        putCount: chain.puts.length,
        calls: chain.calls,
        puts: chain.puts,
      });
    } catch (err) {
      chains.push({ expiry, error: String(err) });
    }
  }
  const sources = [
    ...new Set(
      chains
        .map((c) => (c as { source?: string }).source)
        .filter((s): s is string => Boolean(s)),
    ),
  ];
  const focusChain = chains.find(
    (c) => (c as { expiry?: string }).expiry === FOCUS_EXPIRY,
  ) as { source?: string } | undefined;
  // Prefer focus-expiry source for pack headers (was nearest-expiry only).
  const primarySource = focusChain?.source ?? first.source;
  return {
    feedSources: sources,
    primarySource,
    mixedSources: sources.length > 1,
    focusExpirySource: focusChain?.source ?? null,
    fetchedAt: first.fetchedAt,
    expirationDates: expiries,
    chains,
    note:
      sources.length > 1
        ? `Mixed option feeds in this pack: ${sources.join(", ")}. Prefer etrade:* rows; Yahoo means that expiry failed E*TRADE after retry.`
        : undefined,
  };
}

type CachedPortfolios = {
  cachedAt: string;
  accounts: unknown[];
  portfolios: Array<Record<string, unknown>>;
};

function portfolioCachePath(): string {
  return path.join(dataDir(), "portfolio-cache.json");
}

function readPortfolioCache(): CachedPortfolios | null {
  try {
    const p = portfolioCachePath();
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8")) as CachedPortfolios;
  } catch {
    return null;
  }
}

function writePortfolioCache(payload: CachedPortfolios): void {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(portfolioCachePath(), JSON.stringify(payload, null, 2));
  } catch (err) {
    console.warn("[tradehole] failed to write portfolio cache:", err);
  }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchEtradeLiveBundle(symbol: string): Promise<unknown> {
  const status = getAuthStatus();
  if (!status.authorized) {
    return {
      authorized: false,
      status,
      note: "E*TRADE not authorized — equity/options in this dossier may fall back to Yahoo delayed.",
    };
  }

  const focusExpiry = "2026-09-18";
  const focusStrike = 46;
  const focusSym = etradeOptionQuoteSymbol(symbol, focusExpiry, "call", focusStrike);
  const nearSpotSyms = [
    etradeOptionQuoteSymbol(symbol, "2026-08-21", "call", 40),
    etradeOptionQuoteSymbol(symbol, "2026-08-21", "call", 45),
    focusSym,
  ];

  const accounts = await listAccounts();
  const { key: defaultKey } = await resolveAccount();
  const cache = readPortfolioCache();

  // Sequential account reads — parallel storms were failing EOD packs (429/5xx).
  const portfolios: Array<Record<string, unknown>> = [];
  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i]!;
    try {
      const live = await getPortfolio(a.accountIdKey);
      portfolios.push({ ...live, stale: false });
    } catch (err) {
      const cached = cache?.portfolios?.find(
        (p) => p.accountIdKey === a.accountIdKey,
      );
      if (cached) {
        portfolios.push({
          ...cached,
          stale: true,
          cachedAt: cache?.cachedAt ?? null,
          liveError: String(err),
        });
      } else {
        portfolios.push({
          accountIdKey: a.accountIdKey,
          accountId: a.accountId != null ? String(a.accountId) : null,
          accountDesc: a.accountDesc ?? a.accountName ?? null,
          accountType: a.accountType ?? null,
          accountMode: a.accountMode ?? null,
          error: String(err),
          positions: [],
          totals: { marketValue: 0, totalCost: 0, totalGain: 0, daysGain: 0 },
        });
      }
    }
    if (i < accounts.length - 1) await sleepMs(200);
  }

  const liveOkCount = portfolios.filter((p) => !p.stale && !p.error).length;
  if (liveOkCount > 0) {
    writePortfolioCache({
      cachedAt: new Date().toISOString(),
      accounts,
      portfolios: portfolios
        .filter((p) => !p.stale && !p.error)
        .map((p) => ({
          accountIdKey: p.accountIdKey,
          accountId: p.accountId,
          accountDesc: p.accountDesc,
          accountType: p.accountType,
          accountMode: p.accountMode,
          positions: p.positions,
          totals: p.totals,
          view: p.view,
        })),
    });
  }

  const focusQuotes = await getEtradeRawQuotes([
    symbol.toUpperCase(),
    ...nearSpotSyms,
  ]);

  const ordersByAccount: Array<Record<string, unknown>> = [];
  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i]!;
    const meta = {
      accountIdKey: a.accountIdKey,
      accountId: a.accountId != null ? String(a.accountId) : null,
      accountDesc: a.accountDesc ?? a.accountName ?? null,
      accountType: a.accountType ?? null,
    };
    try {
      const open = await listOrders({
        accountIdKey: a.accountIdKey,
        status: "OPEN",
        count: 50,
      });
      await sleepMs(120);
      const recent = await listOrders({
        accountIdKey: a.accountIdKey,
        symbol,
        count: 50,
      });
      ordersByAccount.push({
        ...meta,
        openOrders: open.orders,
        recentOrdersForSymbol: recent.orders,
      });
    } catch (err) {
      ordersByAccount.push({
        ...meta,
        error: String(err),
        openOrders: [],
        recentOrdersForSymbol: [],
      });
    }
    if (i < accounts.length - 1) await sleepMs(150);
  }

  const portfolio =
    portfolios.find((p) => p.accountIdKey === defaultKey) ?? portfolios[0] ?? null;
  const openOrdersFlat = ordersByAccount.flatMap((bag) =>
    ((bag.openOrders as unknown[]) ?? []).map((o) => ({
      ...(o as Record<string, unknown>),
      accountIdKey: bag.accountIdKey,
      accountId: bag.accountId,
      accountDesc: bag.accountDesc,
      accountType: bag.accountType,
    })),
  );
  const recentOrdersFlat = ordersByAccount.flatMap((bag) =>
    ((bag.recentOrdersForSymbol as unknown[]) ?? []).map((o) => ({
      ...(o as Record<string, unknown>),
      accountIdKey: bag.accountIdKey,
      accountId: bag.accountId,
      accountDesc: bag.accountDesc,
      accountType: bag.accountType,
    })),
  );

  const staleCount = portfolios.filter((p) => p.stale).length;
  const errCount = portfolios.filter((p) => p.error).length;

  return {
    authorized: true,
    status,
    marketDataAvailable: etradeMarketAvailable(),
    fetchedAt: new Date().toISOString(),
    note:
      "Live E*TRADE production pack: ALL accounts (brokerage + Roth/IRA/etc.), paginated portfolio marks (QUICK→COMPLETE fallback), open + recent FRO orders per account, raw quotes. If live portfolio calls fail, last-good cache is used (stale:true).",
    portfolioFetch: {
      accounts: accounts.length,
      liveOk: liveOkCount,
      staleFromCache: staleCount,
      failed: errCount,
      cacheUsed: staleCount > 0,
      cacheAge: cache?.cachedAt ?? null,
    },
    accounts,
    portfolio,
    portfolios,
    ordersByAccount,
    openOrders: {
      accountIdKey: "ALL",
      orders: openOrdersFlat,
      fetchedAt: new Date().toISOString(),
    },
    recentOrdersForSymbol: {
      accountIdKey: "ALL",
      orders: recentOrdersFlat,
      fetchedAt: new Date().toISOString(),
    },
    focusContracts: {
      equity: symbol.toUpperCase(),
      optionSymbols: nearSpotSyms,
      rawQuotes: focusQuotes,
    },
  };
}

type FocusContractQuote = {
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
  source: string | null;
};

type DossierSnap = {
  generatedAt: string;
  froPrice: number | null;
  optionLast: number | null;
  optionBid: number | null;
  optionAsk: number | null;
  positionGain: number | null;
  positionQty: number | null;
  marketValue: number | null;
  openOrderLimit: number | null;
  openOrderQty: number | null;
};

function dossierSnapPath(symbol: string): string {
  return path.join(dataDir(), "dossier-snapshots", `${symbol.toUpperCase()}.json`);
}

function readLastDossierSnap(symbol: string): DossierSnap | null {
  try {
    const p = dossierSnapPath(symbol);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8")) as DossierSnap;
  } catch {
    return null;
  }
}

function writeDossierSnap(symbol: string, snap: DossierSnap): void {
  const p = dossierSnapPath(symbol);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(snap, null, 2));
}

function numField(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function quoteFromEtradeAll(
  row: Record<string, unknown>,
): FocusContractQuote | null {
  const all = (row.All ?? row.all ?? {}) as Record<string, unknown>;
  const last =
    numField(all.lastTrade) ?? numField(all.lastPrice) ?? numField(all.last);
  const quoteStatus = String(
    row.quoteStatus ?? all.quoteStatus ?? "UNKNOWN",
  ).toLowerCase();
  // Require at least one mark field so we don't claim a blank equity row.
  if (last == null && numField(all.bid) == null && numField(all.ask) == null) {
    return null;
  }
  const rawIv =
    numField(all.optionVolatility) ??
    numField(all.impliedVolatility) ??
    numField(all.OptionVolatility);
  const impliedVolatility =
    rawIv == null ? null : rawIv > 2 ? rawIv / 100 : rawIv;
  return {
    lastPrice: last,
    bid: numField(all.bid),
    ask: numField(all.ask),
    volume: numField(all.totalVolume) ?? numField(all.volume),
    openInterest: numField(all.openInterest),
    impliedVolatility,
    source: `etrade:${quoteStatus}`,
  };
}

/** Prefer live E*TRADE quote payload for Sep18 $46c when section 14 already fetched it. */
function findFocusCallInEtradeLive(etradeLive: unknown): FocusContractQuote | null {
  if (!etradeLive || typeof etradeLive !== "object") return null;
  const live = etradeLive as {
    authorized?: boolean;
    focusContracts?: { optionSymbols?: string[]; rawQuotes?: unknown };
  };
  if (!live.authorized || !live.focusContracts?.rawQuotes) return null;

  const focusKey = etradeOptionQuoteSymbol(
    "FRO",
    FOCUS_EXPIRY,
    "call",
    FOCUS_STRIKE,
  );
  const raw = live.focusContracts.rawQuotes as {
    QuoteResponse?: { QuoteData?: unknown };
  };
  const rows = Array.isArray(raw.QuoteResponse?.QuoteData)
    ? (raw.QuoteResponse!.QuoteData as Record<string, unknown>[])
    : raw.QuoteResponse?.QuoteData
      ? [raw.QuoteResponse.QuoteData as Record<string, unknown>]
      : [];

  // Request order in fetchEtradeLiveBundle: [equity, Aug40c, Aug45c, Sep46c].
  const optionSyms = live.focusContracts.optionSymbols ?? [];
  const focusOptIdx = optionSyms.indexOf(focusKey);
  if (focusOptIdx >= 0 && rows[focusOptIdx + 1]) {
    const hit = quoteFromEtradeAll(rows[focusOptIdx + 1]!);
    if (hit) return hit;
  }

  for (const row of rows) {
    const product = (row.Product ?? row.product ?? {}) as Record<string, unknown>;
    const all = (row.All ?? row.all ?? {}) as Record<string, unknown>;
    const strike = numField(all.strikePrice) ?? numField(product.strikePrice);
    if (strike == null || Math.abs(strike - FOCUS_STRIKE) > 0.01) continue;
    const optType = String(
      product.optionType ?? all.optionType ?? product.callPut ?? "",
    ).toUpperCase();
    const desc = String(
      all.osiKey ?? all.symbolDescription ?? product.symbol ?? "",
    ).toUpperCase();
    const isCall =
      optType.includes("CALL") ||
      optType === "C" ||
      desc.includes("CALL") ||
      desc.includes(":CALL:");
    if (!isCall) continue;
    const hit = quoteFromEtradeAll(row);
    if (hit) return hit;
  }
  return null;
}

function findFocusCallInChains(allOptions: unknown): FocusContractQuote | null {
  if (!allOptions || typeof allOptions !== "object") return null;
  const chains = (allOptions as { chains?: unknown[] }).chains ?? [];
  for (const raw of chains) {
    const chain = raw as {
      expiry?: string;
      source?: string;
      calls?: Array<Record<string, unknown>>;
    };
    if (chain.expiry !== FOCUS_EXPIRY) continue;
    const row = (chain.calls ?? []).find(
      (c) => Math.abs(Number(c.strike) - FOCUS_STRIKE) < 0.01,
    );
    if (!row) continue;
    return {
      lastPrice: typeof row.lastPrice === "number" ? row.lastPrice : null,
      bid: typeof row.bid === "number" ? row.bid : null,
      ask: typeof row.ask === "number" ? row.ask : null,
      volume: typeof row.volume === "number" ? row.volume : null,
      openInterest: typeof row.openInterest === "number" ? row.openInterest : null,
      impliedVolatility:
        typeof row.impliedVolatility === "number" ? row.impliedVolatility : null,
      source: chain.source ?? null,
    };
  }
  return null;
}

function isFocusCallPosition(row: {
  symbol?: string;
  symbolDescription?: string;
}): boolean {
  const desc = String(row.symbolDescription ?? "").toUpperCase();
  const sym = String(row.symbol ?? "").toUpperCase();
  if (!sym.includes("FRO") && !desc.includes("FRO")) return false;
  if (!desc.includes("46") && !sym.includes("46")) return false;
  return desc.includes("CALL") || sym.includes("C");
}

function isFroRelatedPosition(row: {
  symbol?: string;
  symbolDescription?: string;
}): boolean {
  const desc = String(row.symbolDescription ?? "").toUpperCase();
  const sym = String(row.symbol ?? "").toUpperCase();
  return sym.includes("FRO") || desc.includes("FRO");
}

/** Equity shares of FRO (not option contracts). */
function isFroEquityPosition(row: {
  symbol?: string;
  symbolDescription?: string;
  typeCode?: string | null;
}): boolean {
  if (!isFroRelatedPosition(row)) return false;
  const type = String(row.typeCode ?? "").toUpperCase();
  const desc = String(row.symbolDescription ?? "").toUpperCase();
  const sym = String(row.symbol ?? "").toUpperCase().trim();
  if (type.includes("OPT") || type === "OPTN") return false;
  if (/\bCALL\b|\bPUT\b/.test(desc)) return false;
  if (type === "EQ" || type === "EQUITY" || type === "CS") return true;
  // Missing typeCode: treat bare FRO underlier rows as equity.
  return sym === "FRO";
}

function slimPosition(row: Record<string, unknown>) {
  return {
    symbol: row.symbol ?? null,
    symbolDescription: row.symbolDescription ?? null,
    typeCode: row.typeCode ?? null,
    quantity: typeof row.quantity === "number" ? row.quantity : Number(row.quantity ?? 0),
    pricePaid: typeof row.pricePaid === "number" ? row.pricePaid : null,
    totalCost: typeof row.totalCost === "number" ? row.totalCost : null,
    marketValue: typeof row.marketValue === "number" ? row.marketValue : null,
    totalGain: typeof row.totalGain === "number" ? row.totalGain : null,
    totalGainPct: typeof row.totalGainPct === "number" ? row.totalGainPct : null,
    daysGain: typeof row.daysGain === "number" ? row.daysGain : null,
    daysGainPct: typeof row.daysGainPct === "number" ? row.daysGainPct : null,
    broker: row.broker ?? null,
    brokerTag: row.brokerTag ?? null,
    externalId: row.externalId ?? null,
  };
}

async function externalHoldingsBag(): Promise<{
  accountId: string;
  accountDesc: string;
  accountType: string;
  accountMode: null;
  accountIdKey: string;
  error: null;
  stale: false;
  cachedAt: null;
  liveError: null;
  view: string;
  warnings: null;
  positionCount: number;
  froEquityShares: number;
  froEquityMarketValue: number;
  froEquity: ReturnType<typeof slimPosition>[];
  froOptions: ReturnType<typeof slimPosition>[];
  froRelatedCount: number;
  totals: ReturnType<typeof sumExternalTotals>;
} | null> {
  try {
    const marked = await listMarkedExternalPositions();
    if (!marked.length) return null;
    const froRows = marked.filter((p) =>
      isFroRelatedPosition({
        symbol: p.symbol,
        symbolDescription: p.symbolDescription,
      }),
    );
    const options = froRows.map((p) => slimPosition(p as unknown as Record<string, unknown>));
    return {
      accountId: "robinhood",
      accountDesc: "Robinhood",
      accountType: "EXTERNAL",
      accountMode: null,
      accountIdKey: "robinhood",
      error: null,
      stale: false,
      cachedAt: null,
      liveError: null,
      view: "ROBINHOOD",
      warnings: null,
      positionCount: marked.length,
      froEquityShares: 0,
      froEquityMarketValue: 0,
      froEquity: [],
      froOptions: options,
      froRelatedCount: froRows.length,
      totals: sumExternalTotals(marked),
    };
  } catch (err) {
    console.warn("[tradehole] external holdings bag failed:", err);
    return null;
  }
}

async function buildPositionSummary(opts: {
  etradeLive: unknown;
  focusQuote: FocusContractQuote | null;
  froPrice: number | null;
  dte: number | null;
}): Promise<Record<string, unknown>> {
  const live = opts.etradeLive as {
    authorized?: boolean;
    accounts?: Array<{
      accountIdKey?: string;
      accountId?: string | number | null;
      accountDesc?: string | null;
      accountName?: string | null;
      accountType?: string | null;
      accountMode?: string | null;
      accountStatus?: string | null;
    }>;
    portfolio?: {
      positions?: Array<Record<string, unknown>>;
      totals?: Record<string, unknown>;
      accountId?: string | null;
      accountDesc?: string | null;
      accountType?: string | null;
      accountMode?: string | null;
      accountIdKey?: string;
      error?: string;
      stale?: boolean;
      cachedAt?: string | null;
      liveError?: string;
      warnings?: string[];
      view?: string;
    };
    portfolios?: Array<{
      positions?: Array<Record<string, unknown>>;
      totals?: Record<string, unknown>;
      accountId?: string | null;
      accountDesc?: string | null;
      accountType?: string | null;
      accountMode?: string | null;
      accountIdKey?: string;
      error?: string;
      stale?: boolean;
      cachedAt?: string | null;
      liveError?: string;
      warnings?: string[];
      view?: string;
    }>;
    openOrders?: { orders?: Array<Record<string, unknown>> };
    portfolioFetch?: Record<string, unknown>;
  } | null;

  const externalBag = await externalHoldingsBag();

  if (!live?.authorized) {
    return {
      available: Boolean(externalBag),
      reason: externalBag
        ? "E*TRADE not authorized — showing Robinhood account only"
        : "E*TRADE not authorized",
      focusContract: `FRO ${FOCUS_EXPIRY} $${FOCUS_STRIKE} Call`,
      froPrice: opts.froPrice,
      froHoldingsByAccount: externalBag ? [externalBag] : [],
      externalBook: externalBag,
    };
  }

  const accountBags =
    live.portfolios && live.portfolios.length > 0
      ? live.portfolios
      : live.portfolio
        ? [live.portfolio]
        : [];

  const accountsCatalog = (live.accounts ?? []).map((a) => ({
    accountIdKey: a.accountIdKey ?? null,
    accountId: a.accountId != null ? String(a.accountId) : null,
    accountDesc: a.accountDesc ?? a.accountName ?? null,
    accountType: a.accountType ?? null,
    accountMode: a.accountMode ?? null,
    accountStatus: a.accountStatus ?? null,
  }));

  const froHoldingsByAccount = [
    ...accountBags.map((bag) => {
      const positions = bag.positions ?? [];
      const froRows = positions.filter((p) =>
        isFroRelatedPosition({
          symbol: String(p.symbol ?? ""),
          symbolDescription: String(p.symbolDescription ?? ""),
        }),
      );
      const equity = froRows
        .filter((p) =>
          isFroEquityPosition({
            symbol: String(p.symbol ?? ""),
            symbolDescription: String(p.symbolDescription ?? ""),
            typeCode: p.typeCode != null ? String(p.typeCode) : null,
          }),
        )
        .map(slimPosition);
      const options = froRows
        .filter(
          (p) =>
            !isFroEquityPosition({
              symbol: String(p.symbol ?? ""),
              symbolDescription: String(p.symbolDescription ?? ""),
              typeCode: p.typeCode != null ? String(p.typeCode) : null,
            }),
        )
        .map(slimPosition);
      return {
        accountId: bag.accountId ?? null,
        accountDesc: bag.accountDesc ?? null,
        accountType: bag.accountType ?? null,
        accountMode: bag.accountMode ?? null,
        accountIdKey: bag.accountIdKey ?? null,
        error: bag.error ?? null,
        stale: Boolean(bag.stale),
        cachedAt: bag.cachedAt ?? null,
        liveError: bag.liveError ?? null,
        view: bag.view ?? null,
        warnings: bag.warnings ?? null,
        positionCount: positions.length,
        froEquityShares: equity.reduce((s, r) => s + (r.quantity ?? 0), 0),
        froEquityMarketValue: equity.reduce((s, r) => s + (r.marketValue ?? 0), 0),
        froEquity: equity,
        froOptions: options,
        froRelatedCount: froRows.length,
      };
    }),
    ...(externalBag ? [externalBag] : []),
  ];

  const froEquityTotalShares = froHoldingsByAccount.reduce(
    (s, a) => s + a.froEquityShares,
    0,
  );
  const froEquityTotalMarketValue = froHoldingsByAccount.reduce(
    (s, a) => s + a.froEquityMarketValue,
    0,
  );
  const accountsWithFro = froHoldingsByAccount.filter((a) => a.froRelatedCount > 0);

  let pos: Record<string, unknown> | undefined;
  let posAccount: {
    accountId?: string | null;
    accountDesc?: string | null;
    accountType?: string | null;
    accountIdKey?: string;
  } | null = null;
  /** Sum Sep $46c across ALL accounts — never let a 0× Roth row hide Rollover. */
  let focusQtyTotal = 0;
  const focusByAccount: Array<{
    accountId: string | null;
    accountDesc: string | null;
    accountType: string | null;
    accountIdKey: string | null;
    quantity: number;
  }> = [];
  for (const bag of accountBags) {
    const hits = (bag.positions ?? []).filter((p) =>
      isFocusCallPosition({
        symbol: String(p.symbol ?? ""),
        symbolDescription: String(p.symbolDescription ?? ""),
      }),
    );
    const q = hits.reduce((s, p) => s + Number(p.quantity ?? 0), 0);
    if (hits.length > 0 || q !== 0) {
      focusByAccount.push({
        accountId: bag.accountId ?? null,
        accountDesc: bag.accountDesc ?? null,
        accountType: bag.accountType ?? null,
        accountIdKey: bag.accountIdKey ?? null,
        quantity: q,
      });
    }
    focusQtyTotal += q;
    // Prefer a non-zero row for mark/cost fields; else first hit.
    const preferred =
      hits.find((p) => Number(p.quantity ?? 0) !== 0) ?? hits[0];
    if (preferred && (!pos || Number(pos.quantity ?? 0) === 0)) {
      pos = preferred;
      posAccount = {
        accountId: bag.accountId ?? null,
        accountDesc: bag.accountDesc ?? null,
        accountType: bag.accountType ?? null,
        accountIdKey: bag.accountIdKey,
      };
    }
  }

  const openOrders = (live.openOrders?.orders ?? [])
    .filter((o) => {
      const desc = String(o.symbolDescription ?? o.osiKey ?? "").toUpperCase();
      const strike = o.strikePrice != null ? Number(o.strikePrice) : null;
      return (
        String(o.symbol ?? "").toUpperCase() === "FRO" &&
        (strike === FOCUS_STRIKE || desc.includes("46")) &&
        String(o.status ?? "").toUpperCase() === "OPEN"
      );
    })
    .map((o) => ({
      orderId: o.orderId ?? null,
      action: o.orderAction ?? null,
      quantity: o.quantity ?? o.orderedQuantity ?? null,
      limitPrice: o.limitPrice ?? null,
      stopPrice: o.stopPrice ?? null,
      priceType: o.priceType ?? null,
      orderTerm: o.orderTerm ?? null,
      status: o.status ?? null,
      placedTime: o.placedTime ?? null,
      accountId: o.accountId ?? null,
      accountDesc: o.accountDesc ?? null,
      accountType: o.accountType ?? null,
      accountIdKey: o.accountIdKey ?? null,
    }));

  const qty = focusQtyTotal > 0 || focusByAccount.length > 0 ? focusQtyTotal : null;
  const pricePaid = pos && typeof pos.pricePaid === "number" ? pos.pricePaid : null;
  const totalCost = pos && typeof pos.totalCost === "number" ? pos.totalCost : null;
  const marketValue =
    pos && typeof pos.marketValue === "number" ? pos.marketValue : null;
  const totalGain = pos && typeof pos.totalGain === "number" ? pos.totalGain : null;
  const totalGainPct =
    pos && typeof pos.totalGainPct === "number" ? pos.totalGainPct : null;
  const daysGain = pos && typeof pos.daysGain === "number" ? pos.daysGain : null;

  return {
    available: true,
    contract: `FRO Sep 18 '26 $${FOCUS_STRIKE} Call`,
    expiry: FOCUS_EXPIRY,
    strike: FOCUS_STRIKE,
    type: "call",
    portfolioFetch: live.portfolioFetch ?? null,
    holdingsDataQuality:
      froHoldingsByAccount.some((a) => a.stale)
        ? "partial_stale_cache"
        : froHoldingsByAccount.every((a) => a.error)
          ? "all_accounts_failed"
          : froHoldingsByAccount.some((a) => a.error)
            ? "partial_live"
            : "live",
    accountId: posAccount?.accountId ?? live.portfolio?.accountId ?? null,
    accountDesc: posAccount?.accountDesc ?? live.portfolio?.accountDesc ?? null,
    accountType: posAccount?.accountType ?? live.portfolio?.accountType ?? null,
    /** Primary qty = SUM across all accounts (Rollover+Roth+…). */
    quantity: qty,
    focusQtyTotal: focusQtyTotal,
    focusByAccount,
    note:
      "quantity/focusQtyTotal sum Sep $46c across ALL linked accounts + external. Do not treat a single 0× account row as flat book.",
    froPrice: opts.froPrice,
    dte: opts.dte,
    costBasis: pricePaid,
    totalCost,
    lastPrice: opts.focusQuote?.lastPrice ?? null,
    bid: opts.focusQuote?.bid ?? null,
    ask: opts.focusQuote?.ask ?? null,
    bidAskWidth:
      opts.focusQuote?.bid != null && opts.focusQuote?.ask != null
        ? opts.focusQuote.ask - opts.focusQuote.bid
        : null,
    volume: opts.focusQuote?.volume ?? null,
    openInterest: opts.focusQuote?.openInterest ?? null,
    contractIv: opts.focusQuote?.impliedVolatility ?? null,
    quoteSource: opts.focusQuote?.source ?? null,
    marketValue,
    totalGain,
    totalGainPct,
    daysGain,
    openOrders,
    accountTotals: live.portfolio?.totals ?? null,
    accountsCatalog,
    froEquityTotalShares,
    froEquityTotalMarketValue,
    accountsWithFroCount: accountsWithFro.length,
    froHoldingsByAccount,
    externalBook: externalBag,
    allAccountTotals: accountBags.map((b) => ({
      accountId: b.accountId ?? null,
      accountDesc: b.accountDesc ?? null,
      accountType: b.accountType ?? null,
      accountIdKey: b.accountIdKey ?? null,
      positionCount: (b.positions ?? []).length,
      error: b.error ?? null,
      totals: b.totals ?? null,
    })),
  };
}

function diffField(
  oldVal: number | null | undefined,
  newVal: number | null | undefined,
): { old: number | null; new: number | null; change: number | null } | null {
  if (oldVal == null && newVal == null) return null;
  const o = oldVal ?? null;
  const n = newVal ?? null;
  return {
    old: o,
    new: n,
    change: o != null && n != null ? n - o : null,
  };
}

function buildChangesSinceLast(
  prev: DossierSnap | null,
  curr: DossierSnap,
): Record<string, unknown> {
  if (!prev) {
    return {
      available: false,
      note: "No prior dossier snapshot on this machine — next Copy will include a diff.",
      current: curr,
    };
  }
  return {
    available: true,
    priorGeneratedAt: prev.generatedAt,
    currentGeneratedAt: curr.generatedAt,
    froPrice: diffField(prev.froPrice, curr.froPrice),
    optionLast: diffField(prev.optionLast, curr.optionLast),
    optionBid: diffField(prev.optionBid, curr.optionBid),
    optionAsk: diffField(prev.optionAsk, curr.optionAsk),
    positionGain: diffField(prev.positionGain, curr.positionGain),
    marketValue: diffField(prev.marketValue, curr.marketValue),
    positionQty: diffField(prev.positionQty, curr.positionQty),
    openOrderLimit: diffField(prev.openOrderLimit, curr.openOrderLimit),
    openOrderQty: diffField(prev.openOrderQty, curr.openOrderQty),
  };
}

function buildDecisionSummary(positionSummary: Record<string, unknown>): Record<string, unknown> {
  const qty = typeof positionSummary.quantity === "number" ? positionSummary.quantity : 0;
  const gainPct =
    typeof positionSummary.totalGainPct === "number" ? positionSummary.totalGainPct : null;
  const gain =
    typeof positionSummary.totalGain === "number" ? positionSummary.totalGain : null;
  const bid = typeof positionSummary.bid === "number" ? positionSummary.bid : null;
  const ask = typeof positionSummary.ask === "number" ? positionSummary.ask : null;
  const width =
    typeof positionSummary.bidAskWidth === "number" ? positionSummary.bidAskWidth : null;
  const dte = typeof positionSummary.dte === "number" ? positionSummary.dte : null;
  const fro =
    typeof positionSummary.froPrice === "number" ? positionSummary.froPrice : null;
  const orders = Array.isArray(positionSummary.openOrders)
    ? (positionSummary.openOrders as Array<Record<string, unknown>>)
    : [];

  let positionStatus = "No focus position found";
  if (qty > 0) {
    if (gainPct == null) positionStatus = `Long ${qty} contracts (P&L unknown)`;
    else if (gainPct >= 0)
      positionStatus = `Green (+${gainPct.toFixed(1)}% / ${gain != null ? `$${gain.toFixed(2)}` : "?"})`;
    else
      positionStatus = `Red (${gainPct.toFixed(1)}% / ${gain != null ? `$${gain.toFixed(2)}` : "?"})`;
  }

  const openOrdersText =
    orders.length === 0
      ? "No open orders on focus contract"
      : orders
          .map((o) => {
            const action = String(o.action ?? "?");
            const q = o.quantity ?? "?";
            const lim = o.limitPrice != null ? `$${o.limitPrice}` : "mkt/other";
            return `${action} ${q} @ ${lim} (${o.orderTerm ?? "?"} · ${o.status ?? "?"})`;
          })
          .join("; ");

  const farLimit = orders.find(
    (o) => typeof o.limitPrice === "number" && (o.limitPrice as number) >= 10,
  );
  const riskBits: string[] = [];
  if (dte != null && dte <= 60) riskBits.push(`${dte} DTE`);
  if (fro != null && fro < FOCUS_STRIKE * 0.9) riskBits.push("OTM vs $46 strike");
  if (width != null && bid != null && width > Math.max(0.5, (bid || 0) * 2))
    riskBits.push("wide bid/ask");
  if (farLimit) riskBits.push("GTC limit far above market");
  const riskLevel =
    riskBits.length >= 2 ? `Elevated (${riskBits.join(", ")})` : riskBits.length === 1
      ? `Moderate (${riskBits[0]})`
      : "Contained";

  const suggested: string[] = [];
  if (farLimit) {
    suggested.push(
      `Open sell limit $${farLimit.limitPrice} is far above last/ask — treat as lottery take-profit, not near-term exit.`,
    );
  }
  if (width != null && ask != null && bid != null && width > 1) {
    suggested.push(
      `Spread $${bid.toFixed(2)}–$${ask.toFixed(2)} is wide; use mid carefully and prefer limit orders over market.`,
    );
  }
  if (fro != null) {
    suggested.push(
      `Monitor equity levels into/through $${FOCUS_STRIKE}; spot now $${fro.toFixed(2)} (${((fro / FOCUS_STRIKE) * 100).toFixed(1)}% of strike).`,
    );
  }
  const equityShares =
    typeof positionSummary.froEquityTotalShares === "number"
      ? positionSummary.froEquityTotalShares
      : 0;
  if (equityShares > 0) {
    const eqMv =
      typeof positionSummary.froEquityTotalMarketValue === "number"
        ? positionSummary.froEquityTotalMarketValue
        : null;
    suggested.push(
      `Also long ${equityShares} FRO shares across accounts${eqMv != null ? ` (≈$${eqMv.toFixed(0)} MV)` : ""} — factor equity + options into total exposure (see froHoldingsByAccount for Roth/IRA vs brokerage).`,
    );
  }
  if (gainPct != null && gainPct > 20 && !farLimit) {
    suggested.push("Consider scaling a partial take-profit while geopolitical vol remains elevated.");
  }
  if (!suggested.length) {
    suggested.push("Hold/monitor; reassess on next E*TRADE refresh if marks or orders change.");
  }

  return {
    positionStatus,
    openOrders: openOrdersText,
    riskLevel,
    suggestedAction: suggested.join(" "),
    bullets: [
      `Position: ${positionStatus}`,
      `Orders: ${openOrdersText}`,
      `Risk: ${riskLevel}`,
      ...suggested.map((s) => `Action: ${s}`),
    ],
  };
}

function feedStatus(source: string, ageSec: number | null): string {
  if (source.includes("realtime")) return "✅ Realtime";
  if (source.startsWith("etrade")) return "⚠️ E*TRADE (not realtime flag)";
  if (source.includes("yahoo")) return "⚠️ Delayed";
  if (ageSec != null && ageSec > 86_400) return "⚠️ Stale/lagging series";
  return "·";
}

function buildSourceTable(rows: Array<{
  section: string;
  source: string;
  ageSec: number | null;
  status: string;
}>): string {
  const lines = [
    "| Section | Source | Age | Status |",
    "|---------|--------|-----|--------|",
    ...rows.map(
      (r) =>
        `| ${r.section} | ${r.source} | ${fmtAge(r.ageSec)} | ${r.status} |`,
    ),
  ];
  return lines.join("\n");
}

async function fetchHistory(symbol: string, years: number): Promise<unknown> {
  const period1 = new Date();
  period1.setUTCFullYear(period1.getUTCFullYear() - years);
  const chart = await yahooFinance.chart(symbol, {
    period1,
    interval: "1d",
  });
  const quotes = (chart.quotes ?? []).map((q) => ({
    date: q.date instanceof Date ? q.date.toISOString().slice(0, 10) : q.date,
    open: q.open,
    high: q.high,
    low: q.low,
    close: q.close,
    volume: q.volume,
    adjclose: q.adjclose,
  }));
  return {
    meta: chart.meta,
    quoteCount: quotes.length,
    quotes,
  };
}

export type DossierResult = {
  symbol: string;
  generatedAt: string;
  text: string;
  byteLength: number;
  sources: Record<string, "ok" | "error">;
  /** Flattened multi-account FRO holdings + focus call (for AI pack files). */
  positionSummary?: Record<string, unknown>;
};

export async function buildLlmDossier(symbolRaw: string): Promise<DossierResult> {
  const symbol = symbolRaw.toUpperCase();
  const generatedAt = new Date().toISOString();

  const [
    quote,
    quoteSummary,
    insights,
    recommendations,
    history5y,
    history1yWeekly,
    allOptions,
    volatility,
    energy,
    physical,
    decisionIntel,
    etradeLive,
    fundamentalsAnnual,
    fundamentalsQuarterly,
  ] = await Promise.all([
    settle(getStockQuote(symbol)),
    settle(
      yahooFinance.quoteSummary(
        symbol,
        { modules: [...QUOTE_SUMMARY_MODULES] },
        { validateResult: false },
      ),
    ),
    settle(yahooFinance.insights(symbol)),
    settle(yahooFinance.recommendationsBySymbol(symbol)),
    settle(fetchHistory(symbol, 5)),
    settle(
      yahooFinance.chart(symbol, {
        period1: new Date(Date.now() - 365 * 86400000 * 2),
        interval: "1wk",
      }),
    ),
    settle(fetchAllOptions(symbol)),
    settle(
      getVolatilityReport(symbol, {
        focusStrike: 46,
        focusType: "call",
        focusExpiry: "2026-09-18",
      }),
    ),
    settle(getEnergyQuotes()),
    settle(getPhysicalMarkets()),
    settle(buildDecisionIntel(symbol)),
    settle(fetchEtradeLiveBundle(symbol)),
    settle(
      yahooFinance.fundamentalsTimeSeries(symbol, {
        period1: "2018-01-01",
        type: "annual",
        module: "all",
      } as never),
    ),
    settle(
      yahooFinance.fundamentalsTimeSeries(symbol, {
        period1: "2022-01-01",
        type: "quarterly",
        module: "all",
      } as never),
    ),
  ]);

  // Company-name search after quote settles — ticker-only Yahoo search returns irrelevant noise.
  // Prefer Yahoo quoteSummary names when E*TRADE equity quote has null shortName.
  const qs = quoteSummary.ok ? (quoteSummary.value as Record<string, any>) : null;
  const companyName =
    (quote.ok && quote.value?.shortName) ||
    qs?.quoteType?.shortName ||
    qs?.quoteType?.longName ||
    qs?.price?.shortName ||
    qs?.price?.longName ||
    null;
  const companyNews = await settle(fetchCompanyNews(symbol, companyName));

  const ivSnapshots = readIvSnapshots(symbol);
  const nowMs = Date.now();

  const etradeOk =
    etradeLive.ok &&
    Boolean(
      etradeLive.value &&
        typeof etradeLive.value === "object" &&
        (etradeLive.value as { authorized?: boolean }).authorized === true &&
        (etradeLive.value as { portfolio?: unknown }).portfolio,
    );

  const quoteSource =
    quote.ok && quote.value && typeof quote.value === "object"
      ? String((quote.value as { source?: string }).source ?? "")
      : "";
  const optionsPrimarySource =
    allOptions.ok && allOptions.value && typeof allOptions.value === "object"
      ? String((allOptions.value as { primarySource?: string }).primarySource ?? "")
      : "";
  const etradeRealtime =
    quoteSource.includes("realtime") || optionsPrimarySource.includes("realtime");

  const sources: Record<string, "ok" | "error"> = {
    quote: quote.ok ? "ok" : "error",
    quoteSummary: quoteSummary.ok ? "ok" : "error",
    insights: insights.ok ? "ok" : "error",
    recommendations: recommendations.ok ? "ok" : "error",
    history5y: history5y.ok ? "ok" : "error",
    historyWeekly: history1yWeekly.ok ? "ok" : "error",
    optionsAllExpiries: allOptions.ok ? "ok" : "error",
    volatility: volatility.ok ? "ok" : "error",
    energy: energy.ok ? "ok" : "error",
    physicalMarkets: physical.ok ? "ok" : "error",
    decisionIntel: decisionIntel.ok ? "ok" : "error",
    etradeLive: etradeOk ? "ok" : "error",
    fundamentalsAnnual: fundamentalsAnnual.ok ? "ok" : "error",
    fundamentalsQuarterly: fundamentalsQuarterly.ok ? "ok" : "error",
    companyNews: companyNews.ok ? "ok" : "error",
    ivSnapshots: "ok",
  };

  const quoteFetchedAt =
    quote.ok && quote.value && typeof quote.value === "object"
      ? String((quote.value as { fetchedAt?: string }).fetchedAt ?? "")
      : "";
  const energyFetchedAt =
    energy.ok && energy.value && typeof energy.value === "object"
      ? String(
          (energy.value as { wti?: { fetchedAt?: string } }).wti?.fetchedAt ??
            (energy.value as { brent?: { fetchedAt?: string } }).brent?.fetchedAt ??
            "",
        )
      : "";
  const volFetchedAt =
    volatility.ok && volatility.value && typeof volatility.value === "object"
      ? String((volatility.value as { fetchedAt?: string }).fetchedAt ?? "")
      : "";
  const physicalFetchedAt =
    physical.ok && physical.value && typeof physical.value === "object"
      ? String((physical.value as { fetchedAt?: string }).fetchedAt ?? "")
      : "";
  const physicalAsOf =
    physical.ok && physical.value && typeof physical.value === "object"
      ? {
          eiaBrentSpotAsOf: (physical.value as {
            brent?: { eiaEuropeBrentSpot?: { asOf?: string } };
          }).brent?.eiaEuropeBrentSpot?.asOf,
          td3cAsOfLabel: (physical.value as {
            vlccTd3c?: { asOfLabel?: string };
          }).vlccTd3c?.asOfLabel,
        }
      : null;
  const optionsFetchedAt =
    allOptions.ok && allOptions.value && typeof allOptions.value === "object"
      ? String((allOptions.value as { fetchedAt?: string }).fetchedAt ?? "")
      : "";
  const etradeFetchedAt =
    etradeLive.ok && etradeLive.value && typeof etradeLive.value === "object"
      ? String((etradeLive.value as { fetchedAt?: string }).fetchedAt ?? "")
      : "";
  const decisionGeneratedAt =
    decisionIntel.ok && decisionIntel.value && typeof decisionIntel.value === "object"
      ? String((decisionIntel.value as { generatedAt?: string }).generatedAt ?? "")
      : "";

  const freshness = {
    generatedAt,
    quoteAgeSec: ageSeconds(quoteFetchedAt, nowMs),
    optionsAgeSec: ageSeconds(optionsFetchedAt, nowMs),
    energyAgeSec: ageSeconds(energyFetchedAt, nowMs),
    volatilityAgeSec: ageSeconds(volFetchedAt, nowMs),
    physicalFetchAgeSec: ageSeconds(physicalFetchedAt, nowMs),
    decisionIntelAgeSec: ageSeconds(decisionGeneratedAt, nowMs),
    etradeLiveAgeSec: ageSeconds(etradeFetchedAt, nowMs),
    marketFeed: {
      equityQuoteSource: quoteSource || null,
      optionsPrimarySource: optionsPrimarySource || null,
      etradeRealtimeEntitled: etradeRealtime,
    },
    physicalAsOf,
    notes: [
      "Quote / options / energy / volatility / decision-intel / E*TRADE live pack are fetched on each Copy dossier click (no dossier cache).",
      "When equityQuoteSource/optionsPrimarySource start with etrade:realtime, FRO equity + option chains are E*TRADE consolidated realtime (OPRA for options).",
      "Energy futures (CL=F / BZ=F) remain Yahoo. EIA Brent Spot and VLCC TD3C are official/reprint series with multi-day lag — see physicalAsOf.",
      "IRONSIGHT warship positions are curated OSINT stamps, not live AIS.",
      "Read sections 0a–0d first (position snapshot, changes, decision summary, source table). Prefer those over nested JSON dumps.",
    ],
  };

  const froPrice =
    quote.ok && quote.value && typeof quote.value.price === "number"
      ? quote.value.price
      : null;
  const dte =
    volatility.ok && volatility.value && typeof volatility.value.dte === "number"
      ? volatility.value.dte
      : null;
  const focusQuote =
    (etradeLive.ok ? findFocusCallInEtradeLive(etradeLive.value) : null) ??
    (allOptions.ok ? findFocusCallInChains(allOptions.value) : null);
  const positionSummary = await buildPositionSummary({
    etradeLive: etradeLive.ok ? etradeLive.value : null,
    focusQuote,
    froPrice,
    dte,
  });

  const openOrdersArr = Array.isArray(positionSummary.openOrders)
    ? (positionSummary.openOrders as Array<Record<string, unknown>>)
    : [];
  const primaryOpen = openOrdersArr[0];
  const currSnap: DossierSnap = {
    generatedAt,
    froPrice,
    optionLast:
      typeof positionSummary.lastPrice === "number" ? positionSummary.lastPrice : null,
    optionBid: typeof positionSummary.bid === "number" ? positionSummary.bid : null,
    optionAsk: typeof positionSummary.ask === "number" ? positionSummary.ask : null,
    positionGain:
      typeof positionSummary.totalGain === "number" ? positionSummary.totalGain : null,
    positionQty:
      typeof positionSummary.quantity === "number" ? positionSummary.quantity : null,
    marketValue:
      typeof positionSummary.marketValue === "number"
        ? positionSummary.marketValue
        : null,
    openOrderLimit:
      primaryOpen && typeof primaryOpen.limitPrice === "number"
        ? primaryOpen.limitPrice
        : null,
    openOrderQty:
      primaryOpen && typeof primaryOpen.quantity === "number"
        ? primaryOpen.quantity
        : null,
  };
  const prevSnap = readLastDossierSnap(symbol);
  const changesSinceLastDossier = buildChangesSinceLast(prevSnap, currSnap);
  writeDossierSnap(symbol, currSnap);

  const decisionSummary = buildDecisionSummary(positionSummary);

  const dataPrimary = {
    equityQuote: quoteSource.startsWith("etrade") ? "etrade" : "yahoo",
    optionsChain: optionsPrimarySource.startsWith("etrade") ? "etrade" : "yahoo",
    portfolioMarks: etradeOk ? "etrade" : "unavailable",
    openOrders: etradeOk ? "etrade" : "unavailable",
    energyFutures: "yahoo",
    fundamentalsOwnershipNews: "yahoo",
    priceHistory: "yahoo",
    physicalLeadingIndicators: "eia+td3c (lagging)",
    decisionIntelOsint: "mixed (yahoo cracks + etrade options + ironsight)",
    note:
      "For live marks/chains/orders use E*TRADE. Keep Yahoo for fundamentals, history, news, and energy futures. Physical TD3C/EIA are intentionally lagged leading indicators.",
  };

  const sourceTable = buildSourceTable([
    {
      section: "Quote",
      source: quoteSource || "?",
      ageSec: freshness.quoteAgeSec,
      status: feedStatus(quoteSource, freshness.quoteAgeSec),
    },
    {
      section: "Options",
      source: optionsPrimarySource || "?",
      ageSec: freshness.optionsAgeSec,
      status: feedStatus(optionsPrimarySource, freshness.optionsAgeSec),
    },
    {
      section: "Portfolio / orders",
      source: etradeOk ? "etrade" : "unavailable",
      ageSec: freshness.etradeLiveAgeSec,
      status: etradeOk ? "✅ Live broker" : "⚠️ Unavailable",
    },
    {
      section: "Energy futures",
      source: "yahoo-finance2",
      ageSec: freshness.energyAgeSec,
      status: "⚠️ Delayed",
    },
    {
      section: "Volatility derived",
      source: optionsPrimarySource || "derived",
      ageSec: freshness.volatilityAgeSec,
      status: feedStatus(optionsPrimarySource, freshness.volatilityAgeSec),
    },
    {
      section: "Physical (EIA/TD3C)",
      source: "eia+td3c",
      ageSec: freshness.physicalFetchAgeSec,
      status: `⚠️ Series as-of ${physicalAsOf?.eiaBrentSpotAsOf ?? "?"} / ${physicalAsOf?.td3cAsOfLabel ?? "?"}`,
    },
    {
      section: "OSINT / decision intel",
      source: "mixed",
      ageSec: freshness.decisionIntelAgeSec,
      status: "⚠️ Mixed / curated",
    },
  ]);

  const parts: string[] = [];
  parts.push(`# Tradehole LLM Dossier — ${symbol}`);
  parts.push("");
  parts.push(`GeneratedAt: ${generatedAt}`);
  parts.push(
    `Source: Tradehole aggregator — FRO equity/options prefer E*TRADE (${etradeRealtime ? "REALTIME" : quoteSource || optionsPrimarySource || "unknown"}); Yahoo for fundamentals/news/history/energy futures; derived vol + physical OSINT.`,
  );
  parts.push(
    `Purpose: Exhaustive context packet for external LLM analysis. Read 0a–0d first. Prefer E*TRADE realtime marks/chains/orders; treat Yahoo quote/options as fallback only.`,
  );
  parts.push("");
  parts.push("### dataPrimary (which source wins)");
  parts.push(compactJson(dataPrimary));
  parts.push("");
  parts.push("### Source status (machine)");
  parts.push(compactJson(sources));
  parts.push("");
  parts.push("### Source table (human)");
  parts.push(sourceTable);
  parts.push("");
  parts.push("### Freshness (up-to-the-minute check)");
  parts.push(compactJson(freshness));
  parts.push(
    [
      `- Quote feed: ${quoteSource || "?"} · age ${fmtAge(freshness.quoteAgeSec)}`,
      `- Options feed: ${optionsPrimarySource || "?"} · age ${fmtAge(freshness.optionsAgeSec)}`,
      `- E*TRADE live pack age: ${fmtAge(freshness.etradeLiveAgeSec)} (${etradeOk ? "authorized" : "unavailable"})`,
      `- Energy (WTI/Brent Yahoo) age: ${fmtAge(freshness.energyAgeSec)}`,
      `- Volatility report age: ${fmtAge(freshness.volatilityAgeSec)}`,
      `- Physical pack fetch age: ${fmtAge(freshness.physicalFetchAgeSec)} (series as-of: ${physicalAsOf?.eiaBrentSpotAsOf ?? "?"} EIA / ${physicalAsOf?.td3cAsOfLabel ?? "?"} TD3C)`,
      `- Decision intel age: ${fmtAge(freshness.decisionIntelAgeSec)}`,
      `- Company news query: ${companyName ? `"${companyName} ${symbol}"` : symbol}`,
    ].join("\n"),
  );

  parts.push(
    section(
      "0a. POSITION SNAPSHOT (focus $46c + FRO holdings across ALL accounts incl Roth/IRA)",
      compactJson(positionSummary),
    ),
  );
  parts.push(
    section(
      "0b. CHANGES SINCE LAST DOSSIER (local machine diff)",
      compactJson(changesSinceLastDossier),
    ),
  );
  parts.push(
    section("0c. DECISION SUMMARY (actionable)", compactJson(decisionSummary)),
  );
  parts.push(
    section(
      "0d. PARSE ORDER FOR RECEIVING LLM",
      [
        "1) Read 0a position snapshot + 0c decision summary + source table.",
        "2) In 0a, use froHoldingsByAccount / froEquity* for stock across brokerage + Roth/IRA accounts; focus call fields remain the Sep $46c book.",
        "3) Use 0b changes to see what moved since last Copy.",
        "4) Use section 14 E*TRADE LIVE PACK for raw broker detail / open orders (all accounts).",
        "5) Use section 9 options chains (E*TRADE) for full surface; ignore Yahoo quotes if etrade:realtime is present.",
        "6) Yahoo fundamentals/history/news remain useful context; energy futures are Yahoo-delayed paper.",
        "7) Physical EIA/TD3C are leading but lagged — do not treat their as-of dates as live.",
        "8) Section 0e HISTORY DIGEST is local SQLite memory (IV/vol/OI path + flow anomalies).",
        "9) Section 0f STRATEGY INTEL has ΔOI, IV Rank, GEX, FRO–WTI ρ, implied move, BDTI proxy, and an action bias.",
      ].join("\n"),
    ),
  );

  let historyDigest = "History digest unavailable.";
  try {
    historyDigest = buildHistoryDigest(symbol);
  } catch (err) {
    historyDigest = `ERROR building history digest: ${String(err)}`;
  }
  parts.push(section("0e. HISTORY DIGEST (local SQLite memory)", historyDigest));

  let strategyMd = "Strategy intel unavailable.";
  try {
    const { buildStrategyIntel, strategyIntelMarkdown } = await import(
      "./analytics/strategyIntel"
    );
    strategyMd = strategyIntelMarkdown(await buildStrategyIntel(symbol));
  } catch (err) {
    strategyMd = `ERROR building strategy intel: ${String(err)}`;
  }
  parts.push(section("0f. STRATEGY INTEL (prescriptive)", strategyMd));

  parts.push(
    section(
      "1. Live quote (E*TRADE when authorized, else Yahoo)",
      quote.ok ? compactJson(quote.value) : `ERROR: ${quote.error}`,
    ),
  );

  parts.push(
    section(
      "2. Company profile, statistics, financials summary, earnings, ownership, insider activity (quoteSummary)",
      quoteSummary.ok ? compactJson(quoteSummary.value) : `ERROR: ${quoteSummary.error}`,
    ),
  );

  parts.push(
    section(
      "3. Yahoo insights / significant developments / SEC report links",
      insights.ok ? compactJson(insights.value) : `ERROR: ${insights.error}`,
    ),
  );

  parts.push(
    section(
      "4. Peer recommendations (similar symbols)",
      recommendations.ok
        ? compactJson(recommendations.value)
        : `ERROR: ${recommendations.error}`,
    ),
  );

  parts.push(
    section(
      "5. Company news headlines (Yahoo search — ticker-strict; empty if no FRO matches)",
      companyNews.ok ? compactJson(companyNews.value) : `ERROR: ${companyNews.error}`,
    ),
  );

  parts.push(
    section(
      "6. Energy context (WTI / Brent futures via Yahoo) — paper market",
      energy.ok ? compactJson(energy.value) : `ERROR: ${energy.error}`,
    ),
  );

  parts.push(
    section(
      "6b. PHYSICAL MARKETS (leading indicators) — VLCC TD3C ME-China + EIA Europe Brent Spot vs Brent futures",
      physical.ok
        ? [
            compactJson(physical.value),
            "",
            "INTERPRETATION HINT: If TD3C Worldscale/TCE is extreme while equity options IV or oil futures look calm,",
            "the physical tanker/crude complex may already be in crisis and paper markets are lagging.",
            "EIA Europe Brent Spot ≠ Platts Dated Brent, but spot-vs-futures spread still flags physical tightness.",
          ].join("\n")
        : `ERROR: ${physical.error}`,
    ),
  );

  parts.push(
    section(
      "6c. DECISION INTEL PACK — crack spreads, FRO options smart-money, IRONSIGHT theater OSINT, targeted news (Bataan/New York ARG, Kharg, Hormuz, war risk, Cape diversions, FFA mentions)",
      decisionIntel.ok
        ? [
            compactJson(decisionIntel.value, 450_000),
            "",
            "Use decisionHints + gaps together: what we can prove vs what still requires paid AIS/Platts/Baltic FFA/war-risk feeds.",
          ].join("\n")
        : `ERROR: ${decisionIntel.error}`,
    ),
  );

  parts.push(
    section(
      "7. Derived volatility report (ATM IV, HV, skew, term structure, smile, position focus $46 call)",
      volatility.ok ? compactJson(volatility.value) : `ERROR: ${volatility.error}`,
    ),
  );

  parts.push(
    section(
      "8. Local ATM IV daily snapshots (for IV rank history)",
      compactJson(ivSnapshots),
    ),
  );

  parts.push(
    section(
      "9. Full options chains — ALL listed expiries (E*TRADE realtime when authorized; includes source + fetchedAt per expiry)",
      allOptions.ok ? compactJson(allOptions.value, 400_000) : `ERROR: ${allOptions.error}`,
    ),
  );

  parts.push(
    section(
      "10. Daily OHLCV history (~5 years)",
      history5y.ok ? compactJson(history5y.value, 350_000) : `ERROR: ${history5y.error}`,
    ),
  );

  parts.push(
    section(
      "11. Weekly chart history (~2 years)",
      history1yWeekly.ok
        ? compactJson({
            meta: history1yWeekly.value.meta,
            quotes: (history1yWeekly.value.quotes ?? []).map((q) => ({
              date: q.date instanceof Date ? q.date.toISOString().slice(0, 10) : q.date,
              open: q.open,
              high: q.high,
              low: q.low,
              close: q.close,
              volume: q.volume,
              adjclose: q.adjclose,
            })),
          })
        : `ERROR: ${history1yWeekly.error}`,
    ),
  );

  parts.push(
    section(
      "12. Fundamentals time series — annual",
      fundamentalsAnnual.ok
        ? compactJson(fundamentalsAnnual.value, 200_000)
        : `ERROR: ${fundamentalsAnnual.error}`,
    ),
  );

  parts.push(
    section(
      "13. Fundamentals time series — quarterly",
      fundamentalsQuarterly.ok
        ? compactJson(fundamentalsQuarterly.value, 200_000)
        : `ERROR: ${fundamentalsQuarterly.error}`,
    ),
  );

  parts.push(
    section(
      "14. E*TRADE LIVE PACK — ALL accounts (brokerage + Roth/IRA/etc.), paginated portfolio/P&L, open+recent FRO orders per account, raw equity+focus option quotes (Aug 40C/45C + Sep 46C)",
      etradeLive.ok
        ? [
            compactJson(etradeLive.value, 450_000),
            "",
            "Prefer these broker marks/quotes/orders over Yahoo for the user's live book and for realtime bid/ask/IV when quoteStatus=REALTIME.",
            "portfolios[] + ordersByAccount[] cover every linked account — include Roth IRA equity shares of FRO, not only the options account.",
          ].join("\n")
        : `ERROR: ${etradeLive.error}`,
    ),
  );

  parts.push(
    section(
      "15. Analysis instructions for receiving LLM",
      [
        "You are analyzing Frontline plc (FRO) tanker equity/options context.",
        "START with sections 0a–0d (position snapshot, changes, decision summary, parse order) and the source table.",
        "Treat multi-account exposure as one book: Sep $46 calls PLUS any FRO common stock in Roth/IRA or other accounts (see froHoldingsByAccount).",
        "Prefer E*TRADE LIVE PACK + etrade:realtime quote/chains for marks, open orders, and live option quotes.",
        "Yahoo fundamentals/history/news are secondary context; do not prefer Yahoo quotes/options when etrade:realtime is present.",
        "Call out: spot vs strikes, DTE, IV vs HV, skew/term structure, oil complex (WTI/Brent),",
        "PHYSICAL leading indicators (VLCC TD3C ME→China WS/TCE, EIA Brent spot vs Brent futures),",
        "crack spreads (RB/HO vs WTI), FRO options put/call + IV term structure,",
        "IRONSIGHT OSINT and targeted ARG/Kharg/Hormuz/war-risk/Cape news,",
        "earnings/calendar, ownership/insider flows, news/sigdevs, and peer names.",
        "Emphasize when physical tanker/crude prints diverge from lagging futures/equity options.",
        "Explicitly separate confirmed free-data signals from paid-data gaps.",
        "Be explicit about data delays and any ERROR sections. Use Freshness ages + dataPrimary,",
        "not GeneratedAt alone — EIA Brent spot and VLCC TD3C are intentionally lagging.",
        "If open GTC/working orders exist, include them in position-management advice.",
        "End with concrete risks, catalysts, and position-management considerations for the $46 calls AND any FRO equity shares if present.",
      ].join("\n"),
    ),
  );

  const text = parts.join("\n");
  return {
    symbol,
    generatedAt,
    text,
    byteLength: Buffer.byteLength(text, "utf8"),
    sources,
    positionSummary,
  };
}
