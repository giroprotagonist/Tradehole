import { computeOiDeltas } from "./deltaOi";
import { buildGexProfile } from "./gex";
import { froWtiCorrelation } from "./correlation";
import { impliedMoveForExpiry } from "./impliedMove";
import { fetchBdtiSeries } from "./bdti";
import { computeIvRank } from "./ivRank";
import { getOptionsChain, getStockQuote } from "../market";
import {
  etradeMarketAvailable,
  etradeOptionQuoteSymbol,
  getEtradeRawQuotes,
} from "../etradeMarket";

export type FocusPrint = {
  label: string;
  expiry: string;
  strike: number;
  type: "call" | "put";
  last: number | null;
  bid: number | null;
  ask: number | null;
  spreadPct: number | null;
  osiKey: string | null;
  note: string;
};

export type StrategyAction = {
  action: "add" | "trim" | "hold" | "unknown";
  summary: string;
  bullets: string[];
};

export type StrategyIntel = {
  symbol: string;
  generatedAt: string;
  spot: number | null;
  oiDeltas: ReturnType<typeof computeOiDeltas>;
  ivRank: Awaited<ReturnType<typeof computeIvRank>>;
  gex: Awaited<ReturnType<typeof buildGexProfile>>;
  correlation: Awaited<ReturnType<typeof froWtiCorrelation>>;
  impliedMove: Awaited<ReturnType<typeof impliedMoveForExpiry>>;
  bdti: Awaited<ReturnType<typeof fetchBdtiSeries>>;
  focusPrints: FocusPrint[];
  action: StrategyAction;
  gexCsv: string;
};

async function focusPrints(symbol: string, spot: number | null): Promise<FocusPrint[]> {
  const specs = [
    { expiry: "2026-08-21", strike: 40, type: "call" as const, label: "Aug21 $40c" },
    { expiry: "2026-08-21", strike: 45, type: "call" as const, label: "Aug21 $45c" },
    { expiry: "2026-09-18", strike: 46, type: "call" as const, label: "Sep18 $46c" },
    { expiry: "2026-08-21", strike: 55, type: "put" as const, label: "Aug21 $55p" },
  ];

  const byExpiry = new Map<string, Awaited<ReturnType<typeof getOptionsChain>>>();
  for (const s of specs) {
    if (!byExpiry.has(s.expiry)) {
      try {
        byExpiry.set(s.expiry, await getOptionsChain(symbol, s.expiry));
      } catch {
        /* skip */
      }
    }
  }

  const out: FocusPrint[] = [];
  for (const s of specs) {
    const chain = byExpiry.get(s.expiry);
    const side = s.type === "call" ? chain?.calls : chain?.puts;
    const row = side?.find((c) => Math.abs(c.strike - s.strike) < 0.01);
    let last = row?.lastPrice ?? null;
    let bid = row?.bid ?? null;
    let ask = row?.ask ?? null;
    let osi = row?.contractSymbol ?? null;

    if (etradeMarketAvailable() && row) {
      try {
        const key = etradeOptionQuoteSymbol(
          symbol,
          s.expiry,
          s.type,
          s.strike,
        );
        const raw = (await getEtradeRawQuotes([key])) as {
          QuoteResponse?: { QuoteData?: unknown };
        };
        const rows = Array.isArray(raw.QuoteResponse?.QuoteData)
          ? raw.QuoteResponse!.QuoteData
          : raw.QuoteResponse?.QuoteData
            ? [raw.QuoteResponse.QuoteData]
            : [];
        const q = rows[0] as Record<string, unknown> | undefined;
        const all = (q?.All ?? q?.all ?? {}) as Record<string, unknown>;
        if (typeof all.lastTrade === "number") last = all.lastTrade;
        else if (typeof all.lastPrice === "number") last = all.lastPrice;
        if (typeof all.bid === "number") bid = all.bid;
        if (typeof all.ask === "number") ask = all.ask;
        osi = key;
      } catch {
        /* keep chain prints */
      }
    }

    const spreadPct =
      bid != null && ask != null && ask > 0 && (bid + ask) / 2 > 0
        ? ((ask - bid) / ((ask + bid) / 2)) * 100
        : null;

    let note = "Last = exchange last print when available; wide spreads are common OTM.";
    if (last != null && ask != null && ask > last * 1.35) {
      note = `Ask $${ask.toFixed(2)} is well above last $${last.toFixed(2)} — treat ask as fishing until traded.`;
    } else if (last != null) {
      note = `Last print $${last.toFixed(2)} is the honest mark anchor.`;
    }

    out.push({
      label: s.label,
      expiry: s.expiry,
      strike: s.strike,
      type: s.type,
      last,
      bid,
      ask,
      spreadPct,
      osiKey: osi,
      note,
    });
  }

  void spot;
  return out;
}

