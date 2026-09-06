import { fmtMoney, fmtPct, signedClass } from "../lib/format";
import type { StockQuote } from "../types";
import { FlashValue, formatAge, formatPollLabel } from "./FlashValue";

type Props = {
  quote: StockQuote | null;
  loading?: boolean;
  pollMs?: number;
  nowMs?: number;
};

function sessionPill(quote: StockQuote): { label: string; className: string } {
  const state = (quote.marketState ?? "").toUpperCase();
  const src = quote.source.toLowerCase();
  const session =
    state.includes("POST") || quote.extendedSession === "post"
      ? "AFTER HOURS"
      : state.includes("PRE") || quote.extendedSession === "pre"
        ? "PRE-MARKET"
        : state === "REGULAR"
          ? "REGULAR"
          : null;

  if (src.startsWith("etrade:realtime")) {
    return {
      label: session && session !== "REGULAR" ? `E*TRADE live · ${session}` : "E*TRADE live",
      className: session && session !== "REGULAR" ? "ah" : "live",
    };
  }
  if (src.startsWith("etrade")) {
    // CLOSING / delayed after the bell — still broker, not Yahoo.
    if (src.includes("closing") || session === "AFTER HOURS" || session === "PRE-MARKET") {
      return {
        label: `E*TRADE · ${session ?? "CLOSED"}`,
        className: "ah",
      };
    }
    return { label: "E*TRADE", className: "live" };
  }
  if (session === "REGULAR") return { label: "REGULAR", className: "live" };
  if (session === "AFTER HOURS") return { label: "AFTER HOURS", className: "ah" };
  if (session === "PRE-MARKET") return { label: "PRE-MARKET", className: "ah" };
  return { label: quote.marketState ?? "—", className: "" };
}

export function StockPrice({ quote, loading, pollMs, nowMs }: Props) {
  if (!quote && loading) {
    return (
      <section className="panel quote-panel">
        <h2>FRO</h2>
        <p className="muted">Loading quote…</p>
      </section>
    );
  }

  if (!quote) {
    return (
      <section className="panel quote-panel">
        <h2>FRO</h2>
        <p className="muted">No quote yet</p>
      </section>
    );
  }

  const changeClass = signedClass(quote.change);
  const age = formatAge(quote.fetchedAt, nowMs ?? Date.now());
  const pill = sessionPill(quote);
  const hasExtended = quote.extendedPrice != null;
  const extLabel =
    quote.extendedSession === "pre"
      ? "Pre-market"
      : quote.extendedSession === "post"
        ? "After hours"
        : "Extended";
  const extChangeClass = signedClass(quote.extendedChange);

  return (
    <section className="panel quote-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Underlying</p>
          <h2>{quote.symbol}</h2>
          <p className="muted">{quote.shortName ?? "Frontline plc"}</p>
        </div>
        <div className="panel-head-actions">
          <span className={`pill ${pill.className}`}>{pill.label}</span>
          <p className="feed-meta muted tiny">
            {age}
            {pollMs != null ? ` · every ${formatPollLabel(pollMs)}` : ""}
          </p>
        </div>
      </div>

      <div className="price-row">
        <FlashValue value={quote.price} className="price">
          ${fmtMoney(quote.price)}
        </FlashValue>
        <span className={`change ${changeClass}`}>
          {quote.change != null && quote.change > 0 ? "+" : ""}
          {fmtMoney(quote.change)} ({fmtPct(quote.changePercent)})
        </span>
      </div>
      <p className="muted tiny quote-session-note">Regular session close / last RTH print</p>

      {hasExtended && (
        <div className="extended-block">
          <div className="extended-head">
            <span className="pill ah">{extLabel}</span>
            {quote.extendedAsOf && (
              <span className="muted tiny">
                as of {new Date(quote.extendedAsOf).toLocaleTimeString()}
              </span>
            )}
          </div>
          <div className="price-row extended-price-row">
            <FlashValue value={quote.extendedPrice} className="extended-price">
              ${fmtMoney(quote.extendedPrice)}
            </FlashValue>
            <span className={`change ${extChangeClass}`}>
              {quote.extendedChange != null && quote.extendedChange > 0 ? "+" : ""}
              {fmtMoney(quote.extendedChange)} ({fmtPct(quote.extendedChangePercent)})
            </span>
          </div>
          <p className="muted tiny">
            vs regular close
            {quote.price != null && quote.extendedPrice != null
              ? ` · Δ $${fmtMoney(quote.extendedPrice - quote.price)}`
              : ""}
          </p>
        </div>
      )}

      <dl className="stat-grid">
        <div>
          <dt>Bid</dt>
          <dd>
            <FlashValue value={quote.bid}>{fmtMoney(quote.bid)}</FlashValue>
          </dd>
        </div>
        <div>
          <dt>Ask</dt>
          <dd>
            <FlashValue value={quote.ask}>{fmtMoney(quote.ask)}</FlashValue>
          </dd>
        </div>
        <div>
          <dt>Open</dt>
          <dd>{fmtMoney(quote.open)}</dd>
        </div>
        <div>
          <dt>Day</dt>
          <dd>
            {fmtMoney(quote.low)} – {fmtMoney(quote.high)}
          </dd>
        </div>
      </dl>
    </section>
  );
}
