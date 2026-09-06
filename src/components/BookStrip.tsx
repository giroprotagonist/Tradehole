import { useCallback, useEffect, useState } from "react";
import {
  fetchBookSummary,
  fetchPlaybookLatest,
  type BookSummary,
} from "../services/api";
import type { TradeProposal } from "../types";

const POLL_MS = 30_000;

type Props = {
  refreshKey?: number;
};

export function BookStrip({ refreshKey = 0 }: Props) {
  const [book, setBook] = useState<BookSummary | null>(null);
  const [proposal, setProposal] = useState<TradeProposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [next, latest] = await Promise.all([
        fetchBookSummary(),
        fetchPlaybookLatest().catch(() => ({ proposal: null, asOf: "" })),
      ]);
      setBook(next);
      setProposal(latest.proposal);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh, refreshKey]);

  const froParts =
    book?.byAccount
      .map((a) => {
        const froLegs = a.legs.filter((l) => l.symbol === "FRO");
        if (!froLegs.length) return null;
        const froQty = froLegs.reduce((s, l) => s + l.quantity, 0);
        if (a.focus46c > 0 && a.focus46c === froQty) {
          return `${a.account} ${a.focus46c}× $46c`;
        }
        if (froLegs.length === 1) {
          const leg = froLegs[0]!;
          const m = leg.description.match(/\$(\d+(?:\.\d+)?)\s*c/i);
          const strike = m?.[1] ?? "?";
          return `${a.account} ${leg.quantity}× $${strike}c`;
        }
        return `${a.account} ${froQty}× FRO`;
      })
      .filter((s): s is string => Boolean(s)) ?? [];

  const froTotal =
    book?.legs
      .filter((l) => l.symbol === "FRO")
      .reduce((s, l) => s + l.quantity, 0) ?? 0;

  const action = proposal?.action;

  return (
    <div
      className="book-strip"
      title="FRO book by account — Sep $46c focus is separate from other strikes"
    >
      <span className="book-strip-label">Book</span>
      <span className="book-strip-focus">
        FRO{" "}
        <strong>{book ? `${froTotal}×` : "—"}</strong>
        <span className="muted">
          {" "}
          · $46c {book ? `${book.focus46cTotal}×` : "—"}
        </span>
      </span>
      {action && (
        <span
          className={`book-strip-playbook tp-pill tp-${action}`}
          title={proposal?.reasons?.slice(0, 2).join(" · ") ?? "Playbook"}
        >
          playbook {action}
        </span>
      )}
      {froParts.length > 0 && (
        <span className="book-strip-parts muted">{froParts.join(" · ")}</span>
      )}
      {!book && !error && <span className="muted">loading…</span>}
      {error && <span className="error tiny">{error.slice(0, 80)}</span>}
    </div>
  );
}