function decide(intel: Omit<StrategyIntel, "action" | "gexCsv">): StrategyAction {
  const callDeltas = intel.oiDeltas.filter((d) => d.type === "call");
  const sumDelta = callDeltas.reduce((s, d) => s + (d.deltaOiDay ?? 0), 0);
  const hasPrior = callDeltas.some((d) => d.oiPrevDay != null);
  const opening =
    hasPrior &&
    callDeltas.filter((d) => (d.deltaOiDay ?? 0) >= 500).length >= 1;
  const flatVolume =
    callDeltas.some(
      (d) =>
        (d.volumeLatest ?? 0) >= 500 &&
        d.deltaOiDay != null &&
        Math.abs(d.deltaOiDay) < 200,
    );
  const ivUsable =
    intel.ivRank.ivRank != null &&
    (intel.ivRank.sufficientFor52w || intel.ivRank.sampleDays >= 20);
  const ivOk =
    !ivUsable
      ? null
      : intel.ivRank.ivRank! < 60
        ? true
        : intel.ivRank.ivRank! > 80
          ? false
          : null;

  const bullets: string[] = [];
  bullets.push(
    hasPrior
      ? `Focus call ΔOI (day): ${callDeltas.map((d) => `${d.label} ${d.deltaOiDay ?? "—"}`).join("; ")}`
      : "ΔOI prior-day baseline not ready — need another session of SQLite history.",
  );
  bullets.push(
    intel.ivRank.ivRank != null
      ? `IV Rank ${intel.ivRank.ivRank.toFixed(0)}% over ${intel.ivRank.sampleDays} local days${ivUsable ? "" : " (informational only)"} (${intel.ivRank.windowNote})`
      : intel.ivRank.windowNote,
  );
  bullets.push(`GEX regime: ${intel.gex.regime} — ${intel.gex.regimeNote}`);
  bullets.push(
    `FRO–WTI ρ30=${intel.correlation.pearson30?.toFixed(2) ?? "—"} · ${intel.correlation.note}`,
  );
  bullets.push(
    `Sep18 ATM implied move ${intel.impliedMove.impliedMovePct?.toFixed(1) ?? "—"}% — ${intel.impliedMove.note}`,
  );
  bullets.push(intel.bdti.biasNote);

  if (!hasPrior) {
    return {
      action: "hold",
      summary:
        "HOLD — ΔOI needs tomorrow's open comparison. Do not size up solely on today's volume until prior-day OI lands in SQLite.",
      bullets,
    };
  }

  if (opening && ivOk === true) {
    return {
      action: "add",
      summary:
        "ADD bias — call OI rising (opening) with provisional IV Rank < 60%. Consider 1–2 on a pullback only; respect live risk.",
      bullets,
    };
  }

  if (flatVolume || ivOk === false) {
    return {
      action: "trim",
      summary:
        "TRIM bias — volume looks like day-trade / or IV Rank rich. Prefer selling strength on 1–2 of 4, keep a lottery stub.",
      bullets,
    };
  }

  if (opening) {
    return {
      action: "hold",
      summary:
        "HOLD / lean long — OI suggests opening interest, but IV Rank is mid/unknown. Wait for cleaner pullback before adding.",
      bullets,
    };
  }

  void sumDelta;
  return {
    action: "unknown",
    summary: "INCONCLUSIVE — mixed ΔOI / IV signals. Default HOLD until clearer OI / IV skew.",
    bullets,
  };
}

