/**
 * Manual / auto kinetic stamps — time + named target + "confirmed by news".
 * Persisted so later empty RSS polls do not erase the story.
 * Separate from Israel High-go / AER-01.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findTargetById } from "./analytics/mideastTargets";

export type KineticStamp = {
  targetId: string;
  targetLabel: string;
  eventAt: string;
  confirmedByNews: true;
  headline: string;
  note: string;
  stampedAt: string;
  source: "manual" | "auto";
  link: string | null;
};

export type KineticStampStore = {
  version: 1;
  stamps: KineticStamp[];
};

const STORE_VERSION = 1 as const;
const MAX_STAMPS = 24;

function dataDir(): string {
  if (process.env.TRADEHOLE_DATA_DIR) return process.env.TRADEHOLE_DATA_DIR;
  return path.join(os.homedir(), "Library", "Application Support", "Tradehole");
}

function storePath(): string {
  return path.join(dataDir(), "kinetic-rewind-stamps.json");
}

function ensureDir(): void {
  fs.mkdirSync(dataDir(), { recursive: true });
}

function emptyStore(): KineticStampStore {
  return { version: STORE_VERSION, stamps: [] };
}

function parseIso(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function getKineticStamps(): KineticStampStore {
  try {
    const p = storePath();
    if (!fs.existsSync(p)) return emptyStore();
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<KineticStampStore>;
    const stamps: KineticStamp[] = [];
    for (const s of Array.isArray(raw.stamps) ? raw.stamps : []) {
      const targetId =
        typeof s?.targetId === "string" ? s.targetId.trim().toLowerCase() : "";
      const target = findTargetById(targetId);
      const eventAt = parseIso(s?.eventAt);
      const stampedAt = parseIso(s?.stampedAt) ?? new Date().toISOString();
      if (!target || !eventAt) continue;
      stamps.push({
        targetId: target.id,
        targetLabel: target.label,
        eventAt,
        confirmedByNews: true,
        headline: typeof s?.headline === "string" ? s.headline.slice(0, 400) : "",
        note: typeof s?.note === "string" ? s.note.slice(0, 500) : "",
        stampedAt,
        source: s?.source === "auto" ? "auto" : "manual",
        link: typeof s?.link === "string" && s.link.trim() ? s.link.trim() : null,
      });
    }
    stamps.sort((a, b) => Date.parse(b.stampedAt) - Date.parse(a.stampedAt));
    return { version: STORE_VERSION, stamps: stamps.slice(0, MAX_STAMPS) };
  } catch (err) {
    console.warn("[tradehole] kinetic-stamp read failed:", err);
    return emptyStore();
  }
}

function writeStore(store: KineticStampStore): KineticStampStore {
  ensureDir();
  const next: KineticStampStore = {
    version: STORE_VERSION,
    stamps: store.stamps.slice(0, MAX_STAMPS),
  };
  fs.writeFileSync(storePath(), JSON.stringify(next, null, 2));
  return next;
}

export function addKineticStamp(input: {
  targetId: string;
  eventAt: string;
  headline?: string;
  note?: string;
  source?: "manual" | "auto";
  link?: string | null;
}): KineticStampStore {
  const target = findTargetById(input.targetId);
  if (!target) throw new Error(`unknown target: ${input.targetId}`);
  const eventAt = parseIso(input.eventAt);
  if (!eventAt) throw new Error("eventAt must be a valid time");

  const stamp: KineticStamp = {
    targetId: target.id,
    targetLabel: target.label,
    eventAt,
    confirmedByNews: true,
    headline: (input.headline ?? "").slice(0, 400),
    note: (input.note ?? "confirmed by news").slice(0, 500),
    stampedAt: new Date().toISOString(),
    source: input.source === "auto" ? "auto" : "manual",
    link: input.link?.trim() ? input.link.trim() : null,
  };

  const cur = getKineticStamps();
  const rest = cur.stamps.filter((s) => {
    if (s.targetId !== stamp.targetId) return true;
    const sameEvent = Math.abs(Date.parse(s.eventAt) - Date.parse(stamp.eventAt)) < 30 * 60_000;
    const sameHead =
      s.headline.trim().toLowerCase() === stamp.headline.trim().toLowerCase();
    return !(sameEvent && (sameHead || !stamp.headline));
  });
  return writeStore({ version: STORE_VERSION, stamps: [stamp, ...rest] });
}

/** Persist auto-classified news only when it is a new event (does not clobber a newer manual). */
export function maybePersistAutoStamp(input: {
  targetId: string;
  eventAt: string;
  headline?: string;
  link?: string | null;
}): KineticStampStore {
  const target = findTargetById(input.targetId);
  if (!target) return getKineticStamps();
  const eventAt = parseIso(input.eventAt);
  if (!eventAt) return getKineticStamps();

  const cur = getKineticStamps();
  const existing = cur.stamps.find((s) => s.targetId === target.id);
  if (existing) {
    const existMs = Date.parse(existing.eventAt);
    const nextMs = Date.parse(eventAt);
    if (Number.isFinite(existMs) && Number.isFinite(nextMs) && nextMs <= existMs + 15 * 60_000) {
      return cur;
    }
    if (existing.source === "manual" && nextMs < existMs) return cur;
  }
  return addKineticStamp({
    targetId: target.id,
    eventAt,
    headline: input.headline,
    note: "confirmed by news",
    source: "auto",
    link: input.link ?? null,
  });
}
