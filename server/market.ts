import YahooFinance from "yahoo-finance2";
import {
  etradeMarketAvailable,
  getEtradeEquityQuote,
  getEtradeOptionsChain,
} from "./etradeMarket";
import { preferCmeThenYahoo } from "./cmeQuotes";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

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
  /** Extended-hours (pre/post) last when available. */
  extendedPrice: number | null;
  extendedChange: number | null;
  extendedChangePercent: number | null;
  extendedSession: "pre" | "post" | null;
  extendedAsOf: string | null;
  source: "yahoo-finance2" | string;
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
  source: "yahoo-finance2" | string;
  fetchedAt: string;
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function mapContract(
  raw: Record<string, unknown>,
  type: "call" | "put",
): OptionContract {
  return {
    contractSymbol: String(raw.contractSymbol ?? ""),
    strike: Number(raw.strike ?? 0),
    lastPrice: num(raw.lastPrice),
    bid: num(raw.bid),
    ask: num(raw.ask),
    change: num(raw.change),
    percentChange: num(raw.percentChange),
    volume: num(raw.volume),
    openInterest: num(raw.openInterest),
    impliedVolatility: num(raw.impliedVolatility),
    inTheMoney: typeof raw.inTheMoney === "boolean" ? raw.inTheMoney : null,
    type,
  };
}

async function getYahooStockQuote(symbol: string): Promise<StockQuote> {
  // Yahoo FUTURE quotes (e.g. BZ=F) often omit schema-required expire* fields;
  // validation would throw FailedYahooValidationError and blank Markets.
  const q = await yahooFinance.quote(symbol, {}, { validateResult: false });
  const state = String(q.marketState ?? "").toUpperCase();
  const postPx = num(q.postMarketPrice);
  const prePx = num(q.preMarketPrice);
  const usePost =
    postPx != null &&
    (state === "POST" || state === "POSTPOST" || state.includes("POST"));
  const usePre =
    !usePost &&
    prePx != null &&
    (state === "PRE" || state === "PREPRE" || state.includes("PRE"));

  let extendedPrice: number | null = null;
  let extendedChange: number | null = null;
  let extendedChangePercent: number | null = null;
  let extendedSession: "pre" | "post" | null = null;
  let extendedAsOf: string | null = null;

  if (usePost) {
    extendedPrice = postPx;
    extendedChange = num(q.postMarketChange);
    extendedChangePercent = num(q.postMarketChangePercent);
    extendedSession = "post";
    const t = q.postMarketTime;
    extendedAsOf =
      t instanceof Date
        ? t.toISOString()
        : typeof t === "number"
          ? new Date(t * (t < 1e12 ? 1000 : 1)).toISOString()
          : null;
  } else if (usePre) {
    extendedPrice = prePx;
    extendedChange = num(q.preMarketChange);
    extendedChangePercent = num(q.preMarketChangePercent);
    extendedSession = "pre";
    const t = q.preMarketTime;
    extendedAsOf =
      t instanceof Date
        ? t.toISOString()
        : typeof t === "number"
          ? new Date(t * (t < 1e12 ? 1000 : 1)).toISOString()
          : null;
  } else if (postPx != null) {
    // Closed but post print exists
    extendedPrice = postPx;
    extendedChange = num(q.postMarketChange);
    extendedChangePercent = num(q.postMarketChangePercent);
    extendedSession = "post";
  } else if (prePx != null) {
    extendedPrice = prePx;
    extendedChange = num(q.preMarketChange);
    extendedChangePercent = num(q.preMarketChangePercent);
    extendedSession = "pre";
  }

  return {
    symbol: q.symbol ?? symbol,
    price: num(q.regularMarketPrice),
    change: num(q.regularMarketChange),
    changePercent: num(q.regularMarketChangePercent),
    bid: num(q.bid),
    ask: num(q.ask),
    open: num(q.regularMarketOpen),
    high: num(q.regularMarketDayHigh),
    low: num(q.regularMarketDayLow),
    previousClose: num(q.regularMarketPreviousClose),
    volume: num(q.regularMarketVolume),
    marketCap: num(q.marketCap),
    currency: q.currency ?? null,
    shortName: q.shortName ?? q.longName ?? null,
    marketState: q.marketState ?? null,
    extendedPrice,
    extendedChange,
    extendedChangePercent,
    extendedSession,
    extendedAsOf,
    source: "yahoo-finance2",
    fetchedAt: new Date().toISOString(),
  };
}

