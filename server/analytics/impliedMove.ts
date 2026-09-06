import { getOptionsChain, getStockQuote } from "../market";

export type ImpliedMoveReport = {
  symbol: string;
  expiry: string;
  spot: number | null;
  atmStrike: number | null;
  callLast: number | null;
  putLast: number | null;
  callMid: number | null;
  putMid: number | null;
  straddleMid: number | null;
  impliedMovePct: number | null;
  impliedMoveDollars: number | null;
  note: string;
  asOf: string;
  source: string;
};

function mid(bid: number | null, ask: number | null, last: number | null): number | null {
  if (bid != null && ask != null && ask >= bid && bid > 0) return (bid + ask) / 2;
  return last;
}

export async function impliedMoveForExpiry(
  symbol = "FRO",
  expiry = "2026-09-18",
): Promise<ImpliedMoveReport> {
  const [quote, chain] = await Promise.all([
    getStockQuote(symbol),
    getOptionsChain(symbol, expiry),
  ]);
  const spot = quote.price ?? chain.underlyingPrice;
  if (spot == null) {
    return {
      symbol: symbol.toUpperCase(),
      expiry,
      spot: null,
      atmStrike: null,
      callLast: null,
      putLast: null,
      callMid: null,
      putMid: null,
      straddleMid: null,
      impliedMovePct: null,
      impliedMoveDollars: null,
      note: "No spot for ATM straddle.",
      asOf: new Date().toISOString(),
      source: chain.source,
    };
  }

  const call = chain.calls.reduce((best, row) =>
    !best || Math.abs(row.strike - spot) < Math.abs(best.strike - spot) ? row : best,
  );
  const put =
    chain.puts.find((p) => Math.abs(p.strike - call.strike) < 0.01) ??
    chain.puts.reduce((best, row) =>
      !best || Math.abs(row.strike - spot) < Math.abs(best.strike - spot) ? row : best,
    );

  const callMid = mid(call.bid, call.ask, call.lastPrice);
  const putMid = mid(put.bid, put.ask, put.lastPrice);
  const straddle =
    callMid != null && putMid != null ? callMid + putMid : null;
  const impliedMovePct = straddle != null ? (straddle / spot) * 100 : null;
  const impliedMoveDollars = straddle;

  let note = "ATM straddle unavailable.";
  if (impliedMovePct != null) {
    if (impliedMovePct > 20) {
      note = `Market prices >20% move to ${expiry} — rich vol; long OTM calls need a real shock.`;
    } else if (impliedMovePct >= 12) {
      note = `Implied move ~${impliedMovePct.toFixed(1)}% — mid regime into ${expiry}.`;
    } else {
      note = `Implied move <12% — market looks complacent into ${expiry}; OTM premium may be rich vs expected risk.`;
    }
  }

  return {
    symbol: symbol.toUpperCase(),
    expiry,
    spot,
    atmStrike: call.strike,
    callLast: call.lastPrice,
    putLast: put.lastPrice,
    callMid,
    putMid,
    straddleMid: straddle,
    impliedMovePct,
    impliedMoveDollars,
    note,
    asOf: new Date().toISOString(),
    source: chain.source,
  };
}
