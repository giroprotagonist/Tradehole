import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchHistoryFlow,
  fetchHistoryHeatmap,
  fetchHistorySeries,
  fetchHistoryStatus,
  type FlowEventRow,
} from "../services/api";
import type { HistoryStatus } from "../types";

const FOCUS_STRIKES = [40, 45, 46, 50];
const DEFAULT_EXPIRY = "2026-09-18";

type Props = {
  symbol?: string;
};

function ivDisplay(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const pct = v > 0 && v <= 2 ? v * 100 : v;
  return `${pct.toFixed(1)}%`;
}

function Sparkline({
  values,
  stroke = "var(--accent)",
}: {
  values: Array<number | null>;
  stroke?: string;
}) {
  const pts = values
    .map((v, i) => (v != null && Number.isFinite(v) ? { i, v } : null))
    .filter((p): p is { i: number; v: number } => p != null);
  if (pts.length < 2) {
    return <p className="muted tiny">Need more snapshots…</p>;
  }
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = max - min || 1;
  const w = 320;
  const h = 64;
  const path = pts
    .map((p, idx) => {
      const x = (p.i / (values.length - 1 || 1)) * (w - 4) + 2;
      const y = h - 4 - ((p.v - min) / span) * (h - 8);
      return `${idx === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className="history-spark" viewBox={`0 0 ${w} ${h}`} role="img">
      <path d={path} fill="none" stroke={stroke} strokeWidth="2" />
    </svg>
  );
}

export function HistoryPanel({ symbol = "FRO" }: Props) {
  const [strike, setStrike] = useState(46);
  const [expiry, setExpiry] = useState(DEFAULT_EXPIRY);
  const [status, setStatus] = useState<HistoryStatus | null>(null);
  const [events, setEvents] = useState<FlowEventRow[]>([]);
  const [series, setSeries] = useState<
    Array<{
      ts: string;
      iv: number | null;
      volume: number | null;
      openInterest: number | null;
      spot: number | null;
    }>
  >([]);
  const [heatmap, setHeatmap] = useState<{
    ts: string | null;
    cells: Array<{
      strike: number;
      type: "call" | "put";
      volume: number | null;
      openInterest: number | null;
    }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [st, ser, flow, heat] = await Promise.all([
        fetchHistoryStatus(),
        fetchHistorySeries({
          symbol,
          expiry,
          strike,
          type: "call",
        }),
        fetchHistoryFlow({ symbol, days: 7 }),
        fetchHistoryHeatmap({ symbol, expiry }),
      ]);
      setStatus(st);
      setSeries(ser.series);
      setEvents(flow.events);
      setHeatmap({ ts: heat.ts, cells: heat.cells });
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, [symbol, expiry, strike]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const ivValues = useMemo(
    () =>
      series.map((p) => {
        if (p.iv == null) return null;
        return p.iv > 0 && p.iv <= 2 ? p.iv * 100 : p.iv;
      }),
    [series],
  );
  const volValues = useMemo(() => series.map((p) => p.volume), [series]);
  const spotValues = useMemo(() => series.map((p) => p.spot), [series]);

  const maxHeatVol = useMemo(() => {
    const vols = (heatmap?.cells ?? [])
      .map((c) => c.volume ?? 0)
      .filter((v) => v > 0);
    return Math.max(1, ...vols);
  }, [heatmap]);

  return (
    <section className="panel history-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Market memory</p>
          <h2>History & flow</h2>
          <p className="muted tiny">
            {status?.enabled
              ? `${status.optionRows} option rows · ${status.stockRows} stock · last write ${
                  status.lastWriteAt
                    ? new Date(status.lastWriteAt).toLocaleString()
                    : "—"
                }${status.lastWriteReason ? ` (${status.lastWriteReason})` : ""}`
              : status?.error
                ? `History disabled: ${status.error}`
                : "Building local SQLite memory…"}
          </p>
        </div>
        <button type="button" className="ghost" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="history-focus-chips">
        {FOCUS_STRIKES.map((s) => (
          <button
            key={s}
            type="button"
            className={strike === s ? "ghost active" : "ghost"}
            onClick={() => setStrike(s)}
          >
            ${s}c
          </button>
        ))}
        <input
          className="history-expiry"
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          title="Expiry YYYY-MM-DD"
        />
      </div>

      <div className="history-charts">
        <div>
          <p className="eyebrow">IV · ${strike} call</p>
          <Sparkline values={ivValues} stroke="#c4a35a" />
          <p className="muted tiny">
            Now {ivDisplay(series.at(-1)?.iv)} · {series.length} pts
          </p>
        </div>
        <div>
          <p className="eyebrow">Volume</p>
          <Sparkline values={volValues} stroke="#3dba7a" />
          <p className="muted tiny">Last {series.at(-1)?.volume ?? "—"}</p>
        </div>
        <div>
          <p className="eyebrow">Spot @ snapshot</p>
          <Sparkline values={spotValues} stroke="#7eb6ff" />
          <p className="muted tiny">Last {series.at(-1)?.spot ?? "—"}</p>
        </div>
      </div>

      <div className="history-heat">
        <p className="eyebrow">
          Flow map · {expiry}
          {heatmap?.ts ? ` · as of ${new Date(heatmap.ts).toLocaleTimeString()}` : ""}
        </p>
        <div className="history-heat-grid">
          {(heatmap?.cells ?? [])
            .filter((c) => c.type === "call")
            .map((c) => {
              const intensity = (c.volume ?? 0) / maxHeatVol;
              return (
                <div
                  key={`c-${c.strike}`}
                  className="history-heat-cell"
                  style={{
                    background: `rgba(196, 163, 90, ${0.08 + intensity * 0.55})`,
                  }}
                  title={`$${c.strike}c vol ${c.volume ?? 0} OI ${c.openInterest ?? 0}`}
                >
                  <span>{c.strike}</span>
                  <strong>{c.volume ?? 0}</strong>
                </div>
              );
            })}
        </div>
      </div>

      <div className="history-flow">
        <p className="eyebrow">Flow events · 7d</p>
        {events.length === 0 ? (
          <p className="muted tiny">No anomalies yet — keep the app open during the session.</p>
        ) : (
          <ul>
            {events.slice(0, 12).map((e) => (
              <li key={e.id} className={`flow-sev-${e.severity}`}>
                <span className="mono">{new Date(e.ts).toLocaleString()}</span>{" "}
                <span className="pill">{e.kind}</span> {e.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
