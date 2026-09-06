import { isNoiseFlowEvent } from "./anomalies";
import { getHistoryDb, getHistoryStatus, type HistoryStatus } from "./db";

export type SeriesPoint = {
  ts: string;
  spot: number | null;
  bid: number | null;
  ask: number | null;
  last: number | null;
  volume: number | null;
  openInterest: number | null;
  iv: number | null;
};

export type StockSeriesPoint = {
  ts: string;
  price: number | null;
  volume: number | null;
  high: number | null;
  low: number | null;
};

export type FlowEvent = {
  id: number;
  ts: string;
  kind: string;
  symbol: string;
  expiry: string | null;
  strike: number | null;
  type: string | null;
  severity: string;
  message: string;
  metrics: Record<string, unknown> | null;
};

export type HeatmapCell = {
  strike: number;
  type: "call" | "put";
  volume: number | null;
  openInterest: number | null;
  iv: number | null;
  bid: number | null;
  ask: number | null;
  last: number | null;
};

export function historyStatus(): HistoryStatus {
  return getHistoryStatus();
}

export function queryOptionSeries(opts: {
  symbol: string;
  expiry: string;
  strike: number;
  type: "call" | "put";
  from?: string;
  limit?: number;
}): SeriesPoint[] {
  const database = getHistoryDb();
  if (!database) return [];
  const from =
    opts.from ??
    new Date(Date.now() - 30 * 86_400_000).toISOString();
  const limit = Math.min(2000, Math.max(10, opts.limit ?? 500));
  const rows = database
    .prepare(
      `SELECT ts, spot, bid, ask, last, volume, open_interest, iv
       FROM option_snapshots
       WHERE symbol = ? AND expiry = ? AND strike = ? AND type = ? AND ts >= ?
       ORDER BY ts ASC
       LIMIT ?`,
    )
    .all(
      opts.symbol.toUpperCase(),
      opts.expiry,
      opts.strike,
      opts.type,
      from,
      limit,
    ) as Array<{
    ts: string;
    spot: number | null;
    bid: number | null;
    ask: number | null;
    last: number | null;
    volume: number | null;
    open_interest: number | null;
    iv: number | null;
  }>;

  return rows.map((r) => ({
    ts: r.ts,
    spot: r.spot,
    bid: r.bid,
    ask: r.ask,
    last: r.last,
    volume: r.volume,
    openInterest: r.open_interest,
    iv: r.iv,
  }));
}

export function queryStockSeries(opts: {
  symbol: string;
  from?: string;
  limit?: number;
}): StockSeriesPoint[] {
  const database = getHistoryDb();
  if (!database) return [];
  const from =
    opts.from ??
    new Date(Date.now() - 30 * 86_400_000).toISOString();
  const limit = Math.min(2000, Math.max(10, opts.limit ?? 500));
  const rows = database
    .prepare(
      `SELECT ts, price, volume, high, low
       FROM stock_snapshots
       WHERE symbol = ? AND ts >= ?
       ORDER BY ts ASC
       LIMIT ?`,
    )
    .all(opts.symbol.toUpperCase(), from, limit) as Array<{
    ts: string;
    price: number | null;
    volume: number | null;
    high: number | null;
    low: number | null;
  }>;
  return rows;
}

export function queryFlowEvents(opts: {
  symbol: string;
  days?: number;
  limit?: number;
  /** Include cold-start OI / floor-IV junk. Default false for digests & AI packs. */
  includeNoise?: boolean;
}): FlowEvent[] {
  const database = getHistoryDb();
  if (!database) return [];
  const days = Math.min(90, Math.max(1, opts.days ?? 7));
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  // Over-fetch then filter noise so LIMIT still returns useful rows.
  const fetchLimit = opts.includeNoise ? limit : Math.min(500, limit * 3);
  const rows = database
    .prepare(
      `SELECT id, ts, kind, symbol, expiry, strike, type, severity, message, metrics_json
       FROM flow_events
       WHERE symbol = ? AND ts >= ?
       ORDER BY ts DESC
       LIMIT ?`,
    )
    .all(opts.symbol.toUpperCase(), from, fetchLimit) as Array<{
    id: number;
    ts: string;
    kind: string;
    symbol: string;
    expiry: string | null;
    strike: number | null;
    type: string | null;
    severity: string;
    message: string;
    metrics_json: string | null;
  }>;

  const mapped = rows.map((r) => {
    let metrics: Record<string, unknown> | null = null;
    if (r.metrics_json) {
      try {
        metrics = JSON.parse(r.metrics_json) as Record<string, unknown>;
      } catch {
        metrics = null;
      }
    }
    return {
      id: r.id,
      ts: r.ts,
      kind: r.kind,
      symbol: r.symbol,
      expiry: r.expiry,
      strike: r.strike,
      type: r.type,
      severity: r.severity,
      message: r.message,
      metrics,
    };
  });

  if (opts.includeNoise) return mapped.slice(0, limit);
  return mapped.filter((e) => !isNoiseFlowEvent(e)).slice(0, limit);
}

