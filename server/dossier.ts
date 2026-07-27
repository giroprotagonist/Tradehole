import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import YahooFinance from "yahoo-finance2";
import { getEnergyQuotes, getOptionsChain, getStockQuote } from "./market";
import { getVolatilityReport } from "./volatility";
import { getAuthStatus, getPortfolio } from "./etrade";
import { getPhysicalMarkets } from "./physical";
import { buildDecisionIntel } from "./intel";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const QUOTE_SUMMARY_MODULES = [
  "assetProfile",
  "summaryDetail",
  "defaultKeyStatistics",
  "financialData",
  "calendarEvents",
  "recommendationTrend",
  "upgradeDowngradeHistory",
  "earnings",
  "earningsHistory",
  "earningsTrend",
  "institutionOwnership",
  "majorHoldersBreakdown",
  "insiderTransactions",
  "price",
  "quoteType",
] as const;

type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

async function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await p };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function dataDir(): string {
  if (process.env.TRADEHOLE_DATA_DIR) return process.env.TRADEHOLE_DATA_DIR;
  return path.join(os.homedir(), "Library", "Application Support", "Tradehole");
}

function readIvSnapshots(symbol: string): unknown {
  try {
    const p = path.join(dataDir(), "iv-snapshots", `${symbol.toUpperCase()}.json`);
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    return { error: String(err) };
  }
}

function compactJson(value: unknown, maxLen = 180_000): string {
  const text = JSON.stringify(value, (_k, v) => {
    if (typeof v === "bigint") return v.toString();
    if (v instanceof Date) return v.toISOString();
    return v;
  }, 2);
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}\n… [truncated ${text.length - maxLen} chars]`;
}

function section(title: string, body: string): string {
  return `\n## ${title}\n\n${body.trim()}\n`;
}

async function fetchAllOptions(symbol: string): Promise<unknown> {
  const first = await getOptionsChain(symbol);
  const expiries = first.expirationDates;
  const chains = [];
  for (const expiry of expiries) {
    try {
      const chain =
        expiry === first.selectedExpiry ? first : await getOptionsChain(symbol, expiry);
      chains.push({
        expiry: chain.selectedExpiry,
        underlyingPrice: chain.underlyingPrice,
        calls: chain.calls,
        puts: chain.puts,
      });
    } catch (err) {
      chains.push({ expiry, error: String(err) });
    }
  }
  return { expirationDates: expiries, chains };
}

async function fetchHistory(symbol: string, years: number): Promise<unknown> {
  const period1 = new Date();
  period1.setUTCFullYear(period1.getUTCFullYear() - years);
  const chart = await yahooFinance.chart(symbol, {
    period1,
    interval: "1d",
  });
  const quotes = (chart.quotes ?? []).map((q) => ({
    date: q.date instanceof Date ? q.date.toISOString().slice(0, 10) : q.date,
    open: q.open,
    high: q.high,
    low: q.low,
    close: q.close,
    volume: q.volume,
    adjclose: q.adjclose,
  }));
  return {
    meta: chart.meta,
    quoteCount: quotes.length,
    quotes,
  };
}

export type DossierResult = {
  symbol: string;
  generatedAt: string;
  text: string;
  byteLength: number;
  sources: Record<string, "ok" | "error">;
};

