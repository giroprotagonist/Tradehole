import { fmtMoney, fmtPct } from "../lib/format";
import type { StockQuote } from "../types";

type Props = {
  energy: { wti: StockQuote; brent: StockQuote } | null;
};

function sourceLabel(source: string | undefined): string {
  if (!source) return "";
  if (source.startsWith("cme-group")) return "CME";
  if (source.includes("yahoo")) return "Yahoo";
  return source;
}

function EnergyCard({ label, quote }: { label: string; quote: StockQuote }) {
  const up = (quote.change ?? 0) >= 0;
  const src = sourceLabel(quote.source);
  return (
    <div className="energy-card">
      <p className="eyebrow">{label}</p>
      <p className="energy-price">${fmtMoney(quote.price)}</p>
      <p className={up ? "up" : "down"}>{fmtPct(quote.changePercent)}</p>
      {src ? <p className="energy-source muted tiny">{src}</p> : null}
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
          <p className="feed-meta muted tiny">
            {energy
              ? `WTI ${sourceLabel(energy.wti.source)} · Brent ${sourceLabel(energy.brent.source)}`
              : "CME preferred for WTI · Yahoo fallback"}
          </p>
        </div>
      </div>
      {!energy ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="energy-grid">
          <EnergyCard label="WTI (CL)" quote={energy.wti} />
          <EnergyCard label="Brent (BZ=F)" quote={energy.brent} />
        </div>
      )}
    </section>
  );
}
