import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Dense track/zone retention. */
export const SAMPLE_RETENTION_DAYS = 90;
/** Peak / rollup retention. */
export const PEAK_RETENTION_DAYS = 365;

/** Canonical OSINT theater ≈ Israel–Iran–Horn/Somalia + ~300 nm margin. */
export const OSINT_THEATER_BBOX = {
  latMin: -5,
  latMax: 45,
  lonMin: 10,
  lonMax: 80,
} as const;

export type OsintArchiveStatus = {
  enabled: boolean;
  dbPath: string | null;
  error: string | null;
  assetRows: number;
  zoneRows: number;
  peakRows: number;
  oldestSampleAt: string | null;
  newestSampleAt: string | null;
  newestPeakAt: string | null;
  lastWriteAt: string | null;
  lastWriteReason: string | null;
  dbBytes: number | null;
  sampleRetentionDays: number;
  peakRetentionDays: number;
};

let db: DatabaseSync | null = null;
let initError: string | null = null;
let lastWriteAtMs = 0;
let lastWriteReason: string | null = null;
let lastPruneAtMs = 0;

export function osintArchiveDataDir(): string {
  if (process.env.TRADEHOLE_DATA_DIR) return process.env.TRADEHOLE_DATA_DIR;
  return path.join(os.homedir(), "Library", "Application Support", "Tradehole");
}

export function osintArchiveDbPath(): string {
  return path.join(osintArchiveDataDir(), "osint-theater.db");
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function getOsintArchiveDb(): DatabaseSync | null {
  if (db) return db;
  if (initError) return null;
  try {
    ensureDir(osintArchiveDataDir());
    const database = new DatabaseSync(osintArchiveDbPath());
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS asset_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        asset_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        alt_ft REAL,
        gs_kt REAL,
        track_deg REAL,
        label TEXT,
        source TEXT,
        region TEXT,
        stale INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_asset_ts ON asset_samples(ts);
      CREATE INDEX IF NOT EXISTS idx_asset_key_ts ON asset_samples(asset_key, ts);
      CREATE INDEX IF NOT EXISTS idx_asset_kind_ts ON asset_samples(kind, ts);

      CREATE TABLE IF NOT EXISTS zone_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        zone_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        label TEXT,
        status TEXT NOT NULL,
        lat_min REAL NOT NULL,
        lat_max REAL NOT NULL,
        lon_min REAL NOT NULL,
        lon_max REAL NOT NULL,
        payload_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_zone_ts ON zone_samples(ts);
      CREATE INDEX IF NOT EXISTS idx_zone_id_ts ON zone_samples(zone_id, ts);

      CREATE TABLE IF NOT EXISTS aerial_peaks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        tankers INTEGER NOT NULL,
        awacs INTEGER NOT NULL,
        other_mil INTEGER NOT NULL,
        feed_status TEXT,
        source TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_peaks_ts ON aerial_peaks(ts);

      CREATE TABLE IF NOT EXISTS archive_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    db = database;
    return db;
  } catch (err) {
    initError = String(err);
    console.warn("[tradehole] osint archive DB disabled:", initError);
    return null;
  }
}

export function isOsintArchiveEnabled(): boolean {
  return getOsintArchiveDb() != null;
}

export function markArchiveWrite(tsMs: number, reason: string): void {
  lastWriteAtMs = tsMs;
  lastWriteReason = reason;
  const database = getOsintArchiveDb();
  if (!database) return;
  try {
    database
      .prepare(
        `INSERT INTO archive_meta(key, value) VALUES(?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run("last_write_at", new Date(tsMs).toISOString());
    database
      .prepare(
        `INSERT INTO archive_meta(key, value) VALUES(?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run("last_write_reason", reason);
  } catch {
    /* ignore meta failures */
  }
}

export function inOsintTheater(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= OSINT_THEATER_BBOX.latMin &&
    lat <= OSINT_THEATER_BBOX.latMax &&
    lon >= OSINT_THEATER_BBOX.lonMin &&
    lon <= OSINT_THEATER_BBOX.lonMax
  );
}

function countTable(database: DatabaseSync, table: string): number {
  try {
    const row = database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
      n: number;
    };
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}

function minMaxTs(
  database: DatabaseSync,
  table: string,
): { oldest: string | null; newest: string | null } {
  try {
    const row = database
      .prepare(`SELECT MIN(ts) AS oldest, MAX(ts) AS newest FROM ${table}`)
      .get() as { oldest?: string | null; newest?: string | null };
    return {
      oldest: row?.oldest ?? null,
      newest: row?.newest ?? null,
    };
  } catch {
    return { oldest: null, newest: null };
  }
}

export function getOsintArchiveStatus(): OsintArchiveStatus {
  const database = getOsintArchiveDb();
  const assetRange = database
    ? minMaxTs(database, "asset_samples")
    : { oldest: null, newest: null };
  const peakRange = database
    ? minMaxTs(database, "aerial_peaks")
    : { oldest: null, newest: null };

  let dbBytes: number | null = null;
  try {
    const p = osintArchiveDbPath();
    if (fs.existsSync(p)) dbBytes = fs.statSync(p).size;
  } catch {
    dbBytes = null;
  }

  let metaWrite: string | null =
    lastWriteAtMs > 0 ? new Date(lastWriteAtMs).toISOString() : null;
  if (!metaWrite && database) {
    try {
      const row = database
        .prepare(`SELECT value FROM archive_meta WHERE key = 'last_write_at'`)
        .get() as { value?: string } | undefined;
      metaWrite = row?.value ?? null;
    } catch {
      /* ignore */
    }
  }

  return {
    enabled: database != null,
    dbPath: database ? osintArchiveDbPath() : null,
    error: initError,
    assetRows: database ? countTable(database, "asset_samples") : 0,
    zoneRows: database ? countTable(database, "zone_samples") : 0,
    peakRows: database ? countTable(database, "aerial_peaks") : 0,
    oldestSampleAt: assetRange.oldest,
    newestSampleAt: assetRange.newest,
    newestPeakAt: peakRange.newest,
    lastWriteAt: metaWrite,
    lastWriteReason,
    dbBytes,
    sampleRetentionDays: SAMPLE_RETENTION_DAYS,
    peakRetentionDays: PEAK_RETENTION_DAYS,
  };
}

/** Prune dense samples (90d) and peaks (365d). Throttled to ~1h. */
export function pruneOsintArchive(now = new Date(), force = false): void {
  const database = getOsintArchiveDb();
  if (!database) return;
  const nowMs = now.getTime();
  if (!force && lastPruneAtMs > 0 && nowMs - lastPruneAtMs < 3_600_000) return;
  lastPruneAtMs = nowMs;

  const sampleCut = new Date(
    nowMs - SAMPLE_RETENTION_DAYS * 86_400_000,
  ).toISOString();
  const peakCut = new Date(
    nowMs - PEAK_RETENTION_DAYS * 86_400_000,
  ).toISOString();
  try {
    database.prepare(`DELETE FROM asset_samples WHERE ts < ?`).run(sampleCut);
    database.prepare(`DELETE FROM zone_samples WHERE ts < ?`).run(sampleCut);
    database.prepare(`DELETE FROM aerial_peaks WHERE ts < ?`).run(peakCut);
    database
      .prepare(
        `INSERT INTO archive_meta(key, value) VALUES(?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run("last_prune_at", now.toISOString());
  } catch (err) {
    console.warn("[tradehole] osint archive prune failed:", err);
  }
}