/** Alerts since `since` (ISO) — used by FlowAlarm polling. */
export function queryAlertsSince(opts: {
  symbol: string;
  since?: string;
  limit?: number;
}): FlowEvent[] {
  const database = getHistoryDb();
  if (!database) return [];
  const since =
    opts.since ?? new Date(Date.now() - 24 * 3_600_000).toISOString();
  const limit = Math.min(50, Math.max(1, opts.limit ?? 20));
  const rows = database
    .prepare(
      `SELECT id, ts, kind, symbol, expiry, strike, type, severity, message, metrics_json
       FROM flow_events
       WHERE symbol = ? AND ts >= ? AND severity IN ('warn','critical')
       ORDER BY ts DESC
       LIMIT ?`,
    )
    .all(opts.symbol.toUpperCase(), since, Math.min(50, limit * 3)) as Array<{
    id: number;
    ts: string;
    kind: string;
    symbol: string;
    expiry: string | null;
    strike: number | null;
    type: string | null;
    severity: string;
    message: string;
    metrics_json: string | null;
  }>;

  return rows
    .map((r) => {
      let metrics: Record<string, unknown> | null = null;
      if (r.metrics_json) {
        try {
          metrics = JSON.parse(r.metrics_json) as Record<string, unknown>;
        } catch {
          metrics = null;
        }
      }
      return {
        id: r.id,
        ts: r.ts,
        kind: r.kind,
        symbol: r.symbol,
        expiry: r.expiry,
        strike: r.strike,
        type: r.type,
        severity: r.severity,
        message: r.message,
        metrics,
      };
    })
    .filter((e) => !isNoiseFlowEvent(e))
    .slice(0, limit);
}

export function queryHeatmap(opts: {
  symbol: string;
  expiry: string;
}): { ts: string | null; cells: HeatmapCell[] } {
  const database = getHistoryDb();
  if (!database) return { ts: null, cells: [] };
  const latest = database
    .prepare(
      `SELECT MAX(ts) AS ts FROM option_snapshots WHERE symbol = ? AND expiry = ?`,
    )
    .get(opts.symbol.toUpperCase(), opts.expiry) as { ts: string | null };
  if (!latest?.ts) return { ts: null, cells: [] };

  const rows = database
    .prepare(
      `SELECT strike, type, volume, open_interest, iv, bid, ask, last
       FROM option_snapshots
       WHERE symbol = ? AND expiry = ? AND ts = ?
       ORDER BY type, strike`,
    )
    .all(opts.symbol.toUpperCase(), opts.expiry, latest.ts) as Array<{
    strike: number;
    type: string;
    volume: number | null;
    open_interest: number | null;
    iv: number | null;
    bid: number | null;
    ask: number | null;
    last: number | null;
  }>;

  return {
    ts: latest.ts,
    cells: rows.map((r) => ({
      strike: r.strike,
      type: r.type === "put" ? "put" : "call",
      volume: r.volume,
      openInterest: r.open_interest,
      iv: r.iv,
      bid: r.bid,
      ask: r.ask,
      last: r.last,
    })),
  };
}

export function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function optionBandCsv(opts: {
  symbol: string;
  days?: number;
}): string {
  const database = getHistoryDb();
  if (!database) return "ts,symbol,expiry,strike,type,bid,ask,last,volume,open_interest,iv,spot,dte,source\n";
  const days = Math.min(60, Math.max(1, opts.days ?? 7));
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = database
    .prepare(
      `SELECT ts, symbol, expiry, strike, type, bid, ask, last, volume, open_interest, iv, spot, dte, source
       FROM option_snapshots
       WHERE symbol = ? AND ts >= ?
       ORDER BY ts ASC, expiry, type, strike
       LIMIT 50000`,
    )
    .all(opts.symbol.toUpperCase(), from) as Array<Record<string, unknown>>;

  const header =
    "ts,symbol,expiry,strike,type,bid,ask,last,volume,open_interest,iv,spot,dte,source";
  const lines = rows.map((r) =>
    [
      r.ts,
      r.symbol,
      r.expiry,
      r.strike,
      r.type,
      r.bid,
      r.ask,
      r.last,
      r.volume,
      r.open_interest,
      r.iv,
      r.spot,
      r.dte,
      r.source,
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header, ...lines].join("\n");
}

export function stockCsv(opts: { symbol: string; days?: number }): string {
  const database = getHistoryDb();
  if (!database) {
    return "ts,symbol,price,bid,ask,open,high,low,prev_close,volume,source\n";
  }
  const days = Math.min(120, Math.max(1, opts.days ?? 30));
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = database
    .prepare(
      `SELECT ts, symbol, price, bid, ask, open, high, low, prev_close, volume, source
       FROM stock_snapshots WHERE symbol = ? AND ts >= ? ORDER BY ts ASC LIMIT 20000`,
    )
    .all(opts.symbol.toUpperCase(), from) as Array<Record<string, unknown>>;
  const header =
    "ts,symbol,price,bid,ask,open,high,low,prev_close,volume,source";
  const lines = rows.map((r) =>
    [
      r.ts,
      r.symbol,
      r.price,
      r.bid,
      r.ask,
      r.open,
      r.high,
      r.low,
      r.prev_close,
      r.volume,
      r.source,
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header, ...lines].join("\n");
}

export function focusContractCsv(opts: {
  symbol: string;
  expiry: string;
  strike: number;
  type: "call" | "put";
  days?: number;
}): string {
  const database = getHistoryDb();
  const header = "ts,spot,bid,ask,last,volume,open_interest,iv";
  if (!database) return `${header}\n`;
  const days = Math.min(120, Math.max(1, opts.days ?? 30));
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = database
    .prepare(
      `SELECT ts, spot, bid, ask, last, volume, open_interest, iv
       FROM option_snapshots
       WHERE symbol = ? AND expiry = ? AND strike = ? AND type = ? AND ts >= ?
       ORDER BY ts ASC LIMIT 10000`,
    )
    .all(
      opts.symbol.toUpperCase(),
      opts.expiry,
      opts.strike,
      opts.type,
      from,
    ) as Array<Record<string, unknown>>;
  const lines = rows.map((r) =>
    [r.ts, r.spot, r.bid, r.ask, r.last, r.volume, r.open_interest, r.iv]
      .map(csvEscape)
      .join(","),
  );
  return [header, ...lines].join("\n");
}
