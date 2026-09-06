import { useCallback, useEffect, useState } from "react";
import { fmtMoney, fmtPct, signedClass } from "../lib/format";
import {
  fetchMarketCharts,
  type ChartRange,
  type MarketChartSeries,
} from "../services/api";

const RANGES: Array<{ id: ChartRange; label: string }> = [
  { id: "1d", label: "1D" },
  { id: "1w", label: "1W" },
  { id: "1m", label: "1M" },
  { id: "3m", label: "3M" },
  { id: "1y", label: "1Y" },
];

const CHART_COLORS: Record<string, { stroke: string; fill: string }> = {
  fro: { stroke: "#7eb6ff", fill: "rgba(126, 182, 255, 0.28)" },
  ho: { stroke: "#c4a35a", fill: "rgba(196, 163, 90, 0.32)" },
  wti: { stroke: "#3dba7a", fill: "rgba(61, 186, 122, 0.24)" },
  brent: { stroke: "#b892e8", fill: "rgba(184, 146, 232, 0.22)" },
};

function MountainChart({
  series,
  range,
}: {
  series: MarketChartSeries;
  range: ChartRange;
}) {
  const pts = series.points;
  if (pts.length < 2) {
    return (
      <p className="muted tiny market-chart-empty">
        {series.error ? `Unavailable — ${series.error}` : "Not enough history yet"}
      </p>
    );
  }

  const closes = pts.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const w = 400;
  const h = 120;
  const padX = 2;
  const padY = 6;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;
  const colors = CHART_COLORS[series.key] ?? CHART_COLORS.fro;

  const coords = pts.map((p, i) => {
    const x = padX + (i / (pts.length - 1)) * innerW;
    const y = padY + innerH - ((p.close - min) / span) * innerH;
    return { x, y };
  });

  const linePath = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(2)},${c.y.toFixed(2)}`)
    .join(" ");
  const areaPath = `${linePath} L${coords.at(-1)!.x.toFixed(2)},${(padY + innerH).toFixed(2)} L${coords[0]!.x.toFixed(2)},${(padY + innerH).toFixed(2)} Z`;
  const gradId = `mc-${series.key}-${range}`;

  return (
    <svg
      className="market-mountain-chart"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`${series.label} ${range} chart`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colors.fill} />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={colors.stroke}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function ChartCard({ series, range }: { series: MarketChartSeries; range: ChartRange }) {
  const up = (series.change ?? 0) >= 0;
  const digits = series.priceDigits;

  return (
    <article className={`market-chart-card market-chart-${series.key}`}>
      <div className="market-chart-head">
        <div>
          <p className="eyebrow">{series.label}</p>
          <p className="market-chart-price">
            {series.last != null ? (
              <>
                ${fmtMoney(series.last, digits)}
                {series.unit ? <span className="energy-unit">{series.unit}</span> : null}
              </>
            ) : (
              "—"
            )}
          </p>
        </div>
        {series.changePercent != null && (
          <p className={`market-chart-change ${signedClass(series.change)}`}>
            {up && series.change != null && series.change > 0 ? "+" : ""}
            {series.change != null ? fmtMoney(series.change, digits) : "—"} (
            {fmtPct(series.changePercent)})
          </p>
        )}
      </div>
      <MountainChart series={series} range={range} />
      <p className="muted tiny market-chart-meta">
        {series.points.length} pts · Yahoo {series.symbol}
      </p>
    </article>
  );
}

export function MarketChartsPanel() {
  const [range, setRange] = useState<ChartRange>("1y");
  const [series, setSeries] = useState<MarketChartSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [cached, setCached] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchMarketCharts(range);
      setSeries(data.series);
      setFetchedAt(data.fetchedAt);
      setCached(data.cached);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="panel market-charts-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Price history</p>
          <h2>Market charts</h2>
          <p className="feed-meta muted tiny">
            Yahoo daily / intraday
            {fetchedAt ? ` · ${new Date(fetchedAt).toLocaleTimeString()}` : ""}
            {cached ? " · cached" : ""}
          </p>
        </div>
        <div className="market-chart-range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              className={range === r.id ? "ghost active" : "ghost"}
              onClick={() => setRange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {loading && series.length === 0 ? (
        <p className="muted">Loading charts…</p>
      ) : (
        <div className="market-charts-grid">
          {series.map((s) => (
            <ChartCard key={s.key} series={s} range={range} />
          ))}
        </div>
      )}

      <p className="muted tiny market-charts-note">
        HO=F is NY Harbor ULSD wholesale futures (not retail pump diesel). EIA on-highway
        retail (~$2.70/gal) includes taxes, markup, and lags wholesale by weeks.
      </p>
    </section>
  );
}
