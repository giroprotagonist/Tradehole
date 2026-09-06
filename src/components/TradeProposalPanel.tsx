import { useCallback, useEffect, useState } from "react";
import {
  decidePlaybookProposal,
  fetchPlaybookJournal,
  fetchPlaybookProposal,
} from "../services/api";
import type { TradeJournalSummary, TradeOrderDraft, TradeProposal } from "../types";

type Props = {
  onApproveDraft?: (draft: TradeOrderDraft) => void;
};

export function TradeProposalPanel({ onApproveDraft }: Props) {
  const [proposal, setProposal] = useState<TradeProposal | null>(null);
  const [summary, setSummary] = useState<TradeJournalSummary | null>(null);
  const [entries, setEntries] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (force = false) => {
    setBusy(true);
    setError(null);
    try {
      const [p, j] = await Promise.all([
        fetchPlaybookProposal(force),
        fetchPlaybookJournal(12),
      ]);
      setProposal(p);
      setSummary(j.summary);
      setEntries(j.entries);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh(false);
    const id = window.setInterval(() => void refresh(false), 60_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  async function decide(
    decision: "accepted" | "rejected" | "snoozed" | "accepted_manual",
  ) {
    if (!proposal) return;
    setBusy(true);
    setError(null);
    try {
      if (
        (decision === "accepted" || decision === "accepted_manual") &&
        (proposal.action === "add" || proposal.action === "trim") &&
        proposal.orderAction &&
        proposal.quantity > 0
      ) {
        onApproveDraft?.({
          orderAction: proposal.orderAction,
          quantity: proposal.quantity,
          limitPrice:
            proposal.limitPriceHint != null
              ? proposal.limitPriceHint.toFixed(2)
              : "",
          proposalId: proposal.id,
        });
      }
      await decidePlaybookProposal(proposal.id, { decision });
      await refresh(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  const action = proposal?.action ?? "—";
  const canTrade =
    proposal &&
    (proposal.action === "add" || proposal.action === "trim") &&
    proposal.quantity > 0 &&
    proposal.orderAction;

  return (
    <section className="panel trade-proposal-panel">
      <div className="panel-head">
        <p className="eyebrow">Playbook co-pilot</p>
        <h2>Trade proposal</h2>
        <p className="muted tiny">
          Lottery book · human authority · never auto-place
        </p>
      </div>

      <div className="tp-actions-row">
        <button type="button" disabled={busy} onClick={() => void refresh(true)}>
          Refresh
        </button>
        {summary && (
          <span className="muted tiny">
            Journal {summary.decisions} · 7d {summary.last7dDecisions} · accept{" "}
            {summary.accepted + summary.acceptedManual} · reject {summary.rejected}
            {summary.pnlSum != null
              ? ` · journaled P&L $${summary.pnlSum.toFixed(0)}`
              : ""}
            {summary.scalpReady
              ? " · scalp unlocked (≥30)"
              : ` · scalp deferred (${summary.decisions}/30)`}
          </span>
        )}
      </div>

      {error && <p className="banner error">{error}</p>}

      {!proposal && !error && <p className="muted">Loading proposal…</p>}

      {proposal && (
        <>
          <div className="tp-action-line">
            <span className={`tp-pill tp-${proposal.action}`}>{action}</span>
            {proposal.conflict && (
              <span className="tp-pill tp-conflict">conflict</span>
            )}
            {!proposal.gates.ok && proposal.gates.blockedBy.length > 0 && (
              <span className="tp-pill tp-gate">gates</span>
            )}
            <span className="muted tiny">
              {proposal.contract.symbol} {proposal.contract.expiry} $
              {proposal.contract.strike}
              {proposal.contract.callPut === "call" ? "c" : "p"}
              {proposal.quantity > 0 ? ` · ${proposal.quantity}×` : ""}
              {proposal.orderAction ? ` · ${proposal.orderAction}` : ""}
            </span>
          </div>

          <ul className="tp-reasons">
            {proposal.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>

          <p className="theater-read">
            <strong>Invalidation:</strong> {proposal.invalidation}
          </p>

          {proposal.gates.blockedBy.length > 0 && (
            <p className="muted tiny">
              Gates: {proposal.gates.blockedBy.join(" · ")}
            </p>
          )}

          <p className="muted tiny">
            Sources · fro {proposal.sources.fro} · df {proposal.sources.df} · ms{" "}
            {proposal.sources.ms} · strat {proposal.sources.strategy} · deal{" "}
            {proposal.sources.deal} · intel {proposal.sources.intel} · IL{" "}
            {proposal.sources.israel}
          </p>

          <div className="tp-decide">
            {canTrade && (
              <>
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => void decide("accepted")}
                >
                  Approve → E*TRADE form
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide("accepted_manual")}
                >
                  Accept (Robinhood manual)
                </button>
              </>
            )}
            {!canTrade && (
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void decide("accepted")}
              >
                Ack {action}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide("rejected")}
            >
              Reject
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide("snoozed")}
            >
              Snooze
            </button>
          </div>
        </>
      )}

      {entries.length > 0 && (
        <div className="tp-journal">
          <p className="eyebrow">Recent journal</p>
          <ul className="tp-journal-list">
            {entries.slice(0, 8).map((e) => {
              const ts = String(e.ts ?? "").slice(5, 16).replace("T", " ");
              const dec = String(e.decision ?? "");
              const act = String(e.action ?? "");
              const qty = e.quantity != null ? `${e.quantity}×` : "";
              const pnl =
                typeof e.pnl === "number" ? ` · $${Number(e.pnl).toFixed(0)}` : "";
              return (
                <li key={String(e.id)}>
                  <span className="muted tiny">{ts}</span> {dec} {act} {qty}
                  {pnl}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