export async function getStockQuote(symbol: string): Promise<StockQuote> {
  // Equities: prefer E*TRADE when authorized (realtime if entitled). Futures keep Yahoo.
  const looksLikeFuture = symbol.includes("=") || symbol.includes("-");
  if (!looksLikeFuture && etradeMarketAvailable()) {
    try {
      const etrade = await getEtradeEquityQuote(symbol);
      // Yahoo remains best for explicit pre/post prints; merge when E*TRADE lacks them.
      // Source stays etrade:* (often CLOSING after RTH) — StatusBar documents AH honestly.
      if (etrade.extendedPrice == null) {
        try {
          const yahoo = await getYahooStockQuote(symbol);
          if (yahoo.extendedPrice != null) {
            return {
              ...etrade,
              marketState: yahoo.marketState ?? etrade.marketState,
              extendedPrice: yahoo.extendedPrice,
              extendedChange: yahoo.extendedChange,
              extendedChangePercent: yahoo.extendedChangePercent,
              extendedSession: yahoo.extendedSession,
              extendedAsOf: yahoo.extendedAsOf,
            };
          }
        } catch {
          /* keep etrade-only */
        }
      }
      return etrade;
    } catch (err) {
      console.warn(`[tradehole] E*TRADE quote failed for ${symbol}, Yahoo fallback:`, err);
    }
  }
  return getYahooStockQuote(symbol);
}

