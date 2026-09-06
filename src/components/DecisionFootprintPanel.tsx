import { useCallback, useEffect, useState } from "react";
import { staleServeText } from "../lib/format";
import { fetchDecisionFootprint } from "../services/api";
import type { DecisionFootprint } from "../types";

function bandClass(band: DecisionFootprint["band"]): string {
  switch (band) {
    case "imminent":
      return "df-band imminent";
    case "execution_prep":
      return "df-band execution";
    case "decision_being_made":
      return "df-band decision";
    case "talks_deteriorating":
      return "df-band deteriorating";
    default:
      return "df-band alive";
  }
}

export function DecisionFootprintPanel() {
  const [data, setData] = useState<DecisionFootprint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);

  const refresh = useCallback(async (force = false) => {
    try {
      const next = await fetchDecisionFootprint(force);
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

  const lit = data?.signals.filter((s) => s.lit) ?? [];

  return (
    <section className="panel decision-footprint-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Primary decision aid</p>
          <h2>Decision Footprint</h2>
          <p className="muted tiny">
            Diplomatic · execution · market stack (0–100) · AIS is Layer-3 gap
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
      {!data && !error && <p className="muted">Scoring footprint…</p>}

      {data && (
        <>
          <div className="df-score-row">
            <p className="df-score">
              {data.score}
              <span className="muted tiny">/100</span>
            </p>
            <div>
              <span className={bandClass(data.band)}>{data.statusLabel}</span>
              {data.decisionMade && (
                <span className="pill warn" style={{ marginLeft: "0.35rem" }}>
                  decisionMade
                </span>
              )}
              {data.capped && (
                <span className="pill" style={{ marginLeft: "0.35rem" }}>
                  capped
                </span>
              )}
            </div>
          </div>

          <p className="muted tiny">
            T1 diplomatic {data.diplomaticLit} · T2 execution {data.executionLit} ·
            T3 market {data.marketLit}
          </p>
          <p className="theater-read">{data.verdict}</p>

          <ul className="theater-list df-signals">
            {lit.length === 0 && (
              <li className="muted tiny">No signals lit — diplomacy-alive baseline.</li>
            )}
            {lit.map((s) => (
              <li key={s.id}>
                <strong>T{s.tier}</strong> · {s.label}{" "}
                <span className="muted tiny">
                  +{s.points}
                  {s.at ? ` · ${s.at}` : ""}
                </span>
                <br />
                <span className="muted tiny">{s.detail}</span>
              </li>
            ))}
          </ul>

          <p className="eyebrow">Next triggers</p>
          <ul className="theater-samples">
            {data.nextTriggers.slice(0, 5).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>

          {showRules && (
            <div className="df-rules">
              <p className="eyebrow">Scoring rules</p>
              <ul className="theater-samples">
                {data.rulesSummary.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <p className="eyebrow">Gaps</p>
              <ul className="theater-samples">
                {data.gaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="muted tiny">asOf {data.asOf}</p>
        </>
      )}
    </section>
  );
}
