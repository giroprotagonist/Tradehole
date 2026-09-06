import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getOptionsChain } from "./market";
import type { OptionContract } from "./market";

const MULTIPLIER = 100;
const STORE_VERSION = 2;

/** Synthetic account key for the Robinhood / external book (peer to E*TRADE). */
export const ROBINHOOD_ACCOUNT_ID_KEY = "robinhood";

export function isRobinhoodAccountKey(key?: string | null): boolean {
  const k = (key ?? "").trim().toLowerCase();
  return k === ROBINHOOD_ACCOUNT_ID_KEY || k === "external" || k === "rh";
}

export const ROBINHOOD_ACCOUNT = {
  accountIdKey: ROBINHOOD_ACCOUNT_ID_KEY,
  accountId: undefined as string | undefined,
  accountName: "Robinhood",
  accountDesc: "Robinhood",
  accountType: "EXTERNAL",
  accountMode: undefined as string | undefined,
  accountStatus: "ACTIVE",
};

export type ExternalCallPut = "call" | "put";

export type ExternalPosition = {
  id: string;
  broker: string;
  symbol: string;
  expiry: string;
  strike: number;
  callPut: ExternalCallPut;
  quantity: number;
  avgCost: number;
  boughtAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExternalPositionRow = {
  symbolDescription: string;
  symbol: string;
  quantity: number;
  pricePaid: number | null;
  marketValue: number | null;
  totalCost: number | null;
  totalGain: number | null;
  totalGainPct: number | null;
  daysGain: number | null;
  daysGainPct: number | null;
  typeCode: string | null;
  broker: string;
  brokerTag: string;
  externalId: string;
  mark: number | null;
  bid: number | null;
  ask: number | null;
  expiry: string;
  strike: number;
  callPut: ExternalCallPut;
};

type StoreFile = {
  version: number;
  seededDefaults: boolean;
  /** Full RH options book migration (Aug $50c/$45c + Sep $50c). */
  seededRhBookV2?: boolean;
  /** Corrected avg costs from RH total dollars paid. */
  seededRhBookV3?: boolean;
  /** Full RH FRO book from Aug 2026 screenshot (4 legs). */
  seededRhBookV4?: boolean;
  positions: ExternalPosition[];
};

export type ExternalPositionInput = {
  broker?: string;
  symbol: string;
  expiry: string;
  strike: number;
  callPut: ExternalCallPut;
  quantity: number;
  avgCost: number;
  boughtAt?: string | null;
  notes?: string | null;
};

function dataDir(): string {
  if (process.env.TRADEHOLE_DATA_DIR) return process.env.TRADEHOLE_DATA_DIR;
  return path.join(os.homedir(), "Library", "Application Support", "Tradehole");
}

function storePath(): string {
  return path.join(dataDir(), "external-positions.json");
}

function ensureDir(): void {
  fs.mkdirSync(dataDir(), { recursive: true });
}

function brokerTag(broker: string): string {
  const b = broker.trim().toLowerCase();
  if (b === "robinhood" || b === "rh") return "RH";
  if (b === "e*trade" || b === "etrade" || b === "et") return "ET";
  if (b.length <= 3) return b.toUpperCase();
  return broker
    .trim()
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 3);
}

function monthShort(iso: string): string {
  const m = Number(iso.slice(5, 7));
  const names = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return names[m - 1] ?? iso.slice(5, 7);
}

function formatExpiryLabel(iso: string): string {
  const day = Number(iso.slice(8, 10));
  const yy = iso.slice(2, 4);
  return `${monthShort(iso)} ${day} '${yy}`;
}

export function formatExternalDescription(p: {
  symbol: string;
  expiry: string;
  strike: number;
  callPut: ExternalCallPut;
  broker: string;
}): string {
  const side = p.callPut === "call" ? "Call" : "Put";
  const strike =
    Number.isInteger(p.strike) ? `$${p.strike}` : `$${p.strike.toFixed(2)}`;
  return `${p.symbol.toUpperCase()} ${formatExpiryLabel(p.expiry)} ${strike} ${side} · ${brokerTag(p.broker)}`;
}

type RhSeedSpec = {
  broker: string;
  symbol: string;
  expiry: string;
  strike: number;
  callPut: ExternalCallPut;
  quantity: number;
  avgCost: number;
  boughtAt: string | null;
  notes: string | null;
};

