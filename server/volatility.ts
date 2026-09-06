import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import YahooFinance from "yahoo-finance2";
import { getOptionsChain, getStockQuote, type OptionContract, type OptionsChain } from "./market";
import { computeIvRank } from "./analytics/ivRank";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export type TermPoint = {
  expiry: string;
  dte: number;
  atmIv: number | null;
  callIv: number | null;
  putIv: number | null;
};

export type SmilePoint = {
  strike: number;
  callIv: number | null;
  putIv: number | null;
  moneyness: number | null;
};

export type IvSnapshot = {
  date: string;
  atmIv: number;
  spot: number | null;
};

export type VolatilityReport = {
  symbol: string;
  spot: number | null;
  selectedExpiry: string | null;
  dte: number | null;
  atmIv: number | null;
  atmCallIv: number | null;
  atmPutIv: number | null;
  atmStrike: number | null;
  skew: number | null;
  skewNote: string;
  hv20: number | null;
  hv30: number | null;
  ivMinusHv20: number | null;
  ivRank: number | null;
  ivPercentile: number | null;
  snapshotCount: number;
  snapshotDays: number;
  positionFocus: {
    strike: number;
    type: "call" | "put";
    expiry: string | null;
    iv: number | null;
    moneyness: number | null;
    contractSymbol: string | null;
  } | null;
  termStructure: TermPoint[];
  smile: SmilePoint[];
  fetchedAt: string;
};

function dataDir(): string {
  if (process.env.TRADEHOLE_DATA_DIR) return process.env.TRADEHOLE_DATA_DIR;
  return path.join(os.homedir(), "Library", "Application Support", "Tradehole");
}

function snapshotPath(symbol: string): string {
  return path.join(dataDir(), "iv-snapshots", `${symbol.toUpperCase()}.json`);
}

