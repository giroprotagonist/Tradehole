import { fmtMoney, signedClass } from "../lib/format";
import type { PhysicalMarkets } from "../types";

type Props = {
  physical: PhysicalMarkets | null;
};

export function PhysicalMarketsPanel({ physical }: Props) {
  if (!physical) {
    return (
      <section className="panel physical-panel">
        <h2>Physical</h2>
        <p className="muted">Loading VLCC / Brent spot…</p>
      </section>
    );
  }

  const { brent, vlccTd3c } = physical;
  const spread = brent.spotMinusFutures;

  return (
    <section className="panel physical-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Leading indicators</p>
          <h2>Physical market</h2>
          <p className="muted">VLCC TD3C + Brent spot vs paper</p>
        </div>
        <span className={`pill ${vlccTd3c.worldscale ? "live" : ""}`}>
          {vlccTd3c.worldscale ? "TD3C print" : "no WS print"}
        </span>
      </div>

      <div className="physical-grid">
        <div className="physical-card emphasize">
          <p className="eyebrow">VLCC TD3C · ME Gulf → China</p>
          <p className="physical-big">
            {vlccTd3c.worldscale != null ? `WS ${vlccTd3c.worldscale}` : "—"}
          </p>
          <p className="muted">
            TCE{" "}
            {vlccTd3c.tceUsdPerDay != null
              ? `$${Math.round(vlccTd3c.tceUsdPerDay).toLocaleString()}/day`
              : "—"}
          </p>
          <p className="muted tiny">{vlccTd3c.asOfLabel ?? "—"}</p>
        </div>

        <div className="physical-card">
          <p className="eyebrow">EIA Europe Brent Spot</p>
          <p className="physical-big">
            {brent.eiaEuropeBrentSpot.price != null
              ? `$${fmtMoney(brent.eiaEuropeBrentSpot.price)}`
              : "—"}
          </p>
          <p className="muted tiny">as of {brent.eiaEuropeBrentSpot.asOf ?? "—"}</p>
        </div>

        <div className="physical-card">
          <p className="eyebrow">Brent futures (BZ=F)</p>
          <p className="physical-big">
            {brent.brentFutures?.price != null
              ? `$${fmtMoney(brent.brentFutures.price)}`
              : "—"}
          </p>
          <p className="muted tiny">paper / lagging</p>
        </div>

        <div className="physical-card">
          <p className="eyebrow">Spot − futures</p>
          <p className={`physical-big ${signedClass(spread)}`}>
            {spread == null
              ? "—"
              : `${spread > 0 ? "+" : ""}$${fmtMoney(spread)}`}
          </p>
          <p className="muted tiny">
            {spread == null
              ? "need both prints"
              : spread > 0
                ? "spot premium vs paper"
                : "spot discount vs paper"}
          </p>
        </div>
      </div>

      {vlccTd3c.excerpt && (
        <p className="physical-excerpt muted tiny">{vlccTd3c.excerpt}</p>
      )}

      <p className="muted tiny physical-caveat">
        Not Platts Dated Brent / not live Baltic API — free proxies only. Physical often
        leads futures.
      </p>
    </section>
  );
}
