/**
 * CME Group delayed quotes via the same JSON the public quotes pages hit:
 *   https://www.cmegroup.com/CmeWS/mvc/quotes/v2/{productId}
 * (legacy /CmeWS/mvc/Quotes/Future/{id}/G is gone — AEM product-quotes uses v2.)
 *
 * Light Sweet Crude (CL) page:
 *   https://www.cmegroup.com/markets/energy/crude-oil/light-sweet-crude.quotes.html
 *
 * Not an official licensed real-time feed — delayed web quotes (~10m). Cache
 * aggressively so Markets polling does not hammer CME. Yahoo remains fallback.
 */
import type { StockQuote } from "./market";

/** Coalesce in-flight CME fetches per product (avoid poll stampedes). */
const inflight = new Map<number, Promise<StockQuote | null>>();
function singleFlightQuote(
  productId: number,
  fn: () => Promise<StockQuote | null>,
): Promise<StockQuote | null> {
  const existing = inflight.get(productId);
  if (existing) return existing;
  const p = fn().finally(() => {
    if (inflight.get(productId) === p) inflight.delete(productId);
  });
  inflight.set(productId, p);
  return p;
}

const CME_QUOTES_URL = "https://www.cmegroup.com/CmeWS/mvc/quotes/v2";
const CME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Product IDs from CME ProductSlate (globex codes). */
export const CME_PRODUCT = {
  CL: 425, // Light Sweet Crude / WTI
  HO: 426, // NY Harbor ULSD
  RB: 429, // RBOB Gasoline
  BZ: 424, // Brent Last Day Financial (CME, not ICE dated)
} as const;

export type CmeProductCode = keyof typeof CME_PRODUCT;

/** Keep TTL ≥ Markets Yahoo poll (45s) so we at most 1 CME hit per product per poll window. */
const CACHE_TTL_MS = 60_000;
/** Back off longer after hard blocks / errors. */
const ERROR_BACKOFF_MS = 5 * 60_000;

type CacheEntry = {
  at: number;
  quote: StockQuote | null;
  error?: string;
};

const cache = new Map<number, CacheEntry>();

type CmeRawQuote = {
  last?: string;
  change?: string;
  percentChange?: string;
  percentageChange?: string;
  priorSettle?: string;
  open?: string;
  high?: string;
  low?: string;
  volume?: string;
  updated?: string;
  quoteCode?: string;
  code?: string;
  expirationMonth?: string;
  productName?: string;
  productCode?: string;
  productId?: number;
  isFrontMonth?: boolean;
};

type CmeQuotesResponse = {
  quoteDelayed?: boolean;
  quoteDelay?: string | number;
  tradeDate?: string;
  quotes?: CmeRawQuote[];
  empty?: boolean;
};

function parseCmeNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s || s === "-" || s === "—" || s.toLowerCase() === "null") return null;
  // Indicative last: "78.12i"; bid/ask sometimes end with A/B.
  s = s.replace(/,/g, "").replace(/%$/g, "").replace(/[iIAB]$/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function pickFrontMonth(quotes: CmeRawQuote[]): CmeRawQuote | null {
  if (!quotes.length) return null;
  const flagged = quotes.find(
    (q) => q.isFrontMonth === true && parseCmeNumber(q.last) != null,
  );
  if (flagged) return flagged;
  const flaggedAny = quotes.find((q) => q.isFrontMonth === true);
  if (flaggedAny) return flaggedAny;

  let best: CmeRawQuote | null = null;
  let bestVol = -1;
  for (const q of quotes) {
    const last = parseCmeNumber(q.last);
    const vol = parseCmeNumber(q.volume) ?? 0;
    if (last == null) continue;
    if (vol > bestVol) {
      bestVol = vol;
      best = q;
    }
  }
  if (best) return best;
  for (const q of quotes) {
    const vol = parseCmeNumber(q.volume) ?? 0;
    if (vol > bestVol) {
      bestVol = vol;
      best = q;
    }
  }
  return best ?? quotes[0] ?? null;
}

function mapCmeQuote(
  raw: CmeRawQuote,
  yahooSymbol: string,
  delayNote: string | null,
): StockQuote {
  const last = parseCmeNumber(raw.last);
  const prior = parseCmeNumber(raw.priorSettle);
  let change = parseCmeNumber(raw.change);
  let changePercent = parseCmeNumber(
    raw.percentageChange ?? raw.percentChange,
  );
  if (change == null && last != null && prior != null) {
    change = last - prior;
  }
  if (changePercent == null && change != null && prior != null && prior !== 0) {
    changePercent = (change / prior) * 100;
  }
  const code = String(raw.quoteCode ?? raw.code ?? yahooSymbol);
  const month = raw.expirationMonth ? ` ${raw.expirationMonth}` : "";
  const delayBit = delayNote ? ` (~${delayNote} delayed)` : " (delayed)";
  return {
    symbol: code,
    price: last ?? prior,
    change,
    changePercent,
    bid: null,
    ask: null,
    open: parseCmeNumber(raw.open),
    high: parseCmeNumber(raw.high),
    low: parseCmeNumber(raw.low),
    previousClose: prior,
    volume: parseCmeNumber(raw.volume),
    marketCap: null,
    currency: "USD",
    shortName: `${raw.productName ?? raw.productCode ?? code}${month}`,
    marketState: "REGULAR",
    extendedPrice: null,
    extendedChange: null,
    extendedChangePercent: null,
    extendedSession: null,
    extendedAsOf: raw.updated ? stripHtml(raw.updated) : null,
    source: `cme-group${delayBit}`,
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchCmeProductQuotes(
  productId: number,
): Promise<CmeQuotesResponse> {
  const url = `${CME_QUOTES_URL}/${productId}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": CME_UA,
      Referer:
        "https://www.cmegroup.com/markets/energy/crude-oil/light-sweet-crude.quotes.html",
      Origin: "https://www.cmegroup.com",
      "X-Requested-With": "XMLHttpRequest",
    },
    signal: AbortSignal.timeout(12_000),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 180).replace(/\s+/g, " ");
    try {
      const j = JSON.parse(text) as { message?: string; detail?: string };
      if (j.detail) detail = j.detail.slice(0, 220);
      else if (j.message) detail = j.message.slice(0, 220);
    } catch {
      /* keep slice */
    }
    throw new Error(`CME ${productId} HTTP ${res.status}: ${detail}`);
  }
  return JSON.parse(text) as CmeQuotesResponse;
}

/**
 * Front-month delayed quote for a CME futures product.
 * Cached; returns null on failure (caller should Yahoo-fallback).
 */
export async function getCmeFrontMonthQuote(
  product: CmeProductCode,
  yahooSymbol: string,
): Promise<StockQuote | null> {
  const productId = CME_PRODUCT[product];
  const now = Date.now();
  const hit = cache.get(productId);
  if (hit) {
    const age = now - hit.at;
    const ttl = hit.quote ? CACHE_TTL_MS : ERROR_BACKOFF_MS;
    if (age < ttl) return hit.quote;
  }

  return singleFlightQuote(productId, async () => {
    const again = cache.get(productId);
    if (again) {
      const age = Date.now() - again.at;
      const ttl = again.quote ? CACHE_TTL_MS : ERROR_BACKOFF_MS;
      if (age < ttl) return again.quote;
    }
    try {
      const body = await fetchCmeProductQuotes(productId);
      const front = pickFrontMonth(body.quotes ?? []);
      if (!front) {
        cache.set(productId, {
          at: Date.now(),
          quote: null,
          error: "empty quotes",
        });
        return null;
      }
      const delayNote =
        body.quoteDelay != null ? String(body.quoteDelay) : null;
      const quote = mapCmeQuote(front, yahooSymbol, delayNote);
      cache.set(productId, { at: Date.now(), quote });
      return quote;
    } catch (err) {
      const msg = String(err);
      console.warn(`[tradehole] CME quote failed for ${product}:`, msg);
      cache.set(productId, {
        at: Date.now(),
        quote: null,
        error: msg,
      });
      return null;
    }
  });
}

/** Prefer CME; on miss/error return Yahoo result. */
export async function preferCmeThenYahoo(
  product: CmeProductCode,
  yahooSymbol: string,
  yahooFetch: () => Promise<StockQuote>,
): Promise<StockQuote> {
  const cme = await getCmeFrontMonthQuote(product, yahooSymbol);
  if (cme?.price != null) return cme;
  return yahooFetch();
}

/** Test helpers */
export function _resetCmeQuoteCacheForTests(): void {
  cache.clear();
}

export function _parseCmeNumberForTests(raw: unknown): number | null {
  return parseCmeNumber(raw);
}

export function _pickFrontMonthForTests(
  quotes: CmeRawQuote[],
): CmeRawQuote | null {
  return pickFrontMonth(quotes);
}

export function _mapCmeQuoteForTests(
  raw: CmeRawQuote,
  yahooSymbol: string,
  delayNote: string | null,
): StockQuote {
  return mapCmeQuote(raw, yahooSymbol, delayNote);
}
