import { asOfLagBadge, fmtMoney, signedClass } from "../lib/format";
import type { PhysicalMarkets } from "../types";

type Props = {
  physical: PhysicalMarkets | null;
  loading?: boolean;
};

export function PhysicalMarketsPanel({ physical, loading }: Props) {
  if (!physical) {
    return (
      <section className="panel physical-panel">
        <h2>Physical</h2>
        <p className="muted">
          {loading
            ? "Loading VLCC / Brent spot…"
            : "Physical unavailable — timed out or failed. Check banner; retry refresh."}
        </p>
      </section>
    );
  }

  const { brent, vlccTd3c } = physical;
  const spread = brent.spotMinusFutures;
  const stale = Boolean(physical.stale || physical.fromCache);
  const td3cLag = asOfLagBadge({
    asOf: vlccTd3c.asOfIso ?? undefined,
    lagDays: vlccTd3c.lagDays,
  });
  const brentLag = asOfLagBadge({ asOf: brent.eiaEuropeBrentSpot.asOf });
  const td34 = vlccTd3c.relatedRoutes?.find((r) => r.code === "TD34") ?? null;
  const td15 = vlccTd3c.relatedRoutes?.find((r) => r.code === "TD15") ?? null;

  return (
    <section className="panel physical-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Leading indicators</p>
          <h2>Physical market</h2>
          <p className="muted">VLCC TD3C + Brent spot vs paper</p>
        </div>
        <span
          className={`pill ${stale ? "warn" : td3cLag?.className === "warn" ? "warn" : vlccTd3c.worldscale ? "live" : ""}`}
        >
          {stale
            ? physical.error?.includes("rebuilding") ||
              physical.error?.includes("while live")
              ? "last-good · refreshing"
              : "last-good / stale"
            : td3cLag?.className === "warn"
              ? "weekly Baltic · lagged"
              : vlccTd3c.worldscale
                ? vlccTd3c.discoveryMethod?.includes("hellenic")
                  ? "Hellenic weekly"
                  : "TD3C print"
                : "no WS print"}
        </span>
      </div>

      {physical.error && (
        <p className="muted tiny physical-error">{physical.error}</p>
      )}
      {vlccTd3c.discoveryMethod && (
        <p className="muted tiny">
          Source: {vlccTd3c.discoveryMethod}
          {vlccTd3c.sourceTitle ? ` · ${vlccTd3c.sourceTitle}` : ""}
          {vlccTd3c.asOfIso ? ` · print ${vlccTd3c.asOfIso}` : ""}
        </p>
      )}

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
          <p className="muted tiny">
            {vlccTd3c.asOfLabel ?? "—"}
            {td3cLag && (
              <span className={`as-of-badge ${td3cLag.className}`}>
                {" "}
                · {td3cLag.text}
              </span>
            )}
          </p>
        </div>

        {td34 && (
          <div className="physical-card">
            <p className="eyebrow">TD34 · Gulf of Oman → China</p>
            <p className="physical-big">
              {td34.worldscale != null ? `WS ${td34.worldscale}` : "—"}
            </p>
            <p className="muted">
              TCE{" "}
              {td34.tceUsdPerDay != null
                ? `$${Math.round(td34.tceUsdPerDay).toLocaleString()}/day`
                : "—"}
            </p>
            <p className="muted tiny">
              Baltic reprint · same weekly as TD3C
              {td3cLag && (
                <span className={`as-of-badge ${td3cLag.className}`}>
                  {" "}
                  · {td3cLag.text}
                </span>
              )}
            </p>
          </div>
        )}

        <div className="physical-card">
          <p className="eyebrow">EIA Europe Brent Spot</p>
          <p className="physical-big">
            {brent.eiaEuropeBrentSpot.price != null
              ? `$${fmtMoney(brent.eiaEuropeBrentSpot.price)}`
              : "—"}
          </p>
          <p className="muted tiny">
            as of {brent.eiaEuropeBrentSpot.asOf ?? "—"}
            {brentLag && (
              <span className={`as-of-badge ${brentLag.className}`}>
                {" "}
                · {brentLag.text}
              </span>
            )}
            {" · "}
            official daily (inherent lag)
          </p>
        </div>

        <div className="physical-card">
          <p className="eyebrow">Brent futures (BZ=F)</p>
          <p className="physical-big">
            {brent.brentFutures?.price != null
              ? `$${fmtMoney(brent.brentFutures.price)}`
              : "—"}
          </p>
          <p className="muted tiny">paper / intraday</p>
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

      {td15 && (
        <p className="muted tiny physical-related">
          TD15 West Africa → China: WS {td15.worldscale ?? "—"}
          {td15.tceUsdPerDay != null
            ? ` · TCE $${Math.round(td15.tceUsdPerDay).toLocaleString()}/d`
            : ""}
        </p>
      )}

      {vlccTd3c.excerpt && (
        <p className="physical-excerpt muted tiny">{vlccTd3c.excerpt}</p>
      )}

      <p className="muted tiny physical-caveat">
        Not Platts Dated Brent / not live Baltic API — free proxies only. Baltic
        TD3C/TD34 are weekly assessments (often multi-day lag vs fixtures);
        Tradehole pulls the newest public reprint it can parse. EIA spot is an
        official daily series with its own publish lag. Clarksons inside-Hormuz
        marginal (~$800k/d) requires licensed broker data.
      </p>
      <p className="muted tiny">
        fetched {new Date(physical.fetchedAt).toLocaleString()}
        {stale ? " · serving last-good" : ""}
      </p>
    </section>
  );
}
