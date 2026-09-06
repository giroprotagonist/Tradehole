import { getOptionsChain, getStockQuote, type OptionContract } from "../market";
import { bsGamma, dealerGex, yearsToExpiry } from "./greeks";

export type GexStrikeRow = {
  expiry: string;
  strike: number;
  callOi: number;
  putOi: number;
  callIv: number | null;
  putIv: number | null;
  callGamma: number | null;
  putGamma: number | null;
  callGex: number;
  putGex: number;
  netGex: number;
};

export type GexProfile = {
  symbol: string;
  spot: number | null;
  expiries: string[];
  asOf: string;
  rows: GexStrikeRow[];
  byExpiry: Array<{
    expiry: string;
    totalNetGex: number;
    flipStrike: number | null;
    maxPainNote: string;
  }>;
  aggregateNetGex: number;
  flipStrikeNearSpot: number | null;
  regime: "short_gamma" | "long_gamma" | "mixed" | "unknown";
  regimeNote: string;
  csv: string;
  source: string;
  method: string;
};

function ivOf(c: OptionContract | undefined): number | null {
  return c?.impliedVolatility ?? null;
}

function oiOf(c: OptionContract | undefined): number {
  return c?.openInterest ?? 0;
}

function buildRows(
  expiry: string,
  calls: OptionContract[],
  puts: OptionContract[],
  spot: number,
): GexStrikeRow[] {
  const t = yearsToExpiry(expiry);
  const strikes = [
    ...new Set([...calls.map((c) => c.strike), ...puts.map((p) => p.strike)]),
  ].sort((a, b) => a - b);

  return strikes
    .filter((s) => s >= spot * 0.7 && s <= spot * 1.4)
    .map((strike) => {
      const call = calls.find((c) => Math.abs(c.strike - strike) < 0.01);
      const put = puts.find((p) => Math.abs(p.strike - strike) < 0.01);
      const callIv = ivOf(call);
      const putIv = ivOf(put);
      const callGamma =
        callIv != null ? bsGamma(spot, strike, t, callIv) : null;
      const putGamma = putIv != null ? bsGamma(spot, strike, t, putIv) : null;
      const callOi = oiOf(call);
      const putOi = oiOf(put);
      const callGex =
        callGamma != null ? dealerGex(callGamma, callOi, spot, "call") : 0;
      const putGex =
        putGamma != null ? dealerGex(putGamma, putOi, spot, "put") : 0;
      return {
        expiry,
        strike,
        callOi,
        putOi,
        callIv,
        putIv,
        callGamma,
        putGamma,
        callGex,
        putGex,
        netGex: callGex + putGex,
      };
    });
}

/** Find strike where cumulative net GEX crosses zero (flip approx). */
function estimateFlip(rows: GexStrikeRow[]): number | null {
  if (rows.length < 2) return null;
  let cum = 0;
  for (let i = 0; i < rows.length; i++) {
    const prev = cum;
    cum += rows[i]!.netGex;
    if (i > 0 && ((prev <= 0 && cum >= 0) || (prev >= 0 && cum <= 0))) {
      return rows[i]!.strike;
    }
  }
  // Fallback: strike with largest |net| polarity change vs spot cluster
  const neg = rows.filter((r) => r.netGex < 0);
  const pos = rows.filter((r) => r.netGex > 0);
  if (!neg.length || !pos.length) return null;
  const edge = [...neg].sort((a, b) => b.strike - a.strike)[0];
  return edge?.strike ?? null;
}

export async function buildGexProfile(
  symbol = "FRO",
  expiries = ["2026-08-21", "2026-09-18"],
): Promise<GexProfile> {
  const quote = await getStockQuote(symbol);
  const spot = quote.price;
  const allRows: GexStrikeRow[] = [];
  let source = quote.source;

  for (const expiry of expiries) {
    try {
      const chain = await getOptionsChain(symbol, expiry);
      source = chain.source;
      if (spot == null) continue;
      allRows.push(...buildRows(expiry, chain.calls, chain.puts, spot));
    } catch (err) {
      console.warn(`[tradehole] GEX chain ${expiry}:`, err);
    }
  }

  const byExpiry = expiries.map((expiry) => {
    const rows = allRows.filter((r) => r.expiry === expiry);
    const totalNetGex = rows.reduce((s, r) => s + r.netGex, 0);
    const flipStrike = estimateFlip(rows);
    return {
      expiry,
      totalNetGex,
      flipStrike,
      maxPainNote:
        flipStrike != null
          ? `Approx GEX flip near $${flipStrike}`
          : totalNetGex < 0
            ? "Net short gamma across strikes (amplifying)"
            : "Net long gamma across strikes (mean-reverting)",
    };
  });

  const aggregateNetGex = allRows.reduce((s, r) => s + r.netGex, 0);
  const near =
    spot != null
      ? allRows.filter((r) => Math.abs(r.strike - spot) / spot < 0.08)
      : [];
  const nearNet = near.reduce((s, r) => s + r.netGex, 0);

  let regime: GexProfile["regime"] = "unknown";
  let regimeNote = "Insufficient chain/spot for GEX.";
  if (spot != null && allRows.length) {
    if (nearNet < 0 || aggregateNetGex < 0) {
      regime = "short_gamma";
      regimeNote =
        "Dealers appear net short gamma near spot — moves can amplify (supportive for call upside on a squeeze).";
    } else if (nearNet > 0 && aggregateNetGex > 0) {
      regime = "long_gamma";
      regimeNote =
        "Dealers appear net long gamma near spot — rallies may get sold (caps upside into strength).";
    } else {
      regime = "mixed";
      regimeNote = "Mixed GEX — watch the flip strike vs spot.";
    }
  }

  const header =
    "expiry,strike,call_oi,put_oi,call_iv,put_iv,call_gamma,put_gamma,call_gex,put_gex,net_gex";
  const lines = allRows.map((r) =>
    [
      r.expiry,
      r.strike,
      r.callOi,
      r.putOi,
      r.callIv,
      r.putIv,
      r.callGamma,
      r.putGamma,
      r.callGex,
      r.putGex,
      r.netGex,
    ].join(","),
  );

  const flipStrikeNearSpot =
    byExpiry.find((e) => e.expiry === "2026-09-18")?.flipStrike ??
    byExpiry[0]?.flipStrike ??
    null;

  return {
    symbol: symbol.toUpperCase(),
    spot,
    expiries,
    asOf: new Date().toISOString(),
    rows: allRows,
    byExpiry,
    aggregateNetGex,
    flipStrikeNearSpot,
    regime,
    regimeNote,
    csv: [header, ...lines].join("\n"),
    source,
    method:
      "BS gamma from listed IV × OI × 100 × spot; calls +, puts − (dealer-short-customer convention). Not signed customer flow.",
  };
}
