import { useCallback, useEffect, useState } from "react";
import { asOfLagBadge, fmtMbpd, staleServeText } from "../lib/format";
import { fetchFroCatalyst } from "../services/api";
import type { FroBookAction, FroCatalystReport, FroCatalystStatus } from "../types";

function statusClass(s: FroCatalystStatus): string {
  return `fc-status ${s}`;
}

function regimeClass(regime: FroCatalystReport["regime"]): string {
  return `fc-regime ${regime}`;
}

function actionClass(a: FroBookAction): string {
  return `fc-action ${a}`;
}

function gapClass(gap: FroCatalystReport["physicalGap"]): string {
  return `fc-gap ${gap}`;
}

export function FroCatalystPanel() {
  const [data, setData] = useState<FroCatalystReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [showGaps, setShowGaps] = useState(false);

  const refresh = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const next = await fetchFroCatalyst(force);
      setData(next);
      setError(null);
    } catch (err) {
      setData((current) => {
        if (!current) setError(String(err));
        return current;
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(false);
    const id = window.setInterval(() => void refresh(false), 120_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const lit = data?.catalysts.filter((c) => c.lit) ?? [];

  return (
    <section className="panel fro-catalyst-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Sep $46c forward stack</p>
          <h2>FRO catalyst watch</h2>
          <p className="muted tiny">
            Hormuz transits · TD3C/BDTI · deal crush · physical vs fear gap
          </p>
        </div>
        <div className="theater-actions">
          {staleServeText(data) && (
            <span className="pill warn" title={data?.degradedReason ?? undefined}>
              {staleServeText(data)}
            </span>
          )}
          <button
            type="button"
            className="ghost"
            onClick={() => setShowMap((v) => !v)}
          >
            {showMap ? "Hide map" : "Action map"}
          </button>
          <button type="button" className="ghost" onClick={() => void refresh(true)} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && <p className="banner error">{error}</p>}
      {loading && !data && !error && (
        <p className="muted">Scoring FRO catalysts…</p>
      )}
      {!loading && !data && !error && (
        <p className="muted">No catalyst data yet — hit Refresh.</p>
      )}

      {data && (
        <>
          <div className="fc-head-row">
            <span className={regimeClass(data.regime)}>{data.regimeLabel}</span>
            <span className={actionClass(data.bookAction)}>
              {data.bookAction.toUpperCase()}
            </span>
            <span className={gapClass(data.physicalGap)}>
              physical · {data.physicalGap}
            </span>
          </div>

          <p className="theater-read">{data.bookSummary}</p>
          <p className="muted tiny">{data.verdict}</p>

          <div className="fc-metrics">
            <div className="fc-metric">
              <p className="eyebrow">Hormuz (PortWatch)</p>
              <p className="fc-metric-val">
                {data.inputs.hormuzTotal ?? "—"}
                <span className="muted tiny">
                  {" "}
                  / {data.inputs.hormuzTanker ?? "—"} tk
                </span>
              </p>
              <p className="muted tiny">
                as of {data.inputs.hormuzDate ?? "—"}
                {(() => {
                  const b = asOfLagBadge({
                    asOf: data.inputs.hormuzDate,
                    lagDays: data.inputs.hormuzLagDays,
                  });
                  return b ? (
                    <span className={`as-of-badge ${b.className}`}>
                      {" "}
                      · {b.text}
                    </span>
                  ) : null;
                })()}
              </p>
            </div>
            <div className="fc-metric emphasize">
              <p className="eyebrow">TT Hormuz flow</p>
              <p className="fc-metric-val">
                {data.inputs.ttFlowMbpd != null
                  ? fmtMbpd(data.inputs.ttFlowMbpd)
                  : "—"}
              </p>
              <p className="muted tiny">
                {data.inputs.ttFlowWindow ?? "TankerTrackers"}
                {data.inputs.ttFlowHormuzMbpd != null
                  ? ` · ${fmtMbpd(data.inputs.ttFlowHormuzMbpd)} via Hormuz`
                  : ""}
                {(() => {
                  const b = asOfLagBadge({
                    asOf: data.inputs.ttFlowDate,
                    lagDays: data.inputs.ttFlowLagDays,
                    warnDays: 3,
                  });
                  return b ? (
                    <span className={`as-of-badge ${b.className}`}>
                      {" "}
                      · post {data.inputs.ttFlowDate ?? "—"} · {b.text}
                    </span>
                  ) : (
                    data.inputs.ttFlowDate && ` · post ${data.inputs.ttFlowDate}`
                  );
                })()}
              </p>
            </div>
            <div className="fc-metric">
              <p className="eyebrow">TD3C WS</p>
              <p className="fc-metric-val">
                {data.inputs.td3cWs != null ? `WS ${data.inputs.td3cWs}` : "—"}
              </p>
              <p className="muted tiny">
                {(() => {
                  const b = asOfLagBadge({
                    asOf: data.inputs.td3cAsOf ?? undefined,
                    lagDays: data.inputs.td3cLagDays,
                  });
                  return b ? (
                    <span className={`as-of-badge ${b.className}`}>{b.text}</span>
                  ) : (
                    `lag ${data.inputs.td3cLagDays ?? "—"}d`
                  );
                })()}
              </p>
            </div>
            <div className="fc-metric">
              <p className="eyebrow">BDTI 5d</p>
              <p className="fc-metric-val">
                {data.inputs.bdti5dPct != null
                  ? `${data.inputs.bdti5dPct >= 0 ? "+" : ""}${data.inputs.bdti5dPct.toFixed(1)}%`
                  : "—"}
              </p>
              <p className="muted tiny">
                as of {data.inputs.bdtiDate ?? "—"}
                {(() => {
                  const b = asOfLagBadge({
                    asOf: data.inputs.bdtiDate,
                    lagDays: data.inputs.bdtiLagDays,
                  });
                  return b ? (
                    <span className={`as-of-badge ${b.className}`}>
                      {" "}
                      · {b.text}
                    </span>
                  ) : null;
                })()}
                {" · "}
                lottery edge{" "}
                {data.inputs.froLotteryEdgePp != null
                  ? `${data.inputs.froLotteryEdgePp >= 0 ? "+" : ""}${data.inputs.froLotteryEdgePp.toFixed(0)}pp`
                  : "—"}
              </p>
            </div>
            {(data.inputs.td34Ws != null || data.inputs.td34Tce != null) && (
              <div className="fc-metric">
                <p className="eyebrow">TD34 Oman → China</p>
                <p className="fc-metric-val">
                  {data.inputs.td34Ws != null ? `WS ${data.inputs.td34Ws}` : "—"}
                </p>
                <p className="muted tiny">
                  TCE{" "}
                  {data.inputs.td34Tce != null
                    ? `$${Math.round(data.inputs.td34Tce).toLocaleString()}/d`
                    : "—"}
                  {" · Baltic reprint (not Clarksons inside-Hormuz)"}
                </p>
              </div>
            )}
            <div className="fc-metric">
              <p className="eyebrow">Ceasefire mkt</p>
              <p className="fc-metric-val">
                {data.inputs.ceasefireYesPct != null
                  ? `${data.inputs.ceasefireYesPct.toFixed(0)}%`
                  : "—"}
              </p>
              <p className="muted tiny">deal {data.inputs.dealLevel ?? "—"}</p>
            </div>
          </div>

          <p className="eyebrow">Catalysts ({lit.length} lit)</p>
          <ul className="fc-catalyst-list">
            {data.catalysts.map((c) => (
              <li key={c.id} className={c.lit ? "fc-card lit" : "fc-card"}>
                <div className="fc-card-head">
                  <span className={statusClass(c.status)}>{c.status}</span>
                  <strong>{c.label}</strong>
                  <span className={`fc-hint ${c.bookHint}`}>{c.bookHint}</span>
                </div>
                {c.metric && <p className="mono tiny">{c.metric}</p>}
                <p className="muted tiny">{c.read}</p>
              </li>
            ))}
          </ul>

          <p className="eyebrow">Watch next</p>
          <ol className="theater-samples fc-watch">
            {data.watchNext.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ol>

          {showMap && (
            <div className="fc-action-map">
              <p className="eyebrow">Book action map</p>
              <table className="fc-map-table">
                <thead>
                  <tr>
                    <th>If you see…</th>
                    <th>Then</th>
                  </tr>
                </thead>
                <tbody>
                  {data.actionMap.map((row) => (
                    <tr key={row.trigger}>
                      <td>{row.trigger}</td>
                      <td>{row.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button
            type="button"
            className="ghost tiny fc-gaps-toggle"
            onClick={() => setShowGaps((v) => !v)}
          >
            {showGaps ? "Hide gaps" : "Data gaps"}
          </button>
          {showGaps && (
            <ul className="theater-samples">
              {data.gaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
              <li className="muted tiny">{data.inputs.portwatchLagNote}</li>
            </ul>
          )}

          <p className="muted tiny">asOf {data.asOf}</p>
        </>
      )}
    </section>
  );
}
