import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export type CorrelationReport = {
  symbol: string;
  oilSymbol: string;
  windowDays: number;
  samples: number;
  pearson30: number | null;
  pearson5: number | null;
  froReturn1d: number | null;
  oilReturn1d: number | null;
  note: string;
  series: Array<{ date: string; froRet: number; oilRet: number }>;
};

function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 5) return null;
  const x = xs.slice(-n);
  const y = ys.slice(-n);
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i]! - mx;
    const b = y[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den > 0 ? num / den : null;
}

async function dailyCloses(symbol: string, days: number): Promise<Array<{ date: string; close: number }>> {
  const period2 = new Date();
  const period1 = new Date(Date.now() - (days + 20) * 86_400_000);
  const chart = await yahooFinance.chart(symbol, {
    period1,
    period2,
    interval: "1d",
  });
  return (chart.quotes ?? [])
    .map((q) => ({
      date: (q.date instanceof Date ? q.date : new Date(q.date)).toISOString().slice(0, 10),
      close: Number(q.close),
    }))
    .filter((r) => Number.isFinite(r.close) && r.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function froWtiCorrelation(
  symbol = "FRO",
  oilSymbol = "CL=F",
  windowDays = 30,
): Promise<CorrelationReport> {
  const [fro, oil] = await Promise.all([
    dailyCloses(symbol, 90),
    dailyCloses(oilSymbol, 90),
  ]);
  const oilMap = new Map(oil.map((r) => [r.date, r.close]));
  const aligned: Array<{ date: string; fro: number; oil: number }> = [];
  for (const f of fro) {
    const o = oilMap.get(f.date);
    if (o != null) aligned.push({ date: f.date, fro: f.close, oil: o });
  }

  const rets: CorrelationReport["series"] = [];
  for (let i = 1; i < aligned.length; i++) {
    const a = aligned[i - 1]!;
    const b = aligned[i]!;
    rets.push({
      date: b.date,
      froRet: b.fro / a.fro - 1,
      oilRet: b.oil / a.oil - 1,
    });
  }

  const froR = rets.map((r) => r.froRet);
  const oilR = rets.map((r) => r.oilRet);
  const pearson30 = pearson(froR.slice(-windowDays), oilR.slice(-windowDays));
  const pearson5 = pearson(froR.slice(-5), oilR.slice(-5));
  const last = rets.at(-1);

  let note = "Need more overlapping daily bars.";
  if (pearson30 != null) {
    if (pearson30 >= 0.6) {
      note =
        "30d correlation still firm (≥0.6) — FRO may be lagging oil and can catch up.";
    } else if (pearson30 >= 0.3) {
      note =
        "30d correlation soft (0.3–0.6) — partial decoupling; size risk carefully.";
    } else {
      note =
        "30d correlation weak (<0.3) — FRO is decoupling from WTI; oil spike may not transmit.";
    }
  }

  return {
    symbol: symbol.toUpperCase(),
    oilSymbol,
    windowDays,
    samples: Math.min(windowDays, rets.length),
    pearson30,
    pearson5,
    froReturn1d: last?.froRet ?? null,
    oilReturn1d: last?.oilRet ?? null,
    note,
    series: rets.slice(-windowDays),
  };
}
