/**
 * Manual Israel-strike postures (NAV-01 Cyprus, etc.)
 * Persisted under Application Support — same pattern as externalPositions.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type Nav01Posture =
  | "not_set"
  | "loitering_cyprus"
  | "quiet"
  | "ais_dark_suspected";

export type IsraelStrikeManualState = {
  version: 1;
  nav01: {
    posture: Nav01Posture;
    note: string;
    /** Manual navy-like count in Cyprus box (from MT/VF eyeball). */
    navyCount: number | null;
    /** Lights NAV-01 when navyCount >= this (default 1). */
    navyThreshold: number;
    updatedAt: string | null;
  };
};

const STORE_VERSION = 1 as const;

function dataDir(): string {
  if (process.env.TRADEHOLE_DATA_DIR) return process.env.TRADEHOLE_DATA_DIR;
  return path.join(os.homedir(), "Library", "Application Support", "Tradehole");
}

function storePath(): string {
  return path.join(dataDir(), "israel-strike-manual.json");
}

function ensureDir(): void {
  fs.mkdirSync(dataDir(), { recursive: true });
}

const DEFAULT_NAVY_THRESHOLD = 1;

function emptyState(): IsraelStrikeManualState {
  return {
    version: STORE_VERSION,
    nav01: {
      posture: "not_set",
      note: "",
      navyCount: null,
      navyThreshold: DEFAULT_NAVY_THRESHOLD,
      updatedAt: null,
    },
  };
}

function parseNavyCount(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(99, Math.floor(n));
}

function parseNavyThreshold(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_NAVY_THRESHOLD;
  return Math.min(20, Math.floor(n));
}

function isNav01Posture(v: unknown): v is Nav01Posture {
  return (
    v === "not_set" ||
    v === "loitering_cyprus" ||
    v === "quiet" ||
    v === "ais_dark_suspected"
  );
}

const AIS_DARK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function getIsraelStrikeManual(): IsraelStrikeManualState {
  try {
    const p = storePath();
    if (!fs.existsSync(p)) return emptyState();
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<IsraelStrikeManualState>;
    let posture = isNav01Posture(raw.nav01?.posture)
      ? raw.nav01.posture
      : "not_set";
    const updatedAt =
      typeof raw.nav01?.updatedAt === "string" ? raw.nav01.updatedAt : null;
    const updatedMs = Date.parse(updatedAt ?? "");
    const aisDarkStale =
      posture === "ais_dark_suspected" &&
      Number.isFinite(updatedMs) &&
      Date.now() - updatedMs > AIS_DARK_MAX_AGE_MS;
    if (aisDarkStale) {
      posture = "not_set";
    }
    const state: IsraelStrikeManualState = {
      version: STORE_VERSION,
      nav01: {
        posture,
        note: typeof raw.nav01?.note === "string" ? raw.nav01.note : "",
        navyCount: parseNavyCount(
          (raw.nav01 as { navyCount?: unknown } | undefined)?.navyCount,
        ),
        navyThreshold: parseNavyThreshold(
          (raw.nav01 as { navyThreshold?: unknown } | undefined)?.navyThreshold,
        ),
        updatedAt: aisDarkStale ? null : updatedAt,
      },
    };
    if (aisDarkStale) {
      try {
        ensureDir();
        fs.writeFileSync(p, JSON.stringify(state, null, 2), "utf8");
      } catch (err) {
        console.warn("[tradehole] israel-strike-manual stale clear failed:", err);
      }
    }
    return state;
  } catch (err) {
    console.warn("[tradehole] israel-strike-manual read failed:", err);
    return emptyState();
  }
}

export function setIsraelStrikeManual(patch: {
  nav01?: {
    posture?: Nav01Posture;
    note?: string;
    navyCount?: number | null;
    navyThreshold?: number;
  };
}): IsraelStrikeManualState {
  const cur = getIsraelStrikeManual();
  const next: IsraelStrikeManualState = {
    version: STORE_VERSION,
    nav01: { ...cur.nav01 },
  };
  if (patch.nav01) {
    if (patch.nav01.posture != null && isNav01Posture(patch.nav01.posture)) {
      next.nav01.posture = patch.nav01.posture;
    }
    if (typeof patch.nav01.note === "string") {
      next.nav01.note = patch.nav01.note.slice(0, 500);
    }
    if ("navyCount" in patch.nav01) {
      next.nav01.navyCount = parseNavyCount(patch.nav01.navyCount);
    }
    if (patch.nav01.navyThreshold != null) {
      next.nav01.navyThreshold = parseNavyThreshold(patch.nav01.navyThreshold);
    }
    next.nav01.updatedAt = new Date().toISOString();
  }
  ensureDir();
  fs.writeFileSync(storePath(), JSON.stringify(next, null, 2));
  return next;
}
