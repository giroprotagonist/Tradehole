import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const STRIKE_MIN = 30;
export const STRIKE_MAX = 55;
export const WRITE_INTERVAL_MS = 5 * 60_000;
export const RETENTION_DAYS = 120;
export const FLOW_RETENTION_DAYS = 365;

export type HistoryStatus = {
  enabled: boolean;
  dbPath: string | null;
  error: string | null;
  stockRows: number;
  optionRows: number;
  macroRows: number;
  flowRows: number;
  lastWriteAt: string | null;
  nextWriteAt: string | null;
  lastWriteReason: string | null;
};

let db: DatabaseSync | null = null;
let initError: string | null = null;
let lastWriteAtMs = 0;
let lastWriteReason: string | null = null;
let eodDayWritten: string | null = null;

export function historyDataDir(): string {
  if (process.env.TRADEHOLE_DATA_DIR) return process.env.TRADEHOLE_DATA_DIR;
  return path.join(os.homedir(), "Library", "Application Support", "Tradehole");
}

export function historyDbPath(): string {
  return path.join(historyDataDir(), "tradehole-history.db");
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function getHistoryDb(): DatabaseSync | null {
  if (db) return db;
  if (initError) return null;
  try {
    ensureDir(historyDataDir());
    const database = new DatabaseSync(historyDbPath());
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS stock_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        symbol TEXT NOT NULL,
        price REAL,
        bid REAL,
        ask REAL,
        open REAL,
        high REAL,
        low REAL,
        prev_close REAL,
        volume REAL,
        source TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_stock_symbol_ts ON stock_snapshots(symbol, ts);

      CREATE TABLE IF NOT EXISTS option_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        symbol TEXT NOT NULL,
        expiry TEXT NOT NULL,
        strike REAL NOT NULL,
        type TEXT NOT NULL,
        bid REAL,
        ask REAL,
        last REAL,
        volume REAL,
        open_interest REAL,
        iv REAL,
        spot REAL,
        dte INTEGER,
        source TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_opt_contract_ts
        ON option_snapshots(symbol, expiry, strike, type, ts);
      CREATE INDEX IF NOT EXISTS idx_opt_symbol_ts ON option_snapshots(symbol, ts);

      CREATE TABLE IF NOT EXISTS macro_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        wti REAL,
        brent_fut REAL,
        brent_spot REAL,
        td3c_ws REAL,
        td3c_tce REAL,
        spot_minus_fut REAL
      );
      CREATE INDEX IF NOT EXISTS idx_macro_ts ON macro_snapshots(ts);

      CREATE TABLE IF NOT EXISTS flow_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        kind TEXT NOT NULL,
        symbol TEXT NOT NULL,
        expiry TEXT,
        strike REAL,
        type TEXT,
        severity TEXT NOT NULL,
        message TEXT NOT NULL,
        metrics_json TEXT,
        dedupe_key TEXT NOT NULL UNIQUE
      );
      CREATE INDEX IF NOT EXISTS idx_flow_symbol_ts ON flow_events(symbol, ts);

      CREATE TABLE IF NOT EXISTS intel_daily_snapshots (
        day TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        footprint_score REAL,
        footprint_band TEXT,
        surprise_json TEXT,
        pack_score REAL,
        pack_band TEXT,
        payload_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_intel_daily_ts ON intel_daily_snapshots(ts);

      CREATE TABLE IF NOT EXISTS trade_proposals (
        id TEXT PRIMARY KEY,
        as_of TEXT NOT NULL,
        book TEXT NOT NULL,
        action TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_trade_proposals_status
        ON trade_proposals(status, created_at);

      CREATE TABLE IF NOT EXISTS trade_journal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        proposal_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        note TEXT,
        order_id TEXT,
        fill_price REAL,
        pnl REAL,
        action TEXT,
        quantity INTEGER,
        payload_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_trade_journal_ts ON trade_journal(ts);
      CREATE INDEX IF NOT EXISTS idx_trade_journal_proposal
        ON trade_journal(proposal_id);
    `);
    // Ensure new tables exist on older DBs opened before this schema.
    database.exec(`
      CREATE TABLE IF NOT EXISTS intel_daily_snapshots (
        day TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        footprint_score REAL,
        footprint_band TEXT,
        surprise_json TEXT,
        pack_score REAL,
        pack_band TEXT,
        payload_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_intel_daily_ts ON intel_daily_snapshots(ts);

      CREATE TABLE IF NOT EXISTS trade_proposals (
        id TEXT PRIMARY KEY,
        as_of TEXT NOT NULL,
        book TEXT NOT NULL,
        action TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_trade_proposals_status
        ON trade_proposals(status, created_at);

      CREATE TABLE IF NOT EXISTS trade_journal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        proposal_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        note TEXT,
        order_id TEXT,
        fill_price REAL,
        pnl REAL,
        action TEXT,
        quantity INTEGER,
        payload_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_trade_journal_ts ON trade_journal(ts);
      CREATE INDEX IF NOT EXISTS idx_trade_journal_proposal
        ON trade_journal(proposal_id);
    `);
    db = database;
    return db;
  } catch (err) {
    initError = String(err);
    console.warn("[tradehole] history DB disabled:", initError);
    return null;
  }
}

export function isHistoryEnabled(): boolean {
  return getHistoryDb() != null;
}

export function getLastWriteAtMs(): number {
  return lastWriteAtMs;
}

export function markWrite(tsMs: number, reason: string): void {
  lastWriteAtMs = tsMs;
  lastWriteReason = reason;
}

export function getEodDayWritten(): string | null {
  return eodDayWritten;
}

export function setEodDayWritten(day: string): void {
  eodDayWritten = day;
}

export function getHistoryStatus(): HistoryStatus {
  const database = getHistoryDb();
  const count = (table: string): number => {
    if (!database) return 0;
    try {
      const row = database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
        n: number;
      };
      return Number(row?.n ?? 0);
    } catch {
      return 0;
    }
  };

  const last =
    lastWriteAtMs > 0
      ? new Date(lastWriteAtMs).toISOString()
      : (() => {
          if (!database) return null;
          try {
            const row = database
              .prepare(`SELECT ts FROM stock_snapshots ORDER BY ts DESC LIMIT 1`)
              .get() as { ts?: string } | undefined;
            return row?.ts ?? null;
          } catch {
            return null;
          }
        })();

  const next =
    lastWriteAtMs > 0
      ? new Date(lastWriteAtMs + WRITE_INTERVAL_MS).toISOString()
      : null;

  return {
    enabled: database != null,
    dbPath: database ? historyDbPath() : null,
    error: initError,
    stockRows: count("stock_snapshots"),
    optionRows: count("option_snapshots"),
    macroRows: count("macro_snapshots"),
    flowRows: count("flow_events"),
    lastWriteAt: last,
    nextWriteAt: next,
    lastWriteReason,
  };
}

export function pruneHistory(now = new Date()): void {
  const database = getHistoryDb();
  if (!database) return;
  const stockCut = new Date(now.getTime() - RETENTION_DAYS * 86_400_000).toISOString();
  const flowCut = new Date(
    now.getTime() - FLOW_RETENTION_DAYS * 86_400_000,
  ).toISOString();
  database.prepare(`DELETE FROM stock_snapshots WHERE ts < ?`).run(stockCut);
  database.prepare(`DELETE FROM option_snapshots WHERE ts < ?`).run(stockCut);
  database.prepare(`DELETE FROM macro_snapshots WHERE ts < ?`).run(stockCut);
  database.prepare(`DELETE FROM flow_events WHERE ts < ?`).run(flowCut);
}

export function daysToExpiry(expiry: string, from = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiry);
  if (!m) return null;
  const exp = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  return Math.round((exp - start) / 86_400_000);
}
