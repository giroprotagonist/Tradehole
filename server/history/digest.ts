import {
  historyStatus,
  queryFlowEvents,
  queryOptionSeries,
  queryStockSeries,
} from "./query";

const FOCUS = {
  expiry: "2026-09-18",
  strike: 46,
  type: "call" as const,
};

function ivPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const pct = v > 0 && v <= 2 ? v * 100 : v;
  return `${pct.toFixed(1)}%`;
}

export function buildHistoryDigest(symbol = "FRO"): string {
  const status = historyStatus();
  const sym = symbol.toUpperCase();
  if (!status.enabled) {
    return [
      "HISTORY DIGEST",
      "History DB unavailable — no local SQLite snapshots yet.",
      status.error ? `Error: ${status.error}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const stock = queryStockSeries({
    symbol: sym,
    from: new Date(Date.now() - 20 * 86_400_000).toISOString(),
  });
  const focus = queryOptionSeries({
    symbol: sym,
    expiry: FOCUS.expiry,
    strike: FOCUS.strike,
    type: FOCUS.type,
    from: new Date(Date.now() - 20 * 86_400_000).toISOString(),
  });
  const flow = queryFlowEvents({ symbol: sym, days: 7, limit: 25 });

  const firstPx = stock.find((p) => p.price != null)?.price ?? null;
  const lastPx = [...stock].reverse().find((p) => p.price != null)?.price ?? null;
  const firstIv = focus.find((p) => p.iv != null)?.iv ?? null;
  const lastFocus = [...focus].reverse()[0];

  const spotPath =
    stock.length === 0
      ? "no stock snapshots yet"
      : `${stock.length} pts · ${firstPx ?? "—"} → ${lastPx ?? "—"} (≈20d window)`;

  const focusPath =
    focus.length === 0
      ? "no focus-contract snapshots yet (writes every ~5m while app is open)"
      : `${focus.length} pts · IV ${ivPct(firstIv)} → ${ivPct(lastFocus?.iv)} · last vol ${lastFocus?.volume ?? "—"} · OI ${lastFocus?.openInterest ?? "—"} · last ${lastFocus?.ts ?? "—"}`;

  const flowLines =
    flow.length === 0
      ? ["(no flow events in last 7d)"]
      : flow.slice(0, 12).map((e) => `- [${e.severity}] ${e.ts} ${e.kind}: ${e.message}`);

  return [
    "HISTORY DIGEST (local SQLite · Tradehole)",
    `symbol=${sym}`,
    `db: stockRows=${status.stockRows} optionRows=${status.optionRows} flowRows=${status.flowRows}`,
    `lastWrite=${status.lastWriteAt ?? "—"} reason=${status.lastWriteReason ?? "—"}`,
    "",
    "Spot path:",
    spotPath,
    "",
    `Focus ${FOCUS.expiry} $${FOCUS.strike} ${FOCUS.type}:`,
    focusPath,
    "",
    "Notable flow (7d, noise-filtered):",
    ...flowLines,
    "",
    "Open questions for the model:",
    "- Was unusual call volume opening (OI up) or closing (OI flat/down)?",
    "- Did IV compress or expand into the volume (seller vs buyer pressure)?",
    "- How did spot move in the 1–5 sessions after similar volume spikes in this history?",
    "- Ignore any residual cold-start OI (0→N) or floor-IV shocks if they appear — those are feed artifacts.",
  ].join("\n");
}