/**
 * Canonical Robinhood FRO book (Aug 2026 screenshot):
 * 26× Aug21 $50c @ ~$0.04 · 1× Sep18 $46c @ ~$0.70 · 7× Sep18 $50c @ ~$0.44 · 1× Nov20 $60c @ ~$0.45
 */
function rhBookV4Specs(): RhSeedSpec[] {
  return [
    {
      broker: "Robinhood",
      symbol: "FRO",
      expiry: "2026-08-21",
      strike: 50,
      callPut: "call",
      quantity: 26,
      avgCost: 0.04,
      boughtAt: "2026-08-07",
      notes: "RH · Aug21 $50c · 26× @ ~$0.04",
    },
    {
      broker: "Robinhood",
      symbol: "FRO",
      expiry: "2026-09-18",
      strike: 46,
      callPut: "call",
      quantity: 1,
      avgCost: 0.7,
      boughtAt: null,
      notes: "RH · Sep18 $46c · 1× @ ~$0.70",
    },
    {
      broker: "Robinhood",
      symbol: "FRO",
      expiry: "2026-09-18",
      strike: 50,
      callPut: "call",
      quantity: 7,
      avgCost: 0.44,
      boughtAt: null,
      notes: "RH · Sep18 $50c · 7× @ ~$0.44",
    },
    {
      broker: "Robinhood",
      symbol: "FRO",
      expiry: "2026-11-20",
      strike: 60,
      callPut: "call",
      quantity: 1,
      avgCost: 0.45,
      boughtAt: null,
      notes: "RH · Nov20 $60c · 1× @ ~$0.45",
    },
  ];
}

/** Legacy v3 seed — superseded by v4 but kept for first-run migration chain. */
function rhBookV3Specs(): RhSeedSpec[] {
  return rhBookV4Specs();
}

function contractKey(p: {
  symbol: string;
  expiry: string;
  strike: number;
  callPut: ExternalCallPut;
  broker: string;
}): string {
  return [
    p.symbol.toUpperCase(),
    p.expiry,
    String(p.strike),
    p.callPut,
    brokerTag(p.broker),
  ].join("|");
}

function emptyStore(): StoreFile {
  return {
    version: STORE_VERSION,
    seededDefaults: false,
    seededRhBookV2: false,
    seededRhBookV3: false,
    seededRhBookV4: false,
    positions: [],
  };
}

function readStoreRaw(): StoreFile {
  try {
    const p = storePath();
    if (!fs.existsSync(p)) return emptyStore();
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<StoreFile>;
    return {
      version: STORE_VERSION,
      seededDefaults: Boolean(raw.seededDefaults),
      seededRhBookV2: Boolean(raw.seededRhBookV2),
      seededRhBookV3: Boolean(raw.seededRhBookV3),
      seededRhBookV4: Boolean(raw.seededRhBookV4),
      positions: Array.isArray(raw.positions) ? raw.positions : [],
    };
  } catch (err) {
    console.warn("[tradehole] external-positions read failed:", err);
    return emptyStore();
  }
}

function writeStore(store: StoreFile): void {
  ensureDir();
  fs.writeFileSync(storePath(), JSON.stringify(store, null, 2));
}

/** Upsert RH book specs; updates qty/cost on matching contracts; keeps other brokers. */
function upsertRhBook(store: StoreFile, specs: RhSeedSpec[]): StoreFile {
  const now = new Date().toISOString();
  const byKey = new Map(
    store.positions.map((p) => [contractKey(p), p] as const),
  );
  for (const spec of specs) {
    const key = contractKey(spec);
    const existing = byKey.get(key);
    if (existing) {
      existing.quantity = spec.quantity;
      existing.avgCost = spec.avgCost;
      existing.boughtAt = spec.boughtAt ?? existing.boughtAt;
      existing.notes = spec.notes ?? existing.notes;
      existing.updatedAt = now;
    } else {
      const row: ExternalPosition = {
        id: crypto.randomUUID(),
        ...spec,
        createdAt: now,
        updatedAt: now,
      };
      store.positions.push(row);
      byKey.set(key, row);
    }
  }
  return store;
}

function ensureRhBookV3(store: StoreFile): StoreFile {
  if (store.seededRhBookV3) return store;
  const next: StoreFile = {
    ...upsertRhBook(store, rhBookV3Specs()),
    version: STORE_VERSION,
    seededDefaults: true,
    seededRhBookV2: true,
    seededRhBookV3: true,
  };
  writeStore(next);
  return next;
}

