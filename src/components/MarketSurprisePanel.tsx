import { useCallback, useEffect, useState } from "react";
import { staleServeText } from "../lib/format";
import { fetchMarketSurprise } from "../services/api";
import type { MarketSurprise } from "../types";

function edgeClass(edgePp: number | null): string {
  if (edgePp == null) return "ms-edge muted";
  if (Math.abs(edgePp) < 8) return "ms-edge aligned";
  if (edgePp > 0) return "ms-edge under";
  return "ms-edge ahead";
}

function confClass(c: MarketSurprise["theses"][0]["confidence"]): string {
  return `ms-conf ${c}`;
}

export function MarketSurprisePanel() {
  const [data, setData] = useState<MarketSurprise | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = useCallback(async (force = false) => {
    try {
      const next = await fetchMarketSurprise(force);
      setData(next);
      setError(null);
    } catch (err) {
      setData((current) => {
        if (!current) setError(String(err));
        return current;
      });
    }
  }, []);

  useEffect(() => {
    void refresh(false);
    const id = window.setInterval(() => void refresh(false), 90_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  return (
    <section className="panel market-surprise-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Reality − Market</p>
          <h2>Market Surprise</h2>
          <p className="muted tiny">
            Edge = Reality% − Market% · explainable theses · AIS is Layer-3 gap
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
            onClick={() => setShowRules((v) => !v)}
          >
            {showRules ? "Hide rules" : "Rules"}
          </button>
          <button type="button" className="ghost" onClick={() => void refresh(true)}>
            Refresh
          </button>
        </div>
      </div>

      {error && <p className="banner error">{error}</p>}
      {!data && !error && <p className="muted">Scoring surprise…</p>}

      {data && (
        <>
          <div className="ms-table-wrap">
            <table className="ms-table">
              <thead>
                <tr>
                  <th>Thesis</th>
                  <th>Reality</th>
                  <th>Market</th>
                  <th>Edge</th>
                  <th>Conf</th>
                </tr>
              </thead>
              <tbody>
                {data.theses.map((t) => {
                  const open = expandedId === t.id;
                  return (
                    <tr
                      key={t.id}
                      className={open ? "ms-row open" : "ms-row"}
                      onClick={() =>
                        setExpandedId((cur) => (cur === t.id ? null : t.id))
                      }
                    >
                      <td>
                        <strong>{t.label}</strong>
                        <br />
                        <span className="muted tiny">{t.verdict}</span>
                      </td>
                      <td className="mono">
                        {t.realityPct != null ? `${t.realityPct}%` : "—"}
                      </td>
                      <td className="mono">
                        {t.marketPct != null ? `${t.marketPct}%` : "—"}
                      </td>
                      <td className={edgeClass(t.edgePp)}>
                        {t.edgePp == null
                          ? "—"
                          : `${t.edgePp >= 0 ? "+" : ""}${t.edgePp.toFixed(0)}`}
                      </td>
                      <td>
                        <span className={confClass(t.confidence)}>
                          {t.confidence}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {data.theses.map((t) => {
            if (expandedId !== t.id) return null;
            const lines = t.contributions.filter(
              (c) => c.lit || c.side === "market",
            );
            return (
              <div key={`exp-${t.id}`} className="ms-explain">
                <p className="muted tiny">{t.question}</p>
                <p className="muted tiny">
                  Reality: {t.realitySource}
                  <br />
                  Market: {t.marketSource ?? "(none)"}
                </p>
                <ul className="theater-list df-signals">
                  {lines.length === 0 && (
                    <li className="muted tiny">No contributions listed.</li>
                  )}
                  {lines.map((c) => (
                    <li key={c.id}>
                      <strong>{c.side === "reality" ? "R" : "M"}</strong> ·{" "}
                      {c.label}{" "}
                      <span className="muted tiny">
                        {c.delta >= 0 ? "+" : ""}
                        {c.delta}
                      </span>
                      <br />
                      <span className="muted tiny">{c.detail}</span>
                    </li>
                  ))}
                </ul>
                {t.gaps.length > 0 && (
                  <>
                    <p className="eyebrow">Gaps</p>
                    <ul className="theater-samples">
                      {t.gaps.map((g) => (
                        <li key={g}>{g}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            );
          })}

          {showRules && (
            <div className="df-rules">
              <p className="eyebrow">Scoring rules</p>
              <ul className="theater-samples">
                {data.rulesSummary.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <p className="eyebrow">Notes</p>
              <ul className="theater-samples">
                {data.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="muted tiny">
            Click a row for contributions · asOf {data.asOf}
          </p>
        </>
      )}
    </section>
  );
}