async function getYahooOptionsChain(
  symbol: string,
  expiry?: string,
): Promise<OptionsChain> {
  const result = (await yahooFinance.options(
    symbol,
    expiry ? { date: new Date(expiry) } : undefined,
    { validateResult: false },
  )) as {
    expirationDates?: Date[];
    options?: Array<{
      expirationDate?: Date;
      calls?: unknown[];
      puts?: unknown[];
    }>;
    quote?: { regularMarketPrice?: unknown };
  };
  const expirationDates = (result.expirationDates ?? []).map((d: Date) =>
    d.toISOString().slice(0, 10),
  );
  const selectedExpiry =
    result.options?.[0]?.expirationDate?.toISOString().slice(0, 10) ??
    expirationDates[0] ??
    null;

  const optionSlice = result.options?.[0];
  const calls = (optionSlice?.calls ?? []).map((c: unknown) =>
    mapContract(c as Record<string, unknown>, "call"),
  );
  const puts = (optionSlice?.puts ?? []).map((p: unknown) =>
    mapContract(p as Record<string, unknown>, "put"),
  );

  return {
    symbol,
    underlyingPrice: num(result.quote?.regularMarketPrice),
    expirationDates,
    selectedExpiry,
    calls,
    puts,
    source: "yahoo-finance2",
    fetchedAt: new Date().toISOString(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Prefer E*TRADE for every expiry (incl. Sep focus). Retry once before Yahoo —
 * transient E*TRADE failures were silently mixing Yahoo into one expiry while
 * others stayed etrade:realtime.
 */
export type OptionsChainSlice = {
  expiry: string;
  calls: OptionContract[];
  puts: OptionContract[];
  source: string;
  fetchedAt: string;
  error?: string;
};

export type OptionsChainsAll = {
  symbol: string;
  underlyingPrice: number | null;
  expirationDates: string[];
  chains: OptionsChainSlice[];
  fetchedAt: string;
  primarySource: string;
  feedSources: string[];
};

export async function getAllOptionsChains(symbol: string): Promise<OptionsChainsAll> {
  const first = await getOptionsChain(symbol);
  const expiries = first.expirationDates;
  const chains = await Promise.all(
    expiries.map(async (expiry): Promise<OptionsChainSlice> => {
      try {
        const chain =
          expiry === first.selectedExpiry ? first : await getOptionsChain(symbol, expiry);
        return {
          expiry: chain.selectedExpiry ?? expiry,
          calls: chain.calls,
          puts: chain.puts,
          source: chain.source,
          fetchedAt: chain.fetchedAt,
        };
      } catch (err) {
        return {
          expiry,
          calls: [],
          puts: [],
          source: "error",
          fetchedAt: new Date().toISOString(),
          error: String(err),
        };
      }
    }),
  );
  const feedSources = [
    ...new Set(chains.map((c) => c.source).filter((s) => s !== "error")),
  ];
  const primarySource =
    chains.find((c) => c.expiry === "2026-09-18")?.source ?? first.source;
  return {
    symbol: symbol.toUpperCase(),
    underlyingPrice: first.underlyingPrice,
    expirationDates: expiries,
    chains,
    fetchedAt: new Date().toISOString(),
    primarySource,
    feedSources,
  };
}

export async function getOptionsChain(
  symbol: string,
  expiry?: string,
): Promise<OptionsChain> {
  if (etradeMarketAvailable()) {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await getEtradeOptionsChain(symbol, expiry);
      } catch (err) {
        lastErr = err;
        if (attempt < 2) await sleep(350);
      }
    }
    console.warn(
      `[tradehole] E*TRADE options failed for ${symbol}${expiry ? ` ${expiry}` : ""} after retry, Yahoo fallback:`,
      lastErr,
    );
  }
  return getYahooOptionsChain(symbol, expiry);
}

/**
 * Energy futures for Markets UI.
 * Prefer CME Group delayed web quotes for NYMEX CL / HO / RB (same JSON as
 * cmegroup.com quotes pages). ICE Brent (BZ=F) stays Yahoo; CME BZ is a
 * different contract. Yahoo is always the fallback if CME is blocked/down.
 */
export type EnergyQuotes = {
  wti: StockQuote;
  brent: StockQuote;
  /** NY Harbor ULSD / heating oil — primary diesel proxy (same as theater HO). */
  heatingOil: StockQuote | null;
  /** RBOB gasoline — secondary product; optional. */
  gasoline: StockQuote | null;
  /** Approx HO*42 − WTI ($/bbl). Rising = refined-product scarcity. */
  dieselCrackUsdPerBbl: number | null;
  /** Approx RB*42 − WTI ($/bbl). */
  gasolineCrackUsdPerBbl: number | null;
};

export async function getEnergyQuotes(): Promise<EnergyQuotes> {
  const [wti, brent, heatingOil, gasoline] = await Promise.all([
    preferCmeThenYahoo("CL", "CL=F", () => getYahooStockQuote("CL=F")),
    getYahooStockQuote("BZ=F"),
    preferCmeThenYahoo("HO", "HO=F", () => getYahooStockQuote("HO=F")).catch(
      () => null,
    ),
    preferCmeThenYahoo("RB", "RB=F", () => getYahooStockQuote("RB=F")).catch(
      () => null,
    ),
  ]);
  const hoPx = heatingOil?.price ?? null;
  const rbPx = gasoline?.price ?? null;
  const wtiPx = wti.price;
  return {
    wti,
    brent,
    heatingOil,
    gasoline,
    dieselCrackUsdPerBbl:
      hoPx != null && wtiPx != null ? hoPx * 42 - wtiPx : null,
    gasolineCrackUsdPerBbl:
      rbPx != null && wtiPx != null ? rbPx * 42 - wtiPx : null,
  };
}
