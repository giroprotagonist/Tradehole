import { fmtMoney, fmtPct } from "../lib/format";
import type { StockQuote } from "../types";
import { FlashValue, formatPollLabel } from "./FlashValue";

export type EnergyQuotesData = {
  wti: StockQuote;
  brent: StockQuote;
  heatingOil?: StockQuote | null;
  gasoline?: StockQuote | null;
  dieselCrackUsdPerBbl?: number | null;
  gasolineCrackUsdPerBbl?: number | null;
};

type Props = {
  energy: EnergyQuotesData | null;
  pollMs?: number;
};

function sourceLabel(source: string | undefined): string {
  if (!source) return "";
  if (source.startsWith("cme-group")) return "CME";
  if (source.includes("yahoo")) return "Yahoo";
  return source;
}

function isStaleYahoo(source: string | undefined): boolean {
  if (!source) return false;
  return /CME blocked|stale settle|CME miss/i.test(source);
}

function quoteAgeLabel(quote: StockQuote): string | null {
  if (!quote.fetchedAt) return null;
  const t = Date.parse(quote.fetchedAt);
  if (!Number.isFinite(t)) return null;
  const ageSec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (ageSec < 90) return `as of ${new Date(t).toLocaleTimeString()}`;
  if (ageSec < 3600) return `as of ${new Date(t).toLocaleTimeString()} · ${Math.round(ageSec / 60)}m ago`;
  return `as of ${new Date(t).toLocaleString()} · ${Math.round(ageSec / 3600)}h ago`;
}

function EnergyCard({
  label,
  quote,
  unit,
  emphasize,
  priceDigits = 2,
}: {
  label: string;
  quote: StockQuote;
  unit?: string;
  emphasize?: boolean;
  priceDigits?: number;
}) {
  const up = (quote.change ?? 0) >= 0;
  const src = sourceLabel(quote.source);
  const stale = isStaleYahoo(quote.source);
  const age = quoteAgeLabel(quote);
  return (
    <div className={`energy-card${emphasize ? " emphasize" : ""}${stale ? " energy-stale" : ""}`}>
      <p className="eyebrow">{label}</p>
      <FlashValue value={quote.price} className="energy-price">
        ${fmtMoney(quote.price, priceDigits)}
        {unit ? <span className="energy-unit">{unit}</span> : null}
      </FlashValue>
      <p className={up ? "up" : "down"}>{fmtPct(quote.changePercent)}</p>
      {src ? (
        <p className={`energy-source muted tiny${stale ? " warn" : ""}`}>
          {src}
          {stale ? " · not live Globex" : ""}
        </p>
      ) : null}
      {age ? <p className="energy-asof muted tiny">{age}</p> : null}
    </div>
  );
}

function energyFeedSummary(energy: EnergyQuotesData): string {
  const parts = [
    `WTI ${sourceLabel(energy.wti.source)}`,
    `Brent ${sourceLabel(energy.brent.source)}`,
  ];
  if (energy.heatingOil) {
    parts.push(`HO ${sourceLabel(energy.heatingOil.source)}`);
  }
  const anyStale =
    isStaleYahoo(energy.wti.source) ||
    isStaleYahoo(energy.heatingOil?.source) ||
    isStaleYahoo(energy.gasoline?.source);
  if (anyStale) parts.push("CME blocked → Yahoo settle");
  return parts.join(" · ");
}

export function EnergyQuotes({ energy, pollMs }: Props) {
  const diesel = energy?.heatingOil ?? null;
  const rb = energy?.gasoline ?? null;
  const dieselCrack = energy?.dieselCrackUsdPerBbl ?? null;

  return (
    <section className="panel energy-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Energy</p>
          <h2>Oil & diesel</h2>
          <p className="feed-meta muted tiny">
            {energy ? energyFeedSummary(energy) : "CME preferred · Yahoo fallback"}
            {pollMs != null ? ` · every ${formatPollLabel(pollMs)}` : ""}
          </p>
        </div>
      </div>
      {!energy ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="energy-grid energy-grid-products">
            {diesel ? (
              <EnergyCard
                label="Diesel / ULSD (HO)"
                quote={diesel}
                unit="/gal"
                emphasize
                priceDigits={3}
              />
            ) : (
              <div className="energy-card emphasize">
                <p className="eyebrow">Diesel / ULSD (HO)</p>
                <p className="muted">Quote unavailable</p>
              </div>
            )}
            <EnergyCard label="WTI (CL)" quote={energy.wti} unit="/bbl" />
            <EnergyCard label="Brent (BZ=F)" quote={energy.brent} unit="/bbl" />
          </div>
          {(dieselCrack != null || rb) && (
            <p className="energy-crack muted tiny">
              {dieselCrack != null
                ? `HO–WTI crack ≈ $${fmtMoney(dieselCrack)}/bbl`
                : null}
              {dieselCrack != null && rb ? " · " : null}
              {rb
                ? `RB ${fmtMoney(rb.price, 3)}/gal${
                    energy.gasolineCrackUsdPerBbl != null
                      ? ` · RB–WTI ≈ $${fmtMoney(energy.gasolineCrackUsdPerBbl)}/bbl`
                      : ""
                  }`
                : null}
            </p>
          )}
        </>
      )}
    </section>
  );
}
