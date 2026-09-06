/**
 * Disk last-good for heavy panels. In-memory snaps die on install/relaunch,
 * so first paint used to wait on a full theater rebuild until the client abort.
 * JSON under Application Support/Tradehole/last-good/.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LastGoodSnap } from "./lastGoodServe";

function dataDir(): string {
  if (process.env.TRADEHOLE_DATA_DIR) return process.env.TRADEHOLE_DATA_DIR;
  return path.join(os.homedir(), "Library", "Application Support", "Tradehole");
}

export function lastGoodStoreDir(): string {
  return path.join(dataDir(), "last-good");
}

export function lastGoodFile(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return path.join(lastGoodStoreDir(), `${safe}.json`);
}

export function readLastGood<T>(key: string): LastGoodSnap<T> | null {
  try {
    const raw = fs.readFileSync(lastGoodFile(key), "utf8");
    const json = JSON.parse(raw) as { at?: number; value?: T };
    if (json == null || typeof json.at !== "number" || json.value == null) {
      return null;
    }
    return { value: json.value, at: json.at };
  } catch {
    return null;
  }
}

export function writeLastGood<T>(key: string, value: T, at = Date.now()): void {
  try {
    fs.mkdirSync(lastGoodStoreDir(), { recursive: true });
    const dest = lastGoodFile(key);
    const tmp = `${dest}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ at, value }));
    fs.renameSync(tmp, dest);
  } catch (err) {
    console.warn(`[tradehole] last-good persist ${key} failed:`, err);
  }
}

export function clearLastGood(key: string): void {
  try {
    fs.unlinkSync(lastGoodFile(key));
  } catch {
    /* missing is fine */
  }
}
