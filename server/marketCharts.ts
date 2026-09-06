import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export type ChartRange = "1d" | "1w" | "1m" | "3m" | "1y";

export type MarketChartPoint = {
  ts: string;
  close: number;
};

export type MarketChartSeries = {
  key: string;
  symbol: string;
  label: string;
  unit: string;
  priceDigits: number;
  points: MarketChartPoint[];
  last: number | null;
  change: number | null;
  changePercent: number | null;
  error?: string;
};

export type MarketChartsPayload = {
  range: ChartRange;
  fetchedAt: string;
  cached: boolean;
  series: MarketChartSeries[];
};

const CHART_DEFS: Array<{
  key: string;
  symbol: string;
  label: string;
  unit: string;
  priceDigits: number;
}> = [
  { key: "fro", symbol: "FRO", label: "FRO spot", unit: "", priceDigits: 2 },
  {
    key: "ho",
    symbol: "HO=F",
    label: "Diesel / ULSD (HO=F)",
    unit: "/gal",
    priceDigits: 3,
  },
  { key: "wti", symbol: "CL=F", label: "WTI (CL=F)", unit: "/bbl", priceDigits: 2 },
  { key: "brent", symbol: "BZ=F", label: "Brent (BZ=F)", unit: "/bbl", priceDigits: 2 },
];

const RANGE_CONFIG: Record<
  ChartRange,
  { days: number; interval: "5m" | "30m" | "1d"; ttlMs: number }
> = {
  "1d": { days: 1, interval: "5m", ttlMs: 45_000 },
  "1w": { days: 7, interval: "30m", ttlMs: 5 * 60_000 },
  "1m": { days: 30, interval: "1d", ttlMs: 30 * 60_000 },
  "3m": { days: 90, interval: "1d", ttlMs: 60 * 60_000 },
  "1y": { days: 365, interval: "1d", ttlMs: 60 * 60_000 },
};

type CacheEntry = { at: number; payload: MarketChartsPayload };

const cache = new Map<string, CacheEntry>();

export function parseChartRange(raw: unknown): ChartRange {
  const s = String(raw ?? "1y").toLowerCase();
  if (s === "1d" || s === "1w" || s === "1m" || s === "3m" || s === "1y") return s;
  return "1y";
}

function cacheKey(range: ChartRange): string {
  return `bundle:${range}`;
}

async function fetchSymbolSeries(
  def: (typeof CHART_DEFS)[number],
  range: ChartRange,
): Promise<MarketChartSeries> {
  const cfg = RANGE_CONFIG[range];
  const period1 = new Date(Date.now() - (cfg.days + 2) * 86_400_000);
  try {
    const chart = await yahooFinance.chart(def.symbol, {
      period1,
      interval: cfg.interval,
    });
    const points: MarketChartPoint[] = (chart.quotes ?? [])
      .map((q) => {
        const close = Number(q.close);
        if (!Number.isFinite(close) || close <= 0) return null;
        const d = q.date instanceof Date ? q.date : new Date(q.date);
        return { ts: d.toISOString(), close };
      })
      .filter((p): p is MarketChartPoint => p != null)
      .sort((a, b) => a.ts.localeCompare(b.ts));

    const cutoff = new Date(Date.now() - cfg.days * 86_400_000).toISOString();
    const trimmed = points.filter((p) => p.ts >= cutoff);
    const series = trimmed.length >= 2 ? trimmed : points;

    const first = series[0]?.close ?? null;
    const last = series.at(-1)?.close ?? null;
    const change = first != null && last != null ? last - first : null;
    const changePercent =
      first != null && last != null && first !== 0 ? ((last - first) / first) * 100 : null;

    return {
      key: def.key,
      symbol: def.symbol,
      label: def.label,
      unit: def.unit,
      priceDigits: def.priceDigits,
      points: series,
      last,
      change,
      changePercent,
    };
  } catch (err) {
    return {
      key: def.key,
      symbol: def.symbol,
      label: def.label,
      unit: def.unit,
      priceDigits: def.priceDigits,
      points: [],
      last: null,
      change: null,
      changePercent: null,
      error: String(err),
    };
  }
}

export async function getMarketCharts(rangeRaw: unknown): Promise<MarketChartsPayload> {
  const range = parseChartRange(rangeRaw);
  const key = cacheKey(range);
  const cfg = RANGE_CONFIG[range];
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < cfg.ttlMs) {
    return { ...hit.payload, cached: true };
  }

  const series = await Promise.all(
    CHART_DEFS.map((def) => fetchSymbolSeries(def, range)),
  );
  const payload: MarketChartsPayload = {
    range,
    fetchedAt: new Date().toISOString(),
    cached: false,
    series,
  };
  cache.set(key, { at: Date.now(), payload });
  return payload;
}
