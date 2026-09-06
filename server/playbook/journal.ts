import { randomUUID } from "node:crypto";
import { getHistoryDb } from "../history/db";
import type { ProposalDecision, TradeProposal } from "./types";

export function ensurePlaybookTables(): void {
  const database = getHistoryDb();
  if (!database) return;
  database.exec(`
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
}

export function insertProposal(proposal: TradeProposal): void {
  ensurePlaybookTables();
  const database = getHistoryDb();
  if (!database) return;
  const now = new Date().toISOString();
  // Expire prior open lottery proposals so the desk strip has one current action.
  database
    .prepare(
      `UPDATE trade_proposals SET status = 'expired', updated_at = ?
       WHERE book = ? AND status = 'open'`,
    )
    .run(now, proposal.book);
  database
    .prepare(
      `INSERT OR REPLACE INTO trade_proposals
        (id, as_of, book, action, payload_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      proposal.id,
      proposal.asOf,
      proposal.book,
      proposal.action,
      JSON.stringify(proposal),
      proposal.status,
      now,
      now,
    );
}

/** Latest non-expired proposal for desk strip (no live rebuild). */
export function getLatestProposal(): TradeProposal | null {
  ensurePlaybookTables();
  const database = getHistoryDb();
  if (!database) return null;
  const row = database
    .prepare(
      `SELECT payload_json, status FROM trade_proposals
       WHERE status IN ('open', 'accepted', 'accepted_manual', 'rejected', 'snoozed')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get() as { payload_json?: string; status?: string } | undefined;
  if (!row?.payload_json) return null;
  try {
    const p = JSON.parse(row.payload_json) as TradeProposal;
    if (row.status) p.status = row.status as TradeProposal["status"];
    return p;
  } catch {
    return null;
  }
}

export function getProposal(id: string): TradeProposal | null {
  ensurePlaybookTables();
  const database = getHistoryDb();
  if (!database) return null;
  const row = database
    .prepare(`SELECT payload_json, status FROM trade_proposals WHERE id = ?`)
    .get(id) as { payload_json?: string; status?: string } | undefined;
  if (!row?.payload_json) return null;
  try {
    const p = JSON.parse(row.payload_json) as TradeProposal;
    if (row.status) p.status = row.status as TradeProposal["status"];
    return p;
  } catch {
    return null;
  }
}

export function updateProposalStatus(
  id: string,
  status: TradeProposal["status"],
  patch?: Partial<TradeProposal>,
): TradeProposal | null {
  ensurePlaybookTables();
  const database = getHistoryDb();
  if (!database) return null;
  const current = getProposal(id);
  if (!current) return null;
  const next: TradeProposal = { ...current, ...patch, status };
  database
    .prepare(
      `UPDATE trade_proposals SET status = ?, payload_json = ?, updated_at = ? WHERE id = ?`,
    )
    .run(status, JSON.stringify(next), new Date().toISOString(), id);
  return next;
}

export function recordJournalEntry(
  proposal: TradeProposal,
  decision: ProposalDecision,
): void {
  ensurePlaybookTables();
  const database = getHistoryDb();
  if (!database) return;
  database
    .prepare(
      `INSERT INTO trade_journal
        (ts, proposal_id, decision, note, order_id, fill_price, pnl, action, quantity, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      new Date().toISOString(),
      proposal.id,
      decision.decision,
      decision.note ?? null,
      decision.orderId ?? null,
      decision.fillPrice ?? null,
      decision.pnl ?? null,
      proposal.action,
      proposal.quantity,
      JSON.stringify({ proposal, decision }),
    );
}

/** Sum estimated debit from accepted ADD proposals today (ET calendar day UTC date). */
export function debitUsedToday(): number {
  ensurePlaybookTables();
  const database = getHistoryDb();
  if (!database) return 0;
  const day = new Date().toISOString().slice(0, 10);
  const rows = database
    .prepare(
      `SELECT payload_json FROM trade_journal
       WHERE decision IN ('accepted', 'accepted_manual')
         AND action = 'add'
         AND ts >= ?`,
    )
    .all(`${day}T00:00:00.000Z`) as Array<{ payload_json?: string }>;
  let sum = 0;
  for (const row of rows) {
    try {
      const parsed = JSON.parse(String(row.payload_json ?? "{}")) as {
        proposal?: TradeProposal;
        decision?: ProposalDecision;
      };
      const px =
        parsed.decision?.fillPrice ??
        parsed.proposal?.limitPriceHint ??
        null;
      const qty = parsed.proposal?.quantity ?? 0;
      if (px != null && qty > 0) sum += px * 100 * qty;
    } catch {
      /* skip */
    }
  }
  return sum;
}

export function listJournal(limit = 50): Array<Record<string, unknown>> {
  ensurePlaybookTables();
  const database = getHistoryDb();
  if (!database) return [];
  const rows = database
    .prepare(
      `SELECT id, ts, proposal_id, decision, note, order_id, fill_price, pnl, action, quantity
       FROM trade_journal ORDER BY ts DESC LIMIT ?`,
    )
    .all(limit) as Array<Record<string, unknown>>;
  return rows;
}

export function journalSummary(): {
  decisions: number;
  accepted: number;
  rejected: number;
  snoozed: number;
  acceptedManual: number;
  byAction: Record<string, number>;
  last7dDecisions: number;
  pnlSum: number | null;
  scalpReady: boolean;
} {
  ensurePlaybookTables();
  const database = getHistoryDb();
  const empty = {
    decisions: 0,
    accepted: 0,
    rejected: 0,
    snoozed: 0,
    acceptedManual: 0,
    byAction: {} as Record<string, number>,
    last7dDecisions: 0,
    pnlSum: null as number | null,
    scalpReady: false,
  };
  if (!database) return empty;
  const rows = database
    .prepare(`SELECT decision, action, ts, pnl FROM trade_journal`)
    .all() as Array<{
    decision?: string;
    action?: string;
    ts?: string;
    pnl?: number | null;
  }>;
  const weekAgo = Date.now() - 7 * 86_400_000;
  const out = {
    ...empty,
    byAction: {} as Record<string, number>,
  };
  let pnlSum = 0;
  let pnlN = 0;
  for (const row of rows) {
    out.decisions += 1;
    const d = String(row.decision ?? "");
    if (d === "accepted") out.accepted += 1;
    else if (d === "rejected") out.rejected += 1;
    else if (d === "snoozed") out.snoozed += 1;
    else if (d === "accepted_manual") out.acceptedManual += 1;
    const a = String(row.action ?? "none");
    out.byAction[a] = (out.byAction[a] ?? 0) + 1;
    const ts = row.ts ? Date.parse(row.ts) : NaN;
    if (Number.isFinite(ts) && ts >= weekAgo) out.last7dDecisions += 1;
    if (typeof row.pnl === "number" && Number.isFinite(row.pnl)) {
      pnlSum += row.pnl;
      pnlN += 1;
    }
  }
  out.pnlSum = pnlN > 0 ? pnlSum : null;
  out.scalpReady = out.decisions >= 30;
  return out;
}

export function newProposalId(): string {
  return randomUUID();
}