function readSnapshots(symbol: string): IvSnapshot[] {
  try {
    const p = snapshotPath(symbol);
    if (!fs.existsSync(p)) return [];
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as IvSnapshot[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeSnapshots(symbol: string, rows: IvSnapshot[]): void {
  const dir = path.dirname(snapshotPath(symbol));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(snapshotPath(symbol), JSON.stringify(rows, null, 2));
}

/** One ATM IV point per calendar day (overwrite today's). */
export function recordAtmIvSnapshot(
  symbol: string,
  atmIv: number,
  spot: number | null,
): IvSnapshot[] {
  const today = new Date().toISOString().slice(0, 10);
  // Drop prior junk floors and skip writing a new junk point.
  const existing = readSnapshots(symbol).filter(
    (r) => r.date !== today && isPlausibleIv(r.atmIv),
  );
  if (!isPlausibleIv(atmIv)) {
    writeSnapshots(symbol, existing.slice(-750));
    return existing.slice(-750);
  }
  const next = [...existing, { date: today, atmIv, spot }].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  // Keep ~2 years
  const trimmed = next.slice(-750);
  writeSnapshots(symbol, trimmed);
  return trimmed;
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

function nearestByStrike(rows: OptionContract[], spot: number): OptionContract | null {
  if (!rows.length) return null;
  return rows.reduce((best, row) =>
    Math.abs(row.strike - spot) < Math.abs(best.strike - spot) ? row : best,
  );
}

/** Yahoo floor IVs (~0.00001) when quotes are blank — not usable for ATM / IV Rank. */
function isPlausibleIv(iv: number): boolean {
  const pct = iv > 2 ? iv : iv * 100;
  return Number.isFinite(pct) && pct >= 5 && pct <= 250;
}

function ivToPct(iv: number): number {
  return iv > 2 ? iv : iv * 100;
}

/**
 * Headline ATM for call-focused packs: average call+put when they agree;
 * prefer call when put skew would overstate (e.g. call ~51% / put ~79% → ~65%).
 */
function atmFromChain(
  chain: OptionsChain,
  spot: number,
): {
  atmIv: number | null;
  atmCallIv: number | null;
  atmPutIv: number | null;
  atmStrike: number | null;
} {
  const call = nearestByStrike(chain.calls, spot);
  const put = nearestByStrike(chain.puts, spot);
  const rawCall = call?.impliedVolatility ?? null;
  const rawPut = put?.impliedVolatility ?? null;
  const atmCallIv =
    rawCall != null && isPlausibleIv(rawCall) ? rawCall : null;
  const atmPutIv = rawPut != null && isPlausibleIv(rawPut) ? rawPut : null;
  let atmIv: number | null = null;
  if (atmCallIv != null && atmPutIv != null) {
    const skewPts = Math.abs(ivToPct(atmCallIv) - ivToPct(atmPutIv));
    atmIv = skewPts >= 15 ? atmCallIv : (atmCallIv + atmPutIv) / 2;
  } else {
    atmIv = atmCallIv ?? atmPutIv;
  }
  const atmStrike = call?.strike ?? put?.strike ?? null;
  return { atmIv, atmCallIv, atmPutIv, atmStrike };
}

/** 25-delta proxy: ~7.5% OTM put IV minus ~7.5% OTM call IV */
function computeSkew(
  chain: OptionsChain,
  spot: number,
): { skew: number | null; note: string } {
  const putStrike = spot * 0.925;
  const callStrike = spot * 1.075;
  const put = nearestByStrike(
    chain.puts.filter((p) => p.strike <= spot),
    putStrike,
  );
  const call = nearestByStrike(
    chain.calls.filter((c) => c.strike >= spot),
    callStrike,
  );
  if (put?.impliedVolatility == null || call?.impliedVolatility == null) {
    return { skew: null, note: "Need OTM put & call IVs" };
  }
  return {
    skew: put.impliedVolatility - call.impliedVolatility,
    note: `Put $${put.strike} IV − Call $${call.strike} IV`,
  };
}

function smileFromChain(chain: OptionsChain, spot: number): SmilePoint[] {
  const strikes = new Set<number>([
    ...chain.calls.map((c) => c.strike),
    ...chain.puts.map((p) => p.strike),
  ]);
  return [...strikes]
    .sort((a, b) => a - b)
    .filter((s) => Math.abs(s - spot) / spot <= 0.35)
    .map((strike) => {
      const call = chain.calls.find((c) => c.strike === strike);
      const put = chain.puts.find((p) => p.strike === strike);
      return {
        strike,
        callIv: call?.impliedVolatility ?? null,
        putIv: put?.impliedVolatility ?? null,
        moneyness: spot ? strike / spot : null,
      };
    });
}

async function realizedVol(symbol: string, window: number): Promise<number | null> {
  const period1 = new Date();
  period1.setUTCDate(period1.getUTCDate() - (window + 40));
  const chart = await yahooFinance.chart(symbol, {
    period1,
    interval: "1d",
  });
  const closes = (chart.quotes ?? [])
    .map((q) => q.close)
    .filter((c): c is number => typeof c === "number" && Number.isFinite(c));
  if (closes.length < window + 1) return null;

  const slice = closes.slice(-(window + 1));
  const rets: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    rets.push(Math.log(slice[i] / slice[i - 1]));
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance =
    rets.reduce((acc, r) => acc + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

function ivRankAndPercentile(snapshots: IvSnapshot[], current: number): {
  ivRank: number | null;
  ivPercentile: number | null;
} {
  if (snapshots.length < 5) {
    return { ivRank: null, ivPercentile: null };
  }
  const vals = snapshots.map((s) => s.atmIv);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const ivRank = max > min ? ((current - min) / (max - min)) * 100 : 50;
  const below = vals.filter((v) => v <= current).length;
  const ivPercentile = (below / vals.length) * 100;
  return { ivRank, ivPercentile };
}

function findPositionContract(
  chain: OptionsChain,
  strike: number,
  type: "call" | "put",
  spot: number | null,
): VolatilityReport["positionFocus"] {
  const rows = type === "call" ? chain.calls : chain.puts;
  const row = rows.find((r) => Math.abs(r.strike - strike) < 0.01) ?? nearestByStrike(rows, strike);
  if (!row) {
    return {
      strike,
      type,
      expiry: chain.selectedExpiry,
      iv: null,
      moneyness: null,
      contractSymbol: null,
    };
  }
  return {
    strike: row.strike,
    type,
    expiry: chain.selectedExpiry,
    iv: row.impliedVolatility,
    moneyness: spot ? row.strike / spot : null,
    contractSymbol: row.contractSymbol || null,
  };
}

export async function getVolatilityReport(
  symbol: string,
  opts?: {
    expiry?: string;
    focusStrike?: number;
    focusType?: "call" | "put";
    focusExpiry?: string;
  },
): Promise<VolatilityReport> {
  const focusStrike = opts?.focusStrike ?? 46;
  const focusType = opts?.focusType ?? "call";
  const focusExpiry = opts?.focusExpiry; // e.g. 2026-09-18 for user's FRO calls

  const quote = await getStockQuote(symbol);
  const spot = quote.price;

  const primaryExpiry = focusExpiry ?? opts?.expiry;
  const primaryChain = await getOptionsChain(symbol, primaryExpiry);

  // Prefer focus expiry chain for position; term uses nearest listed expiries
  let positionChain = primaryChain;
  if (focusExpiry && primaryChain.selectedExpiry !== focusExpiry) {
    try {
      positionChain = await getOptionsChain(symbol, focusExpiry);
    } catch {
      positionChain = primaryChain;
    }
  }

  const selectedExpiry = primaryChain.selectedExpiry;
  const dte =
    selectedExpiry != null
      ? daysBetween(new Date(), new Date(`${selectedExpiry}T00:00:00Z`))
      : null;

  const atm = spot != null ? atmFromChain(primaryChain, spot) : {
    atmIv: null,
    atmCallIv: null,
    atmPutIv: null,
    atmStrike: null,
  };

  const { skew, note: skewNote } =
    spot != null ? computeSkew(primaryChain, spot) : { skew: null, note: "No spot" };

  const smile = spot != null ? smileFromChain(primaryChain, spot) : [];

  const [hv20, hv30] = await Promise.all([
    realizedVol(symbol, 20),
    realizedVol(symbol, 30),
  ]);

  // Term structure: up to 6 expiries
  const expiries = primaryChain.expirationDates.slice(0, 6);
  const termStructure: TermPoint[] = [];
  for (const expiry of expiries) {
    try {
      const chain =
        expiry === primaryChain.selectedExpiry
          ? primaryChain
          : await getOptionsChain(symbol, expiry);
      const point = spot != null ? atmFromChain(chain, spot) : { atmIv: null, atmCallIv: null, atmPutIv: null, atmStrike: null };
      termStructure.push({
        expiry,
        dte: daysBetween(new Date(), new Date(`${expiry}T00:00:00Z`)),
        atmIv: point.atmIv,
        callIv: point.atmCallIv,
        putIv: point.atmPutIv,
      });
    } catch {
      termStructure.push({
        expiry,
        dte: daysBetween(new Date(), new Date(`${expiry}T00:00:00Z`)),
        atmIv: null,
        callIv: null,
        putIv: null,
      });
    }
  }

  let snapshots = readSnapshots(symbol);
  if (atm.atmIv != null && atm.atmIv > 0) {
    snapshots = recordAtmIvSnapshot(symbol, atm.atmIv, spot);
  }
  // Prefer richer local ATM history (SQLite + JSON) for IV rank when available.
  let { ivRank, ivPercentile } =
    atm.atmIv != null
      ? ivRankAndPercentile(snapshots, atm.atmIv)
      : { ivRank: null, ivPercentile: null };
  let snapshotCount = snapshots.length;
  try {
    const richer = await computeIvRank(symbol);
    if (richer.sampleDays >= snapshotCount && richer.ivRank != null) {
      ivRank = richer.ivRank;
      ivPercentile = richer.ivPercentile;
      snapshotCount = richer.sampleDays;
    }
  } catch {
    /* keep JSON-only rank */
  }

  const positionFocus = findPositionContract(
    positionChain,
    focusStrike,
    focusType,
    spot,
  );
  // If focus expiry differs, annotate expiry from position chain
  if (positionFocus) {
    positionFocus.expiry = positionChain.selectedExpiry;
  }

  return {
    symbol: symbol.toUpperCase(),
    spot,
    selectedExpiry,
    dte,
    atmIv: atm.atmIv,
    atmCallIv: atm.atmCallIv,
    atmPutIv: atm.atmPutIv,
    atmStrike: atm.atmStrike,
    skew,
    skewNote,
    hv20,
    hv30,
    ivMinusHv20:
      atm.atmIv != null && hv20 != null ? atm.atmIv - hv20 : null,
    ivRank,
    ivPercentile,
    snapshotCount,
    snapshotDays: snapshotCount
      ? snapshots.length
        ? daysBetween(
            new Date(`${snapshots[0].date}T00:00:00Z`),
            new Date(`${snapshots[snapshots.length - 1].date}T00:00:00Z`),
          ) + 1
        : snapshotCount
      : 0,
    positionFocus,
    termStructure,
    smile,
    fetchedAt: new Date().toISOString(),
  };
}