/** Drop RH FRO legs no longer in the canonical book (e.g. closed Aug $45c). */
function pruneRhFroBook(store: StoreFile, specs: RhSeedSpec[]): StoreFile {
  const keep = new Set(specs.map((s) => contractKey(s)));
  store.positions = store.positions.filter((p) => {
    const isRhFro =
      p.symbol.toUpperCase() === "FRO" &&
      (p.broker.trim().toLowerCase() === "robinhood" ||
        p.broker.trim().toLowerCase() === "rh");
    if (!isRhFro) return true;
    return keep.has(contractKey(p));
  });
  return store;
}

function ensureRhBookV4(store: StoreFile): StoreFile {
  if (store.seededRhBookV4) return store;
  const specs = rhBookV4Specs();
  let next = upsertRhBook(store, specs);
  next = pruneRhFroBook(next, specs);
  next = {
    ...next,
    version: STORE_VERSION,
    seededDefaults: true,
    seededRhBookV2: true,
    seededRhBookV3: true,
    seededRhBookV4: true,
  };
  writeStore(next);
  return next;
}

function ensureSeeded(store: StoreFile): StoreFile {
  return ensureRhBookV4(ensureRhBookV3(store));
}

function normalizeInput(input: ExternalPositionInput): ExternalPositionInput {
  const symbol = String(input.symbol ?? "")
    .trim()
    .toUpperCase();
  const expiry = String(input.expiry ?? "").trim();
  const callPut = input.callPut === "put" ? "put" : "call";
  const strike = Number(input.strike);
  const quantity = Number(input.quantity);
  const avgCost = Number(input.avgCost);
  if (!symbol) throw new Error("symbol required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
    throw new Error("expiry must be YYYY-MM-DD");
  }
  if (!Number.isFinite(strike) || strike <= 0) throw new Error("invalid strike");
  if (!Number.isFinite(quantity) || quantity === 0) {
    throw new Error("quantity must be non-zero");
  }
  if (!Number.isFinite(avgCost) || avgCost < 0) throw new Error("invalid avgCost");
  return {
    broker: (input.broker?.trim() || "Robinhood").slice(0, 40),
    symbol,
    expiry,
    strike,
    callPut,
    quantity,
    avgCost,
    boughtAt: input.boughtAt?.trim() || null,
    notes: input.notes?.trim() || null,
  };
}

export function listExternalPositions(): ExternalPosition[] {
  return ensureSeeded(readStoreRaw()).positions;
}

export function getExternalStorePath(): string {
  return storePath();
}

export function addExternalPosition(
  input: ExternalPositionInput,
): ExternalPosition {
  const store = ensureSeeded(readStoreRaw());
  const n = normalizeInput(input);
  const now = new Date().toISOString();
  const row: ExternalPosition = {
    id: crypto.randomUUID(),
    broker: n.broker!,
    symbol: n.symbol,
    expiry: n.expiry,
    strike: n.strike,
    callPut: n.callPut,
    quantity: n.quantity,
    avgCost: n.avgCost,
    boughtAt: n.boughtAt ?? null,
    notes: n.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };
  store.positions.push(row);
  writeStore(store);
  return row;
}

export function updateExternalPosition(
  id: string,
  patch: Partial<ExternalPositionInput>,
): ExternalPosition {
  const store = ensureSeeded(readStoreRaw());
  const idx = store.positions.findIndex((p) => p.id === id);
  if (idx < 0) throw new Error(`external position not found: ${id}`);
  const cur = store.positions[idx]!;
  const merged = normalizeInput({
    broker: patch.broker ?? cur.broker,
    symbol: patch.symbol ?? cur.symbol,
    expiry: patch.expiry ?? cur.expiry,
    strike: patch.strike ?? cur.strike,
    callPut: patch.callPut ?? cur.callPut,
    quantity: patch.quantity ?? cur.quantity,
    avgCost: patch.avgCost ?? cur.avgCost,
    boughtAt: patch.boughtAt !== undefined ? patch.boughtAt : cur.boughtAt,
    notes: patch.notes !== undefined ? patch.notes : cur.notes,
  });
  const next: ExternalPosition = {
    ...cur,
    broker: merged.broker!,
    symbol: merged.symbol,
    expiry: merged.expiry,
    strike: merged.strike,
    callPut: merged.callPut,
    quantity: merged.quantity,
    avgCost: merged.avgCost,
    boughtAt: merged.boughtAt ?? null,
    notes: merged.notes ?? null,
    updatedAt: new Date().toISOString(),
  };
  store.positions[idx] = next;
  writeStore(store);
  return next;
}

