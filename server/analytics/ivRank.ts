import fs from "node:fs";
import path from "node:path";
import { getHistoryDb, historyDataDir } from "../history/db";
import { getOptionsChain, getStockQuote } from "../market";

export type IvRankReport = {
  atmIv: number | null;
  atmIvPct: number | null;
  atmCallIvPct: number | null;
  atmPutIvPct: number | null;
  ivRank: number | null;
  ivPercentile: number | null;
  sampleDays: number;
  low: number | null;
  high: number | null;
  windowNote: string;
  sufficientFor52w: boolean;
  series: Array<{ date: string; atmIv: number }>;
};

function toPct(iv: number): number {
  return iv > 2 ? iv : iv * 100;
}

/** Yahoo often returns floor IVs (~0.00001 / ~0.78%) when bid/ask are blank — exclude those. */
function isPlausibleAtmIvPct(pct: number): boolean {
  return Number.isFinite(pct) && pct >= 5 && pct <= 250;
}

function readJsonIvSnapshots(symbol: string): Array<{ date: string; atmIv: number }> {
  try {
    const p = path.join(
      historyDataDir(),
      "iv-snapshots",
      `${symbol.toUpperCase()}.json`,
    );
    if (!fs.existsSync(p)) return [];
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Array<{
      date: string;
      atmIv: number;
    }>;
    return Array.isArray(raw)
      ? raw.filter(
          (r) =>
            r?.date &&
            Number.isFinite(r.atmIv) &&
            isPlausibleAtmIvPct(toPct(r.atmIv)),
        )
      : [];
  } catch {
    return [];
  }
}

/** Daily ATM IV from SQLite: for each day, median near-spot *call* IV (call-pack bias). */
function sqliteDailyAtm(symbol: string): Array<{ date: string; atmIv: number }> {
  const db = getHistoryDb();
  if (!db) return [];
  const rows = db
    .prepare(
      `SELECT substr(ts,1,10) AS d, strike, iv, spot, type
       FROM option_snapshots
       WHERE symbol = ? AND iv IS NOT NULL AND spot IS NOT NULL
       ORDER BY ts ASC`,
    )
    .all(symbol.toUpperCase()) as Array<{
    d: string;
    strike: number;
    iv: number;
    spot: number;
    type: string;
  }>;

  const byDay = new Map<string, number[]>();
  const byDayPuts = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.spot || !r.iv) continue;
    // Near ATM: within 5% of spot
    if (Math.abs(r.strike - r.spot) / r.spot > 0.05) continue;
    const pct = toPct(r.iv);
    if (!isPlausibleAtmIvPct(pct)) continue;
    const map = r.type === "put" ? byDayPuts : byDay;
    const arr = map.get(r.d) ?? [];
    arr.push(pct);
    map.set(r.d, arr);
  }

  const dates = new Set([...byDay.keys(), ...byDayPuts.keys()]);
  return [...dates]
    .map((date) => {
      // Prefer call ATM; fall back to puts only if no call prints that day.
      const vals = byDay.get(date) ?? byDayPuts.get(date) ?? [];
      const s = [...vals].sort((a, b) => a - b);
      const mid = s[Math.floor(s.length / 2)]!;
      return { date, atmIv: mid };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function computeIvRank(symbol = "FRO"): Promise<IvRankReport> {
  const sym = symbol.toUpperCase();
  const quote = await getStockQuote(sym);
  const spot = quote.price;
  let atmIv: number | null = null;
  let atmCallIv: number | null = null;
  let atmPutIv: number | null = null;
  try {
    const chain = await getOptionsChain(sym, "2026-09-18");
    if (spot != null) {
      const call = chain.calls.reduce((best, row) =>
        !best || Math.abs(row.strike - spot) < Math.abs(best.strike - spot)
          ? row
          : best,
      );
      const put =
        chain.puts.find((p) => Math.abs(p.strike - call.strike) < 0.01) ??
        null;
      atmCallIv =
        call.impliedVolatility != null &&
        isPlausibleAtmIvPct(toPct(call.impliedVolatility))
          ? call.impliedVolatility
          : null;
      atmPutIv =
        put?.impliedVolatility != null &&
        isPlausibleAtmIvPct(toPct(put.impliedVolatility))
          ? put.impliedVolatility
          : null;
      if (atmCallIv != null && atmPutIv != null) {
        const skewPts = Math.abs(toPct(atmCallIv) - toPct(atmPutIv));
        // Prefer call ATM when put skew would overstate for call packs.
        atmIv = skewPts >= 15 ? atmCallIv : (atmCallIv + atmPutIv) / 2;
      } else {
        atmIv = atmCallIv ?? atmPutIv;
      }
    }
  } catch {
    /* ignore */
  }

  const merged = new Map<string, number>();
  for (const r of readJsonIvSnapshots(sym)) {
    merged.set(r.date, toPct(r.atmIv));
  }
  for (const r of sqliteDailyAtm(sym)) {
    merged.set(r.date, r.atmIv);
  }
  if (atmIv != null) {
    merged.set(new Date().toISOString().slice(0, 10), toPct(atmIv));
  }

  const series = [...merged.entries()]
    .map(([date, atmIvPct]) => ({ date, atmIv: atmIvPct }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const vals = series.map((s) => s.atmIv);
  const sampleDays = vals.length;
  const sufficientFor52w = sampleDays >= 200;
  const low = vals.length ? Math.min(...vals) : null;
  const high = vals.length ? Math.max(...vals) : null;
  const current = atmIv != null ? toPct(atmIv) : vals.at(-1) ?? null;

  let ivRank: number | null = null;
  let ivPercentile: number | null = null;
  if (current != null && low != null && high != null && sampleDays >= 5) {
    ivRank = high > low ? ((current - low) / (high - low)) * 100 : 50;
    const below = vals.filter((v) => v <= current).length;
    ivPercentile = (below / vals.length) * 100;
  }

  let windowNote = `Only ${sampleDays} daily ATM IV point(s) in local memory — DO NOT trade on IV Rank until ≥20 local days accumulate.`;
  if (sampleDays >= 5 && sampleDays < 20 && !sufficientFor52w) {
    windowNote = `IV Rank uses ${sampleDays} local daily ATM points (provisional). Prefer call ATM when call/put skew is wide; treat rank as informational only until ≥20 days.`;
  } else if (sampleDays >= 20 && !sufficientFor52w) {
    windowNote = `IV Rank uses ${sampleDays} local daily ATM points (not a full 52-week sample yet). Keep Tradehole open to accumulate; treat as provisional.`;
  } else if (sufficientFor52w) {
    windowNote = `IV Rank over ~${sampleDays} local daily ATM snapshots (approaching 52-week coverage).`;
  }

  return {
    atmIv,
    atmIvPct: current,
    atmCallIvPct: atmCallIv != null ? toPct(atmCallIv) : null,
    atmPutIvPct: atmPutIv != null ? toPct(atmPutIv) : null,
    ivRank,
    ivPercentile,
    sampleDays,
    low,
    high,
    windowNote,
    sufficientFor52w,
    series: series.slice(-400),
  };
}
