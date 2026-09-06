/**
 * Layer-6 lite: one intel state row per calendar day for later analogs.
 */
import { getHistoryDb } from "./history/db";

export type IntelDailySnapshotInput = {
  footprintScore: number | null;
  footprintBand: string | null;
  surpriseEdges: Array<{ id: string; edgePp: number | null }>;
  packScore: number | null;
  packBand: string | null;
  payload?: Record<string, unknown>;
};

export type IntelDailyRow = {
  day: string;
  ts: string;
  footprintScore: number | null;
  footprintBand: string | null;
  surpriseEdges: Array<{ id: string; edgePp: number | null }>;
  packScore: number | null;
  packBand: string | null;
  payload: Record<string, unknown>;
};

export function recordIntelDailySnapshot(
  input: IntelDailySnapshotInput,
  now = new Date(),
): boolean {
  const database = getHistoryDb();
  if (!database) return false;
  const day = now.toISOString().slice(0, 10);
  const ts = now.toISOString();
  try {
    database
      .prepare(
        `INSERT INTO intel_daily_snapshots
          (day, ts, footprint_score, footprint_band, surprise_json, pack_score, pack_band, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(day) DO UPDATE SET
           ts = excluded.ts,
           footprint_score = excluded.footprint_score,
           footprint_band = excluded.footprint_band,
           surprise_json = excluded.surprise_json,
           pack_score = excluded.pack_score,
           pack_band = excluded.pack_band,
           payload_json = excluded.payload_json`,
      )
      .run(
        day,
        ts,
        input.footprintScore,
        input.footprintBand,
        JSON.stringify(input.surpriseEdges),
        input.packScore,
        input.packBand,
        JSON.stringify(input.payload ?? {}),
      );
    return true;
  } catch (err) {
    console.warn("[tradehole] intel_daily_snapshots write failed:", err);
    return false;
  }
}

/** Most recent snapshot strictly before today (UTC). */
export function getPriorIntelDailySnapshot(
  now = new Date(),
): IntelDailyRow | null {
  const database = getHistoryDb();
  if (!database) return null;
  const today = now.toISOString().slice(0, 10);
  try {
    const row = database
      .prepare(
        `SELECT day, ts, footprint_score, footprint_band, surprise_json, pack_score, pack_band, payload_json
         FROM intel_daily_snapshots
         WHERE day < ?
         ORDER BY day DESC
         LIMIT 1`,
      )
      .get(today) as
      | {
          day: string;
          ts: string;
          footprint_score: number | null;
          footprint_band: string | null;
          surprise_json: string | null;
          pack_score: number | null;
          pack_band: string | null;
          payload_json: string | null;
        }
      | undefined;
    if (!row) return null;
    let surpriseEdges: IntelDailyRow["surpriseEdges"] = [];
    try {
      surpriseEdges = JSON.parse(row.surprise_json || "[]");
    } catch {
      /* ignore */
    }
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(row.payload_json || "{}");
    } catch {
      /* ignore */
    }
    return {
      day: row.day,
      ts: row.ts,
      footprintScore: row.footprint_score,
      footprintBand: row.footprint_band,
      surpriseEdges,
      packScore: row.pack_score,
      packBand: row.pack_band,
      payload,
    };
  } catch (err) {
    console.warn("[tradehole] getPriorIntelDailySnapshot failed:", err);
    return null;
  }
}
