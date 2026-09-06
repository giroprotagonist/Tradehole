import { apiGet, getAuthStatus } from "./etrade";
import type { OptionContract, OptionsChain, StockQuote } from "./market";

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function expiryIso(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parseExpiryIso(expiry: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiry);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function pickRecord(...candidates: unknown[]): Record<string, unknown> {
  for (const c of candidates) {
    if (c && typeof c === "object") return c as Record<string, unknown>;
  }
  return {};
}

function mapOptionSide(
  raw: Record<string, unknown>,
  type: "call" | "put",
): OptionContract | null {
  const strike = num(raw.strikePrice);
  if (strike == null) return null;
  const greeks = pickRecord(
    raw.OptionGreeks,
    raw.optionGreeks,
    raw.OptionGreek,
    raw.optionGreek,
  );
  const itm = raw.inTheMoney;
  return {
    contractSymbol: String(raw.osiKey ?? raw.displaySymbol ?? `${type}-${strike}`),
    strike,
    lastPrice: num(raw.lastPrice),
    bid: num(raw.bid),
    ask: num(raw.ask),
    change: num(raw.netChange),
    percentChange: null,
    volume: num(raw.volume),
    openInterest: num(raw.openInterest),
    impliedVolatility: num(greeks.iv),
    inTheMoney:
      itm === true || itm === "y" || itm === "Y" || itm === "yes" || itm === "YES",
    type,
  };
}

export async function getEtradeOptionExpireDates(symbol: string): Promise<string[]> {
  const data = await apiGet<{
    OptionExpireDateResponse?: {
      ExpirationDate?:
        | { year?: number; month?: number; day?: number }
        | Array<{ year?: number; month?: number; day?: number }>;
    };
  }>(
    `/v1/market/optionexpiredate?symbol=${encodeURIComponent(symbol)}&expiryType=ALL`,
  );
  const dates = asArray(data.OptionExpireDateResponse?.ExpirationDate)
    .map((d) => {
      const y = Number(d.year);
      const m = Number(d.month);
      const day = Number(d.day);
      if (!y || !m || !day) return null;
      return expiryIso(y, m, day);
    })
    .filter((d): d is string => Boolean(d))
    .sort();
  return [...new Set(dates)];
}

export async function getEtradeOptionsChain(
  symbol: string,
  expiry?: string,
): Promise<OptionsChain> {
  const expirationDates = await getEtradeOptionExpireDates(symbol);
  if (!expirationDates.length) {
    throw new Error(`E*TRADE: no option expiries for ${symbol}`);
  }

  const selectedExpiry =
    (expiry && expirationDates.includes(expiry) ? expiry : null) ??
    expirationDates[0];
  const parts = parseExpiryIso(selectedExpiry);
  if (!parts) throw new Error(`Bad expiry ${selectedExpiry}`);

  // Omit noOfStrikes so E*TRADE returns the full listed book for the expiry
  // (passing a count only returns N strikes near ATM / strikePriceNear).
  const qs = new URLSearchParams({
    symbol: symbol.toUpperCase(),
    expiryYear: String(parts.year),
    expiryMonth: String(parts.month),
    expiryDay: String(parts.day),
    chainType: "CALLPUT",
    priceType: "ALL",
    includeWeekly: "true",
  });

  const data = await apiGet<{
    OptionChainResponse?: {
      OptionPair?: unknown;
      optionPairs?: unknown;
      timeStamp?: number;
      quoteType?: string;
      nearPrice?: number;
      SelectedED?: { year?: number; month?: number; day?: number };
    };
  }>(`/v1/market/optionchains?${qs.toString()}`);

  const resp = data.OptionChainResponse ?? {};
  const pairs = asArray(resp.OptionPair ?? resp.optionPairs);
  const calls: OptionContract[] = [];
  const puts: OptionContract[] = [];

  for (const pair of pairs) {
    const p = pair as Record<string, unknown>;
    const callRaw = pickRecord(p.Call, p.call, p.optionCall, p.OptionCall);
    const putRaw = pickRecord(p.Put, p.put, p.optionPut, p.OptionPut);
    const call = Object.keys(callRaw).length ? mapOptionSide(callRaw, "call") : null;
    const put = Object.keys(putRaw).length ? mapOptionSide(putRaw, "put") : null;
    if (call) calls.push(call);
    if (put) puts.push(put);
  }

  calls.sort((a, b) => a.strike - b.strike);
  puts.sort((a, b) => a.strike - b.strike);

  const selected = resp.SelectedED;
  const selectedFromResp =
    selected?.year && selected?.month && selected?.day
      ? expiryIso(Number(selected.year), Number(selected.month), Number(selected.day))
      : selectedExpiry;

  const quoteType = resp.quoteType ? String(resp.quoteType).toUpperCase() : "UNKNOWN";

  let underlyingPrice = num(resp.nearPrice);
  try {
    const equity = await getEtradeEquityQuote(symbol);
    if (equity.price != null) underlyingPrice = equity.price;
  } catch {
    /* keep nearPrice */
  }

  return {
    symbol: symbol.toUpperCase(),
    underlyingPrice,
    expirationDates,
    selectedExpiry: selectedFromResp,
    calls,
    puts,
    source: `etrade:${quoteType.toLowerCase()}`,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getEtradeEquityQuote(symbol: string): Promise<StockQuote> {
  const data = await apiGet<{
    QuoteResponse?: {
      QuoteData?: unknown;
    };
  }>(`/v1/market/quote/${encodeURIComponent(symbol.toUpperCase())}?detailFlag=ALL`);

  const rows = asArray(data.QuoteResponse?.QuoteData);
  if (!rows.length) {
    throw new Error(`E*TRADE: no quote for ${symbol}`);
  }
  const row = rows[0] as Record<string, unknown>;
  const all = pickRecord(row.All, row.all);
  const product = pickRecord(row.Product, row.product);

  const last =
    num(all.lastTrade) ??
    num(all.lastPrice) ??
    num(all.last) ??
    num(row.lastTrade) ??
    num(row.lastPrice);
  const prevClose = num(all.previousClose) ?? num(all.prevClose);
  const change =
    num(all.changeClose) ??
    num(all.change) ??
    (last != null && prevClose != null ? last - prevClose : null);
  const changePercent =
    num(all.percentChange) ??
    num(all.changeClosePercentage) ??
    (change != null && prevClose ? (change / prevClose) * 100 : null);

  // E*TRADE uses quoteStatus (REALTIME/DELAYED/…). EH_* ≈ extended hours.
  const quoteStatus = String(
    row.quoteStatus ??
      all.quoteStatus ??
      row.quoteType ??
      all.quoteType ??
      "UNKNOWN",
  ).toUpperCase();

  const isExtended =
    quoteStatus.includes("EH") ||
    quoteStatus.includes("EXTENDED") ||
    quoteStatus === "AH";

  let marketState = quoteStatus;
  if (quoteStatus === "REALTIME" || quoteStatus === "DELAYED") {
    marketState = "REGULAR";
  } else if (quoteStatus === "EH_REALTIME" || quoteStatus === "EH_DELAYED") {
    marketState = "POST";
  }

  // E*TRADE ALL payload sometimes includes after-hours / extended fields.
  const ahPrice =
    num(all.afterHoursLastPrice) ??
    num(all.afterHourPrice) ??
    num(all.extendedHourPrice) ??
    num(all.ahLast);
  const ahChange =
    num(all.afterHoursChange) ??
    num(all.extendedHourChange) ??
    num(all.ahChange);
  const ahChangePct =
    num(all.afterHoursPercentChange) ??
    num(all.extendedHourPercentChange) ??
    num(all.ahPercentChange);

  return {
    symbol: String(product.symbol ?? symbol).toUpperCase(),
    price: last,
    change,
    changePercent,
    bid: num(all.bid) ?? num(row.bid),
    ask: num(all.ask) ?? num(row.ask),
    open: num(all.open) ?? num(all.openPrice),
    high: num(all.high) ?? num(all.highPrice),
    low: num(all.low) ?? num(all.lowPrice),
    previousClose: prevClose,
    volume: num(all.totalVolume) ?? num(all.volume),
    marketCap: num(all.marketCap),
    currency: "USD",
    shortName: product.companyName != null ? String(product.companyName) : null,
    marketState,
    extendedPrice: ahPrice,
    extendedChange: ahChange,
    extendedChangePercent: ahChangePct,
    extendedSession: ahPrice != null || isExtended ? "post" : null,
    extendedAsOf: null,
    source: `etrade:${quoteStatus.toLowerCase()}`,
    fetchedAt: new Date().toISOString(),
  };
}

/** Option OSI-style quote: underlier:year:month:day:CALL|PUT:strike */
export function etradeOptionQuoteSymbol(
  underlier: string,
  expiryIso: string,
  type: "call" | "put",
  strike: number,
): string {
  const parts = parseExpiryIso(expiryIso);
  if (!parts) throw new Error(`Bad expiry ${expiryIso}`);
  return `${underlier.toUpperCase()}:${parts.year}:${parts.month}:${parts.day}:${type.toUpperCase()}:${strike}`;
}

export async function getEtradeRawQuotes(symbols: string[]): Promise<unknown> {
  if (!symbols.length) return { QuoteResponse: { QuoteData: [] } };
  // Keep option OSI colons unescaped — E*TRADE path is /market/quote/{sym1,sym2}.json
  const joined = symbols.join(",");
  return apiGet(`/v1/market/quote/${joined}?detailFlag=ALL`);
}

export function etradeMarketAvailable(): boolean {
  return getAuthStatus().authorized;
}