export async function buildStrategyIntel(symbol = "FRO"): Promise<StrategyIntel> {
  const sym = symbol.toUpperCase();
  const [quote, oiDeltas, ivRank, gex, correlation, impliedMove, bdti] =
    await Promise.all([
      getStockQuote(sym),
      Promise.resolve(computeOiDeltas(sym)),
      computeIvRank(sym),
      buildGexProfile(sym),
      froWtiCorrelation(sym),
      impliedMoveForExpiry(sym, "2026-09-18"),
      fetchBdtiSeries(),
    ]);

  const prints = await focusPrints(sym, quote.price);
  const base = {
    symbol: sym,
    generatedAt: new Date().toISOString(),
    spot: quote.price,
    oiDeltas,
    ivRank,
    gex,
    correlation,
    impliedMove,
    bdti,
    focusPrints: prints,
  };
  const action = decide(base);
  return { ...base, action, gexCsv: gex.csv };
}

export function strategyIntelMarkdown(intel: StrategyIntel): string {
  const lines = [
    "STRATEGY INTEL (prescriptive pack)",
    `generated=${intel.generatedAt} spot=${intel.spot ?? "—"}`,
    "",
    `ACTION: ${intel.action.action.toUpperCase()}`,
    intel.action.summary,
    ...intel.action.bullets.map((b) => `- ${b}`),
    "",
    "ΔOI (open interest change)",
    ...intel.oiDeltas.map(
      (d) =>
        `- ${d.label}: OI ${d.oiPrevDay ?? "—"} → ${d.oiLatest ?? "—"} (Δday ${d.deltaOiDay ?? "—"}, Δsession ${d.deltaOiSession ?? "—"}) vol=${d.volumeLatest ?? "—"} signal=${d.signal}`,
    ),
    "",
    `IV Rank: ${intel.ivRank.ivRank?.toFixed(1) ?? "—"}% · %ile ${intel.ivRank.ivPercentile?.toFixed(1) ?? "—"} · ATM ${intel.ivRank.atmIvPct?.toFixed(1) ?? "—"}% (call ${intel.ivRank.atmCallIvPct?.toFixed(1) ?? "—"} / put ${intel.ivRank.atmPutIvPct?.toFixed(1) ?? "—"}) · days=${intel.ivRank.sampleDays}`,
    intel.ivRank.windowNote,
    "",
    `GEX: regime=${intel.gex.regime} aggregateNet=${Math.round(intel.gex.aggregateNetGex)} flip≈${intel.gex.flipStrikeNearSpot ?? "—"}`,
    intel.gex.regimeNote,
    ...intel.gex.byExpiry.map(
      (e) =>
        `- ${e.expiry}: netGex=${Math.round(e.totalNetGex)} flip=${e.flipStrike ?? "—"} (${e.maxPainNote})`,
    ),
    "",
    `Correlation FRO vs WTI: ρ30=${intel.correlation.pearson30?.toFixed(3) ?? "—"} ρ5=${intel.correlation.pearson5?.toFixed(3) ?? "—"}`,
    `1d rets FRO=${intel.correlation.froReturn1d != null ? (intel.correlation.froReturn1d * 100).toFixed(2) + "%" : "—"} WTI=${intel.correlation.oilReturn1d != null ? (intel.correlation.oilReturn1d * 100).toFixed(2) + "%" : "—"}`,
    intel.correlation.note,
    "",
    `Implied move Sep18: ${intel.impliedMove.impliedMovePct?.toFixed(2) ?? "—"}% ($${intel.impliedMove.impliedMoveDollars?.toFixed(2) ?? "—"}) ATM $${intel.impliedMove.atmStrike ?? "—"}`,
    intel.impliedMove.note,
    "",
    `BDTI: ${intel.bdti.latest ? `${intel.bdti.latest.value} @ ${intel.bdti.latest.date}` : "—"} · 5d ${intel.bdti.changePct5d?.toFixed(1) ?? "—"}% · bias=${intel.bdti.structuralBias}`,
    intel.bdti.biasNote,
    "",
    "Focus prints (last/bid/ask)",
    ...intel.focusPrints.map(
      (p) =>
        `- ${p.label}: last=${p.last ?? "—"} bid=${p.bid ?? "—"} ask=${p.ask ?? "—"} spread%=${p.spreadPct?.toFixed(0) ?? "—"} · ${p.note}`,
    ),
  ];
  return lines.join("\n");
}
