import type { PlaybookConfig, QualityGateResult } from "./types";

export type GateQuote = {
  bid: number | null;
  ask: number | null;
  last: number | null;
};

/** US equity RTH rough check in America/New_York (no holiday calendar). */
export function isUsEquityRth(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  if (weekday === "Sat" || weekday === "Sun") return false;
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

export function evaluateQualityGates(opts: {
  config: PlaybookConfig;
  action: string;
  quote: GateQuote | null;
  debitToday: number;
  now?: Date;
}): QualityGateResult {
  const { config, action, quote, debitToday } = opts;
  const now = opts.now ?? new Date();
  const blockedBy: string[] = [];
  const inRth = isUsEquityRth(now);

  const bid = quote?.bid ?? null;
  const ask = quote?.ask ?? null;
  let width: number | null = null;
  let spreadPct: number | null = null;
  if (bid != null && ask != null && ask > 0) {
    width = ask - bid;
    const mid = (ask + bid) / 2;
    spreadPct = mid > 0 ? (width / mid) * 100 : null;
  }

  if (action === "add") {
    if (config.gates.rthOnlyForAdd && !inRth) {
      blockedBy.push("ADD only during RTH");
    }
    if (spreadPct != null && spreadPct > config.gates.maxSpreadPct) {
      blockedBy.push(
        `Spread ${spreadPct.toFixed(0)}% > ${config.gates.maxSpreadPct}%`,
      );
    }
    if (width != null && width > config.gates.maxWidth) {
      blockedBy.push(
        `Width $${width.toFixed(2)} > $${config.gates.maxWidth.toFixed(2)}`,
      );
    }
    if (ask != null && debitToday + ask * 100 > config.gates.maxDebitPerDay) {
      blockedBy.push(
        `Daily debit cap $${config.gates.maxDebitPerDay} (used ~$${debitToday.toFixed(0)})`,
      );
    }
    if (bid == null && ask == null) {
      blockedBy.push("No bid/ask on focus contract");
    }
  }

  return {
    ok: blockedBy.length === 0,
    blockedBy,
    spreadPct,
    width,
    inRth,
    debitToday,
  };
}
