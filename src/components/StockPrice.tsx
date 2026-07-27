import { fmtMoney, fmtPct, signedClass } from "../lib/format";
import type { StockQuote } from "../types";

type Props = {
  quote: StockQuote | null;
  loading?: boolean;
};

export function StockPrice({ quote, loading }: Props) {
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

  return (
    <section className="panel quote-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Underlying</p>
          <h2>{quote.symbol}</h2>
          <p className="muted">{quote.shortName ?? "Frontline plc"}</p>
        </div>
        <span className={`pill ${quote.marketState === "REGULAR" ? "live" : ""}`}>
          {quote.marketState ?? "—"}
        </span>
      </div>

      <div className="price-row">
        <span className="price">${fmtMoney(quote.price)}</span>
        <span className={`change ${changeClass}`}>
          {quote.change != null && quote.change > 0 ? "+" : ""}
          {fmtMoney(quote.change)} ({fmtPct(quote.changePercent)})
        </span>
      </div>

      <dl className="stat-grid">
        <div>
          <dt>Bid</dt>
          <dd>{fmtMoney(quote.bid)}</dd>
        </div>
        <div>
          <dt>Ask</dt>
          <dd>{fmtMoney(quote.ask)}</dd>
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
