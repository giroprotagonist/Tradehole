import { fmtMoney, fmtPct } from "../lib/format";
import type { StockQuote } from "../types";

type Props = {
  energy: { wti: StockQuote; brent: StockQuote } | null;
};

function EnergyCard({ label, quote }: { label: string; quote: StockQuote }) {
  const up = (quote.change ?? 0) >= 0;
  return (
    <div className="energy-card">
      <p className="eyebrow">{label}</p>
      <p className="energy-price">${fmtMoney(quote.price)}</p>
      <p className={up ? "up" : "down"}>{fmtPct(quote.changePercent)}</p>
    </div>
  );
}

export function EnergyQuotes({ energy }: Props) {
  return (
    <section className="panel energy-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Energy</p>
          <h2>Oil</h2>
        </div>
      </div>
      {!energy ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="energy-grid">
          <EnergyCard label="WTI (CL=F)" quote={energy.wti} />
          <EnergyCard label="Brent (BZ=F)" quote={energy.brent} />
        </div>
      )}
    </section>
  );
}