export function deleteExternalPosition(id: string): boolean {
  const store = ensureSeeded(readStoreRaw());
  const before = store.positions.length;
  store.positions = store.positions.filter((p) => p.id !== id);
  if (store.positions.length === before) return false;
  writeStore(store);
  return true;
}

function optionMark(c: OptionContract | undefined): {
  mark: number | null;
  bid: number | null;
  ask: number | null;
} {
  if (!c) return { mark: null, bid: null, ask: null };
  const bid = c.bid;
  const ask = c.ask;
  let mark: number | null = null;
  if (bid != null && ask != null && bid > 0 && ask > 0) {
    mark = (bid + ask) / 2;
  } else if (c.lastPrice != null && c.lastPrice > 0) {
    mark = c.lastPrice;
  } else if (ask != null && ask > 0) {
    mark = ask;
  } else if (bid != null && bid > 0) {
    mark = bid;
  }
  return { mark, bid: bid ?? null, ask: ask ?? null };
}

function toRow(
  p: ExternalPosition,
  quote: { mark: number | null; bid: number | null; ask: number | null },
): ExternalPositionRow {
  const absQty = Math.abs(p.quantity);
  const sign = p.quantity < 0 ? -1 : 1;
  const totalCost = p.avgCost * absQty * MULTIPLIER;
  const marketValue =
    quote.mark != null ? quote.mark * absQty * MULTIPLIER * sign : null;
  const totalGain =
    marketValue != null ? marketValue - totalCost * sign : null;
  const totalGainPct =
    totalGain != null && totalCost > 0
      ? (totalGain / totalCost) * 100 * sign
      : null;

  return {
    symbolDescription: formatExternalDescription(p),
    symbol: p.symbol,
    quantity: p.quantity,
    pricePaid: p.avgCost,
    marketValue,
    totalCost: totalCost * sign,
    totalGain,
    totalGainPct,
    daysGain: null,
    daysGainPct: null,
    typeCode: "OPTN",
    broker: p.broker,
    brokerTag: brokerTag(p.broker),
    externalId: p.id,
    mark: quote.mark,
    bid: quote.bid,
    ask: quote.ask,
    expiry: p.expiry,
    strike: p.strike,
    callPut: p.callPut,
  };
}

/** Live-mark external positions via existing options chain path. */
export async function listMarkedExternalPositions(): Promise<ExternalPositionRow[]> {
  const positions = listExternalPositions();
  if (!positions.length) return [];

  const groups = new Map<string, ExternalPosition[]>();
  for (const p of positions) {
    const key = `${p.symbol}|${p.expiry}`;
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }

  const quoteById = new Map<
    string,
    { mark: number | null; bid: number | null; ask: number | null }
  >();

  await Promise.all(
    [...groups.entries()].map(async ([key, group]) => {
      const [symbol, expiry] = key.split("|") as [string, string];
      try {
        const chain = await getOptionsChain(symbol, expiry);
        for (const p of group) {
          const side = p.callPut === "call" ? chain.calls : chain.puts;
          const contract = side.find(
            (c) => Math.abs(c.strike - p.strike) < 1e-6,
          );
          quoteById.set(p.id, optionMark(contract));
        }
      } catch (err) {
        console.warn(
          `[tradehole] external mark failed for ${symbol} ${expiry}:`,
          String(err).slice(0, 180),
        );
        for (const p of group) {
          quoteById.set(p.id, { mark: null, bid: null, ask: null });
        }
      }
    }),
  );

  return positions.map((p) =>
    toRow(p, quoteById.get(p.id) ?? { mark: null, bid: null, ask: null }),
  );
}

export function sumExternalTotals(rows: ExternalPositionRow[]): {
  marketValue: number;
  totalCost: number;
  totalGain: number;
  daysGain: number;
} {
  return rows.reduce(
    (acc, row) => {
      acc.marketValue += row.marketValue ?? 0;
      acc.totalCost += row.totalCost ?? 0;
      acc.totalGain += row.totalGain ?? 0;
      acc.daysGain += row.daysGain ?? 0;
      return acc;
    },
    { marketValue: 0, totalCost: 0, totalGain: 0, daysGain: 0 },
  );
}
