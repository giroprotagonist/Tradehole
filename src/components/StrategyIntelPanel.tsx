import { useCallback, useEffect, useState } from "react";
import { getApiBase } from "../services/api";

type StrategyIntel = {
  generatedAt: string;
  spot: number | null;
  action: {
    action: string;
    summary: string;
    bullets: string[];
  };
  oiDeltas: Array<{
    label: string;
    oiLatest: number | null;
    oiPrevDay: number | null;
    deltaOiDay: number | null;
    deltaOiSession: number | null;
    volumeLatest: number | null;
    signal: string;
    note: string;
  }>;
  ivRank: {
    atmIvPct: number | null;
    atmCallIvPct?: number | null;
    atmPutIvPct?: number | null;
    ivRank: number | null;
    ivPercentile: number | null;
    sampleDays: number;
    low: number | null;
    high: number | null;
    windowNote: string;
    sufficientFor52w: boolean;
  };
  gex: {
    regime: string;
    regimeNote: string;
    aggregateNetGex: number;
    flipStrikeNearSpot: number | null;
    byExpiry: Array<{
      expiry: string;
      totalNetGex: number;
      flipStrike: number | null;
      maxPainNote: string;
    }>;
  };
  correlation: {
    pearson30: number | null;
    pearson5: number | null;
    froReturn1d: number | null;
    oilReturn1d: number | null;
    note: string;
  };
  impliedMove: {
    impliedMovePct: number | null;
    impliedMoveDollars: number | null;
    atmStrike: number | null;
    note: string;
  };
  bdti: {
    latest: { date: string; value: number } | null;
    changePct5d: number | null;
    structuralBias: string;
    biasNote: string;
  };
  focusPrints: Array<{
    label: string;
    last: number | null;
    bid: number | null;
    ask: number | null;
    spreadPct: number | null;
    note: string;
  }>;
};

type Props = { symbol?: string };

function pct(n: number | null | undefined, d = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(d)}%`;
}

function num(n: number | null | undefined, d = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(d);
}

export function StrategyIntelPanel({ symbol = "FRO" }: Props) {
  const [intel, setIntel] = useState<StrategyIntel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const base = await getApiBase();
      const res = await fetch(`${base}/api/strategy/${encodeURIComponent(symbol)}`);
      const data = (await res.json()) as StrategyIntel & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setIntel(data);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 120_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  async function downloadGex() {
    const base = await getApiBase();
    const a = document.createElement("a");
    a.href = `${base}/api/strategy/${encodeURIComponent(symbol)}/gex.csv`;
    a.download = `GEX_by_Strike_${symbol}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const actionClass =
    intel?.action.action === "add"
      ? "ok"
      : intel?.action.action === "trim"
        ? "error"
        : "";

  return (
    <section className="panel strategy-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Prescriptive · live + SQLite</p>
          <h2>Strategy intel</h2>
          <p className="muted tiny">
            ΔOI · IV Rank · GEX · FRO–WTI ρ · implied move · BDTI proxy
            {intel?.generatedAt
              ? ` · ${new Date(intel.generatedAt).toLocaleTimeString()}`
              : ""}
          </p>
        </div>
        <div className="oauth-actions compact">
          <button type="button" className="ghost" disabled={loading} onClick={() => void refresh()}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" className="ghost" onClick={() => void downloadGex()}>
            GEX CSV
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {intel && (
        <>
          <p className={`banner ${actionClass}`}>
            <strong>{intel.action.action.toUpperCase()}</strong> — {intel.action.summary}
          </p>
          <ul className="strategy-bullets">
            {intel.action.bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>

          <div className="strategy-grid">
            <div>
              <p className="eyebrow">ΔOI focus</p>
              <table className="strategy-table">
                <thead>
                  <tr>
                    <th>Contract</th>
                    <th>Δ day</th>
                    <th>Vol</th>
                    <th>Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {intel.oiDeltas.map((r) => (
                    <tr key={r.label}>
                      <td>{r.label}</td>
                      <td className="mono">{num(r.deltaOiDay, 0)}</td>
                      <td className="mono">{num(r.volumeLatest, 0)}</td>
                      <td>{r.signal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted tiny">{intel.oiDeltas[0]?.note}</p>
            </div>

            <div>
              <p className="eyebrow">IV Rank</p>
              <p className="strategy-metric">
                {pct(intel.ivRank.ivRank, 0)}{" "}
                <span className="muted">
                  · ATM {pct(intel.ivRank.atmIvPct, 1)}
                  {intel.ivRank.atmCallIvPct != null ||
                  intel.ivRank.atmPutIvPct != null
                    ? ` (c ${pct(intel.ivRank.atmCallIvPct ?? null, 0)} / p ${pct(intel.ivRank.atmPutIvPct ?? null, 0)})`
                    : ""}{" "}
                  · {intel.ivRank.sampleDays}d
                </span>
              </p>
              <p className="muted tiny">{intel.ivRank.windowNote}</p>
            </div>

            <div>
              <p className="eyebrow">GEX</p>
              <p className="strategy-metric">{intel.gex.regime.replace(/_/g, " ")}</p>
              <p className="muted tiny">
                net {num(intel.gex.aggregateNetGex, 0)} · flip ≈ $
                {intel.gex.flipStrikeNearSpot ?? "—"}
              </p>
              <p className="muted tiny">{intel.gex.regimeNote}</p>
            </div>

            <div>
              <p className="eyebrow">FRO vs WTI</p>
              <p className="strategy-metric">
                ρ30 {num(intel.correlation.pearson30, 2)}{" "}
                <span className="muted">ρ5 {num(intel.correlation.pearson5, 2)}</span>
              </p>
              <p className="muted tiny">
                1d FRO {pct((intel.correlation.froReturn1d ?? 0) * 100, 2)} · WTI{" "}
                {pct((intel.correlation.oilReturn1d ?? 0) * 100, 2)}
              </p>
              <p className="muted tiny">{intel.correlation.note}</p>
            </div>

            <div>
              <p className="eyebrow">Sep18 implied move</p>
              <p className="strategy-metric">
                {pct(intel.impliedMove.impliedMovePct, 1)}{" "}
                <span className="muted">
                  (${num(intel.impliedMove.impliedMoveDollars, 2)} · ATM $
                  {intel.impliedMove.atmStrike ?? "—"})
                </span>
              </p>
              <p className="muted tiny">{intel.impliedMove.note}</p>
            </div>

            <div>
              <p className="eyebrow">BDTI (FFA proxy)</p>
              <p className="strategy-metric">
                {intel.bdti.latest?.value ?? "—"}{" "}
                <span className="muted">
                  5d {pct(intel.bdti.changePct5d, 1)} · {intel.bdti.structuralBias}
                </span>
              </p>
              <p className="muted tiny">{intel.bdti.biasNote}</p>
            </div>
          </div>

          <div className="strategy-prints">
            <p className="eyebrow">Focus prints (last vs book)</p>
            <ul>
              {intel.focusPrints.map((p) => (
                <li key={p.label}>
                  <strong>{p.label}</strong> last {num(p.last, 2)} · bid {num(p.bid, 2)} · ask{" "}
                  {num(p.ask, 2)}
                  {p.spreadPct != null ? ` · spread ${pct(p.spreadPct, 0)}` : ""} —{" "}
                  <span className="muted">{p.note}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
