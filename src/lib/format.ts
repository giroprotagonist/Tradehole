export function staleServeText(d: {
  stale?: boolean;
  servedAgeMs?: number;
  rebuilding?: boolean;
} | null | undefined): string | null {
  if (!d?.stale) return null;
  const age =
    d.servedAgeMs == null
      ? ""
      : d.servedAgeMs >= 60_000
        ? ` · ${Math.round(d.servedAgeMs / 60_000)}m`
        : ` · ${Math.round(d.servedAgeMs / 1000)}s`;
  return `${d.rebuilding ? "last-good · rebuilding" : "last-good / stale"}${age}`;
}

/** Calendar lag badge for dated prints (PortWatch, BDTI, TD3C, EIA, TT). */
export function asOfLagBadge(opts: {
  asOf?: string | null;
  lagDays?: number | null;
  /** Warn at this lag (default 5). */
  warnDays?: number;
  /** Strong warn / stale reprint (default 8). */
  staleDays?: number;
}): { text: string; className: string } | null {
  const { asOf, lagDays: lagIn } = opts;
  const warnDays = opts.warnDays ?? 5;
  const staleDays = opts.staleDays ?? 8;
  let lag = lagIn ?? null;
  if (lag == null && asOf) {
    const t = Date.parse(`${asOf.slice(0, 10)}T12:00:00Z`);
    if (Number.isFinite(t)) {
      lag = Math.max(0, Math.round((Date.now() - t) / 86_400_000));
    }
  }
  if (lag == null) return null;
  if (lag >= staleDays) {
    return { text: `lag ~${lag}d · stale reprint`, className: "warn" };
  }
  if (lag >= warnDays) {
    return { text: `lag ~${lag}d`, className: "muted-warn" };
  }
  return { text: `lag ~${lag}d`, className: "live" };
}

export function fmtMbpd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(1)}M bpd`;
}

export function fmtMoney(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

export function fmtVol(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

export function signedClass(n: number | null | undefined): string {
  if (n == null || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}
