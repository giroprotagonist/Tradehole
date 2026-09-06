import YahooFinance from "yahoo-finance2";
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
  source: "yahoo-finance2";
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

export async function getStockQuote(symbol: string): Promise<StockQuote> {
  const q = await yahooFinance.quote(symbol);
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
    source: "yahoo-finance2",
    fetchedAt: new Date().toISOString(),
  };
}

export async function getOptionsChain(
  symbol: string,
  expiry?: string,
): Promise<OptionsChain> {
  const result = await yahooFinance.options(symbol, expiry ? { date: new Date(expiry) } : undefined);
  const expirationDates = (result.expirationDates ?? []).map((d) =>
    d.toISOString().slice(0, 10),
  );
  const selectedExpiry =
    result.options?.[0]?.expirationDate?.toISOString().slice(0, 10) ??
    expirationDates[0] ??
    null;

  const optionSlice = result.options?.[0];
  const calls = (optionSlice?.calls ?? []).map((c) =>
    mapContract(c as unknown as Record<string, unknown>, "call"),
  );
  const puts = (optionSlice?.puts ?? []).map((p) =>
    mapContract(p as unknown as Record<string, unknown>, "put"),
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

/**
 * Prefer CME Group delayed web quotes for WTI (CL) — same JSON as
 * cmegroup.com light-sweet-crude.quotes.html. ICE Brent (BZ=F) stays Yahoo.
 * Yahoo is always the fallback if CME is blocked/down.
 */
export async function getEnergyQuotes(): Promise<{
  wti: StockQuote;
  brent: StockQuote;
}> {
  const [wti, brent] = await Promise.all([
    preferCmeThenYahoo("CL", "CL=F", () => getStockQuote("CL=F")),
    getStockQuote("BZ=F"),
  ]);
  return { wti, brent };
}
