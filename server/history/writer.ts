import type { OptionsChain, StockQuote } from "../market";
import { getOptionsChain } from "../market";
import type { PhysicalMarkets } from "../physical";
import { detectAnomalies } from "./anomalies";
import {
  STRIKE_MAX,
  STRIKE_MIN,
  WRITE_INTERVAL_MS,
  daysToExpiry,
  getEodDayWritten,
  getHistoryDb,
  getLastWriteAtMs,
  markWrite,
  pruneHistory,
  setEodDayWritten,
} from "./db";

const MAX_EXPIRIES_PER_WRITE = 8;
const FOCUS_EXPIRY = "2026-09-18";

let writeInFlight: Promise<HistoryWriteResult> | null = null;

export type HistoryWriteInput = {
  fro: StockQuote;
  options: OptionsChain;
  energy: { wti: StockQuote; brent: StockQuote };
  physical: PhysicalMarkets;
};

export type HistoryWriteResult = {
  wrote: boolean;
  reason: string;
  optionRows: number;
  alerts: number;
};

function inBand(strike: number): boolean {
  return strike >= STRIKE_MIN && strike <= STRIKE_MAX;
}

function calendarDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function shouldWrite(nowMs: number, marketState: string | null): {
  ok: boolean;
  reason: string;
  eod: boolean;
} {
  const last = getLastWriteAtMs();
  const state = (marketState ?? "").toUpperCase();
  const isRegular = state === "REGULAR" || state === "" || state.includes("OPEN");
  const day = calendarDay(new Date(nowMs));
  const eodEligible =
    !isRegular && getEodDayWritten() !== day && last > 0;

  if (last === 0) {
    return { ok: true, reason: "first_write", eod: false };
  }
  if (eodEligible) {
    return { ok: true, reason: "eod_rollup", eod: true };
  }
  if (nowMs - last >= WRITE_INTERVAL_MS) {
    return { ok: true, reason: isRegular ? "interval" : "interval_off_hours", eod: false };
  }
  return {
    ok: false,
    reason: `throttled_${Math.ceil((WRITE_INTERVAL_MS - (nowMs - last)) / 1000)}s`,
    eod: false,
  };
}

function pickExpiries(dates: string[], selected: string | null): string[] {
  const set = new Set<string>();
  if (selected) set.add(selected);
  set.add(FOCUS_EXPIRY);
  for (const d of dates) set.add(d);
  return [...set]
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .slice(0, MAX_EXPIRIES_PER_WRITE);
}

/**
 * Record history from a live market snapshot. Safe to call on every poll —
 * throttles to ~5 minutes (plus first write / EOD rollup).
 */
export async function maybeRecordHistory(
  input: HistoryWriteInput,
): Promise<HistoryWriteResult> {
  if (writeInFlight) return writeInFlight;
  writeInFlight = recordHistoryOnce(input).finally(() => {
    writeInFlight = null;
  });
  return writeInFlight;
}

async function recordHistoryOnce(
  input: HistoryWriteInput,
): Promise<HistoryWriteResult> {
  const database = getHistoryDb();
  if (!database) {
    return { wrote: false, reason: "disabled", optionRows: 0, alerts: 0 };
  }

  const now = new Date();
  const nowMs = now.getTime();
  const gate = shouldWrite(nowMs, input.fro.marketState);
  if (!gate.ok) {
    return { wrote: false, reason: gate.reason, optionRows: 0, alerts: 0 };
  }

  const ts = now.toISOString();
  const symbol = (input.fro.symbol || "FRO").toUpperCase();
  const spot = input.fro.price ?? input.options.underlyingPrice;
  const source = input.options.source ?? input.fro.source ?? "unknown";

  const insertStock = database.prepare(`
    INSERT INTO stock_snapshots
      (ts, symbol, price, bid, ask, open, high, low, prev_close, volume, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertStock.run(
    ts,
    symbol,
    input.fro.price,
    input.fro.bid,
    input.fro.ask,
    input.fro.open,
    input.fro.high,
    input.fro.low,
    input.fro.previousClose,
    input.fro.volume,
    input.fro.source,
  );

  const insertMacro = database.prepare(`
    INSERT INTO macro_snapshots
      (ts, wti, brent_fut, brent_spot, td3c_ws, td3c_tce, spot_minus_fut)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertMacro.run(
    ts,
    input.energy.wti.price,
    input.energy.brent.price,
    input.physical.brent.eiaEuropeBrentSpot.price,
    input.physical.vlccTd3c.worldscale,
    input.physical.vlccTd3c.tceUsdPerDay,
    input.physical.brent.spotMinusFutures,
  );

  const insertOpt = database.prepare(`
    INSERT INTO option_snapshots
      (ts, symbol, expiry, strike, type, bid, ask, last, volume, open_interest, iv, spot, dte, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let optionRows = 0;
  const expiries = pickExpiries(
    input.options.expirationDates,
    input.options.selectedExpiry,
  );

  for (const expiry of expiries) {
    let chain = input.options;
    if (expiry !== input.options.selectedExpiry) {
      try {
        chain = await getOptionsChain(symbol, expiry);
      } catch (err) {
        console.warn(`[tradehole] history chain ${symbol} ${expiry}:`, err);
        continue;
      }
    }
    const dte = daysToExpiry(expiry, now);
    const contracts = [...chain.calls, ...chain.puts].filter((c) => inBand(c.strike));
    for (const c of contracts) {
      insertOpt.run(
        ts,
        symbol,
        expiry,
        c.strike,
        c.type,
        c.bid,
        c.ask,
        c.lastPrice,
        c.volume,
        c.openInterest,
        c.impliedVolatility,
        spot ?? chain.underlyingPrice,
        dte,
        chain.source ?? source,
      );
      optionRows += 1;
    }
  }

  markWrite(nowMs, gate.reason);
  if (gate.eod) setEodDayWritten(calendarDay(now));

  let alerts = 0;
  try {
    alerts = detectAnomalies(symbol, ts);
  } catch (err) {
    console.warn("[tradehole] anomaly detect failed:", err);
  }

  try {
    pruneHistory(now);
  } catch (err) {
    console.warn("[tradehole] history prune failed:", err);
  }

  return { wrote: true, reason: gate.reason, optionRows, alerts };
}