export async function buildLlmDossier(symbolRaw: string): Promise<DossierResult> {
  const symbol = symbolRaw.toUpperCase();
  const generatedAt = new Date().toISOString();

  const [
    quote,
    quoteSummary,
    insights,
    recommendations,
    history5y,
    history1yWeekly,
    allOptions,
    volatility,
    energy,
    physical,
    decisionIntel,
    portfolio,
    fundamentalsAnnual,
    fundamentalsQuarterly,
    searchHits,
  ] = await Promise.all([
    settle(getStockQuote(symbol)),
    settle(
      yahooFinance.quoteSummary(
        symbol,
        { modules: [...QUOTE_SUMMARY_MODULES] },
        { validateResult: false },
      ),
    ),
    settle(yahooFinance.insights(symbol)),
    settle(yahooFinance.recommendationsBySymbol(symbol)),
    settle(fetchHistory(symbol, 5)),
    settle(
      yahooFinance.chart(symbol, {
        period1: new Date(Date.now() - 365 * 86400000 * 2),
        interval: "1wk",
      }),
    ),
    settle(fetchAllOptions(symbol)),
    settle(
      getVolatilityReport(symbol, {
        focusStrike: 46,
        focusType: "call",
        focusExpiry: "2026-09-18",
      }),
    ),
    settle(getEnergyQuotes()),
    settle(getPhysicalMarkets()),
    settle(buildDecisionIntel(symbol)),
    settle(
      (async () => {
        const status = getAuthStatus();
        if (!status.authorized) return { authorized: false, status };
        const pf = await getPortfolio();
        return { authorized: true, status, portfolio: pf };
      })(),
    ),
    settle(
      yahooFinance.fundamentalsTimeSeries(symbol, {
        period1: "2018-01-01",
        type: "annual",
        module: "all",
      } as never),
    ),
    settle(
      yahooFinance.fundamentalsTimeSeries(symbol, {
        period1: "2022-01-01",
        type: "quarterly",
        module: "all",
      } as never),
    ),
    settle(yahooFinance.search(symbol, { quotesCount: 10, newsCount: 25 })),
  ]);

  const ivSnapshots = readIvSnapshots(symbol);

  const sources: Record<string, "ok" | "error"> = {
    quote: quote.ok ? "ok" : "error",
    quoteSummary: quoteSummary.ok ? "ok" : "error",
    insights: insights.ok ? "ok" : "error",
    recommendations: recommendations.ok ? "ok" : "error",
    history5y: history5y.ok ? "ok" : "error",
    historyWeekly: history1yWeekly.ok ? "ok" : "error",
    optionsAllExpiries: allOptions.ok ? "ok" : "error",
    volatility: volatility.ok ? "ok" : "error",
    energy: energy.ok ? "ok" : "error",
    physicalMarkets: physical.ok ? "ok" : "error",
    decisionIntel: decisionIntel.ok ? "ok" : "error",
    etradePortfolio: portfolio.ok ? "ok" : "error",
    fundamentalsAnnual: fundamentalsAnnual.ok ? "ok" : "error",
    fundamentalsQuarterly: fundamentalsQuarterly.ok ? "ok" : "error",
    searchNews: searchHits.ok ? "ok" : "error",
    ivSnapshots: "ok",
  };

  const parts: string[] = [];
  parts.push(`# Tradehole LLM Dossier — ${symbol}`);
  parts.push("");
  parts.push(`GeneratedAt: ${generatedAt}`);
  parts.push(`Source: Tradehole local aggregator (Yahoo Finance delayed + E*TRADE + derived vol)`);
  parts.push(
    `Purpose: Exhaustive context packet for external LLM analysis. Treat market data as delayed/unofficial; E*TRADE section is live account data when authorized.`,
  );
  parts.push("");
  parts.push("### Source status");
  parts.push(compactJson(sources));

  parts.push(
    section(
      "1. Live quote",
      quote.ok ? compactJson(quote.value) : `ERROR: ${quote.error}`,
    ),
  );

  parts.push(
    section(
      "2. Company profile, statistics, financials summary, earnings, ownership, insider activity (quoteSummary)",
      quoteSummary.ok ? compactJson(quoteSummary.value) : `ERROR: ${quoteSummary.error}`,
    ),
  );

  parts.push(
    section(
      "3. Yahoo insights / significant developments / SEC report links",
      insights.ok ? compactJson(insights.value) : `ERROR: ${insights.error}`,
    ),
  );

  parts.push(
    section(
      "4. Peer recommendations (similar symbols)",
      recommendations.ok
        ? compactJson(recommendations.value)
        : `ERROR: ${recommendations.error}`,
    ),
  );

  parts.push(
    section(
      "5. Search + recent news headlines",
      searchHits.ok ? compactJson(searchHits.value) : `ERROR: ${searchHits.error}`,
    ),
  );

  parts.push(
    section(
      "6. Energy context (WTI / Brent futures via Yahoo) — paper market",
      energy.ok ? compactJson(energy.value) : `ERROR: ${energy.error}`,
    ),
  );

  parts.push(
    section(
      "6b. PHYSICAL MARKETS (leading indicators) — VLCC TD3C ME-China + EIA Europe Brent Spot vs Brent futures",
      physical.ok
        ? [
            compactJson(physical.value),
            "",
            "INTERPRETATION HINT: If TD3C Worldscale/TCE is extreme while equity options IV or oil futures look calm,",
            "the physical tanker/crude complex may already be in crisis and paper markets are lagging.",
            "EIA Europe Brent Spot ≠ Platts Dated Brent, but spot-vs-futures spread still flags physical tightness.",
          ].join("\n")
        : `ERROR: ${physical.error}`,
    ),
  );

  parts.push(
    section(
      "6c. DECISION INTEL PACK — crack spreads, FRO options smart-money, IRONSIGHT theater OSINT, targeted news (Bataan/New York ARG, Kharg, Hormuz, war risk, Cape diversions, FFA mentions)",
      decisionIntel.ok
        ? [
            compactJson(decisionIntel.value, 450_000),
            "",
            "Use decisionHints + gaps together: what we can prove vs what still requires paid AIS/Platts/Baltic FFA/war-risk feeds.",
          ].join("\n")
        : `ERROR: ${decisionIntel.error}`,
    ),
  );

  parts.push(
    section(
      "7. Derived volatility report (ATM IV, HV, skew, term structure, smile, position focus $46 call)",
      volatility.ok ? compactJson(volatility.value) : `ERROR: ${volatility.error}`,
    ),
  );

  parts.push(
    section(
      "8. Local ATM IV daily snapshots (for IV rank history)",
      compactJson(ivSnapshots),
    ),
  );

  parts.push(
    section(
      "9. Full options chains — ALL listed expiries (calls + puts with IV, OI, volume, bid/ask)",
      allOptions.ok ? compactJson(allOptions.value, 400_000) : `ERROR: ${allOptions.error}`,
    ),
  );

  parts.push(
    section(
      "10. Daily OHLCV history (~5 years)",
      history5y.ok ? compactJson(history5y.value, 350_000) : `ERROR: ${history5y.error}`,
    ),
  );

  parts.push(
    section(
      "11. Weekly chart history (~2 years)",
      history1yWeekly.ok
        ? compactJson({
            meta: history1yWeekly.value.meta,
            quotes: (history1yWeekly.value.quotes ?? []).map((q) => ({
              date: q.date instanceof Date ? q.date.toISOString().slice(0, 10) : q.date,
              open: q.open,
              high: q.high,
              low: q.low,
              close: q.close,
              volume: q.volume,
              adjclose: q.adjclose,
            })),
          })
        : `ERROR: ${history1yWeekly.error}`,
    ),
  );

  parts.push(
    section(
      "12. Fundamentals time series — annual",
      fundamentalsAnnual.ok
        ? compactJson(fundamentalsAnnual.value, 200_000)
        : `ERROR: ${fundamentalsAnnual.error}`,
    ),
  );

  parts.push(
    section(
      "13. Fundamentals time series — quarterly",
      fundamentalsQuarterly.ok
        ? compactJson(fundamentalsQuarterly.value, 200_000)
        : `ERROR: ${fundamentalsQuarterly.error}`,
    ),
  );

  parts.push(
    section(
      "14. E*TRADE account portfolio / P&L (includes FRO and other holdings when authorized)",
      portfolio.ok ? compactJson(portfolio.value) : `ERROR: ${portfolio.error}`,
    ),
  );

  parts.push(
    section(
      "15. Analysis instructions for receiving LLM",
      [
        "You are analyzing Frontline plc (FRO) tanker equity/options context.",
        "Use ALL sections above. Prefer E*TRADE marks for the user's actual positions.",
        "Call out: spot vs strikes, DTE, IV vs HV, skew/term structure, oil complex (WTI/Brent),",
        "PHYSICAL leading indicators (VLCC TD3C ME→China WS/TCE, EIA Brent spot vs Brent futures),",
        "crack spreads (RB/HO vs WTI), FRO options put/call + IV term structure,",
        "IRONSIGHT OSINT (ships/flights/news/telegram/polymarket/fires) and targeted ARG/Kharg/Hormuz/war-risk/Cape news,",
        "earnings/calendar, ownership/insider flows, news/sigdevs, and peer names.",
        "Emphasize when physical tanker/crude prints diverge from lagging futures/equity options.",
        "Explicitly separate confirmed free-data signals from paid-data gaps (Platts Dtd, Baltic FFA, live AIS waiting lists, insurer war-risk tape).",
        "Be explicit about data delays and any ERROR sections.",
        "End with concrete risks, catalysts, and position-management considerations for the $46 calls if present.",
      ].join("\n"),
    ),
  );

  const text = parts.join("\n");
  return {
    symbol,
    generatedAt,
    text,
    byteLength: Buffer.byteLength(text, "utf8"),
    sources,
  };
}
