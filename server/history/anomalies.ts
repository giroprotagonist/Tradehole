import { getHistoryDb } from "./db";

type OptRow = {
  volume: number | null;
  open_interest: number | null;
  iv: number | null;
  expiry: string;
  strike: number;
  type: string;
};

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function dayKey(ts: string): string {
  return ts.slice(0, 10);
}

/** IV stored as decimal (0.56) or percent (56) — normalize to percent points. */
function toPct(v: number): number {
  return v > 0 && v <= 2 ? v * 100 : v;
}

/** Yahoo/E*TRADE floor or blank IVs — not usable as shock baselines. */
function isPlausibleIvPct(pct: number): boolean {
  return Number.isFinite(pct) && pct >= 8 && pct <= 250;
}

/**
 * Yahoo often stamps blank IVs as ~12.5% / ~25% floors (0.12500875 / 0.2500075).
 * Those are not real ATM books — treat as unusable shock baselines.
 */
function isFloorIvPct(pct: number): boolean {
  if (!Number.isFinite(pct)) return true;
  // Real FRO ATM lives ~45–70%. Yahoo blank stamps (~12.5% / ~25%) and other
  // cold baselines sit well below that — never use them for shock deltas.
  return pct < 30;
}

/**
 * Legacy / cold-start junk that still lives in SQLite after gating was added.
 * Used by digest + pack exports so old rows don't pollute AI context.
 */
export function isNoiseFlowEvent(e: {
  kind: string;
  message?: string;
  metrics?: Record<string, unknown> | null;
}): boolean {
  const m = e.metrics ?? {};
  if (e.kind === "oi_jump") {
    const prev = typeof m.prev === "number" ? m.prev : null;
    // First observation (prev 0 / missing) looks like a huge jump but is just cold start.
    if (prev == null || prev <= 0) return true;
    return false;
  }
  if (e.kind === "iv_shock") {
    let med: number | null =
      typeof m.median5 === "number" ? toPct(m.median5) : null;
    if (med == null) {
      const medMatch = String(e.message ?? "").match(/med5\s+([\d.]+)%/i);
      if (medMatch) {
        const parsed = Number(medMatch[1]);
        if (Number.isFinite(parsed)) med = parsed;
      }
    }
    // Current IV (metrics.iv or "…: 12.5% vs med5 …" in message).
    let now: number | null = typeof m.iv === "number" ? toPct(m.iv) : null;
    if (now == null && typeof m.nowPct === "number") now = toPct(m.nowPct);
    if (now == null) {
      const nowMatch = String(e.message ?? "").match(/:\s*([\d.]+)%\s+vs\s+med5/i);
      if (nowMatch) {
        const parsed = Number(nowMatch[1]);
        if (Number.isFinite(parsed)) now = parsed;
      }
    }
    if (med != null && (isFloorIvPct(med) || !isPlausibleIvPct(med))) return true;
    if (now != null && (isFloorIvPct(now) || !isPlausibleIvPct(now))) return true;
    const shock =
      typeof m.shockPts === "number"
        ? m.shockPts
        : typeof m.nowPct === "number" && typeof m.medPct === "number"
          ? Math.abs(m.nowPct - m.medPct)
          : now != null && med != null
            ? Math.abs(now - med)
            : null;
    // Explosive move off a thin/floor med5 — almost always feed artifact.
    if (med != null && shock != null && med < 40 && shock >= 30) return true;
    return false;
  }
  return false;
}

function insertEvent(opts: {
  ts: string;
  kind: string;
  symbol: string;
  expiry: string | null;
  strike: number | null;
  type: string | null;
  severity: "info" | "warn" | "critical";
  message: string;
  metrics: Record<string, unknown>;
  dedupeKey: string;
}): boolean {
  const database = getHistoryDb();
  if (!database) return false;
  try {
    database
      .prepare(
        `INSERT INTO flow_events
          (ts, kind, symbol, expiry, strike, type, severity, message, metrics_json, dedupe_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        opts.ts,
        opts.kind,
        opts.symbol,
        opts.expiry,
        opts.strike,
        opts.type,
        opts.severity,
        opts.message,
        JSON.stringify(opts.metrics),
        opts.dedupeKey,
      );
    return true;
  } catch {
    // UNIQUE dedupe_key — already alerted today
    return false;
  }
}

/**
 * Run after a successful history write. Returns number of new events inserted.
 */
export function detectAnomalies(symbol: string, ts: string): number {
  const database = getHistoryDb();
  if (!database) return 0;
  const day = dayKey(ts);
  let created = 0;

  const latest = database
    .prepare(
      `SELECT expiry, strike, type, volume, open_interest, iv
       FROM option_snapshots
       WHERE symbol = ? AND ts = ?`,
    )
    .all(symbol, ts) as OptRow[];

  for (const row of latest) {
    const hist = database
      .prepare(
        `SELECT volume, open_interest, iv FROM option_snapshots
         WHERE symbol = ? AND expiry = ? AND strike = ? AND type = ? AND ts < ?
         ORDER BY ts DESC LIMIT 5`,
      )
      .all(symbol, row.expiry, row.strike, row.type, ts) as Array<{
      volume: number | null;
      open_interest: number | null;
      iv: number | null;
    }>;

    const volNow = row.volume ?? 0;
    const volHist = hist
      .map((h) => h.volume)
      .filter((v): v is number => v != null && Number.isFinite(v));
    const volMed = median(volHist);
    const volThresh = Math.max(3 * (volMed ?? 0), 500);
    if (volNow >= volThresh && volNow > 0) {
      const ok = insertEvent({
        ts,
        kind: "volume_spike",
        symbol,
        expiry: row.expiry,
        strike: row.strike,
        type: row.type,
        severity: volNow >= 2000 ? "critical" : "warn",
        message: `Volume spike ${row.type} $${row.strike} ${row.expiry}: ${volNow} (thresh ${Math.round(volThresh)}${volMed != null ? `, med5 ${Math.round(volMed)}` : ""})`,
        metrics: { volume: volNow, threshold: volThresh, median5: volMed },
        dedupeKey: `${symbol}|volume_spike|${row.expiry}|${row.strike}|${row.type}|${day}`,
      });
      if (ok) created += 1;
    }

    const oiNow = row.open_interest;
    const oiPrev = hist[0]?.open_interest;
    // Skip cold-start: first observation with prev=0 looks like a huge "jump" but is just
    // Tradehole's first SQLite row for that contract, not a real OI opening print.
    if (
      oiNow != null &&
      oiPrev != null &&
      oiPrev > 0 &&
      oiNow - oiPrev >= 500
    ) {
      const ok = insertEvent({
        ts,
        kind: "oi_jump",
        symbol,
        expiry: row.expiry,
        strike: row.strike,
        type: row.type,
        severity: "warn",
        message: `OI jump ${row.type} $${row.strike} ${row.expiry}: ${oiPrev} → ${oiNow} (Δ${Math.round(oiNow - oiPrev)})`,
        metrics: { oi: oiNow, prev: oiPrev, delta: oiNow - oiPrev },
        dedupeKey: `${symbol}|oi_jump|${row.expiry}|${row.strike}|${row.type}|${day}`,
      });
      if (ok) created += 1;
    }

    const ivNow = row.iv;
    const ivHist = hist
      .map((h) => h.iv)
      .filter((v): v is number => v != null && Number.isFinite(v));
    const ivMed = median(ivHist);
    // Skip illiquid wings — wide bid/ask junk IVs create false shocks.
    const liquidEnough =
      (row.volume ?? 0) >= 100 || (row.open_interest ?? 0) >= 750;
    if (
      ivNow != null &&
      ivMed != null &&
      liquidEnough &&
      ivHist.length >= 3
    ) {
      const nowPct = toPct(ivNow);
      const medPct = toPct(ivMed);
      // Floor / junk on either side (Yahoo 12.5% prints vs a sane med5, or reverse).
      if (
        isFloorIvPct(medPct) ||
        isFloorIvPct(nowPct) ||
        !isPlausibleIvPct(nowPct) ||
        !isPlausibleIvPct(medPct)
      ) {
        continue;
      }
      const shock = Math.abs(nowPct - medPct);
      // Absolute ≥8 pts AND ≥20% relative move — ignore noise around a stable book.
      const relative = shock / medPct;
      if (shock >= 8 && relative >= 0.2) {
        const ok = insertEvent({
          ts,
          kind: "iv_shock",
          symbol,
          expiry: row.expiry,
          strike: row.strike,
          type: row.type,
          severity: shock >= 20 && relative >= 0.35 ? "critical" : "warn",
          message: `IV shock ${row.type} $${row.strike} ${row.expiry}: ${nowPct.toFixed(1)}% vs med5 ${medPct.toFixed(1)}% (Δ${shock.toFixed(1)} pts)`,
          metrics: {
            iv: ivNow,
            median5: ivMed,
            shockPts: shock,
            relative,
            nowPct,
            medPct,
          },
          dedupeKey: `${symbol}|iv_shock|${row.expiry}|${row.strike}|${row.type}|${day}`,
        });
        if (ok) created += 1;
      }
    }
  }

  // Put/call volume ratio vs prior calendar day total for same symbol
  const todayVol = database
    .prepare(
      `SELECT type, SUM(COALESCE(volume,0)) AS v
       FROM option_snapshots WHERE symbol = ? AND ts = ?
       GROUP BY type`,
    )
    .all(symbol, ts) as Array<{ type: string; v: number }>;
  const callVol = todayVol.find((r) => r.type === "call")?.v ?? 0;
  const putVol = todayVol.find((r) => r.type === "put")?.v ?? 0;
  const ratio = putVol > 0 ? callVol / putVol : callVol > 0 ? 99 : null;

  const priorDay = database
    .prepare(
      `SELECT substr(ts,1,10) AS d FROM option_snapshots
       WHERE symbol = ? AND substr(ts,1,10) < ?
       ORDER BY ts DESC LIMIT 1`,
    )
    .get(symbol, day) as { d?: string } | undefined;

  if (ratio != null && priorDay?.d) {
    const prior = database
      .prepare(
        `SELECT type, SUM(COALESCE(volume,0)) AS v
         FROM option_snapshots
         WHERE symbol = ? AND substr(ts,1,10) = ?
         GROUP BY type`,
      )
      .all(symbol, priorDay.d) as Array<{ type: string; v: number }>;
    const pCall = prior.find((r) => r.type === "call")?.v ?? 0;
    const pPut = prior.find((r) => r.type === "put")?.v ?? 0;
    const priorRatio = pPut > 0 ? pCall / pPut : pCall > 0 ? 99 : null;
    if (priorRatio != null && priorRatio > 0) {
      const shift = Math.abs(Math.log(ratio / priorRatio));
      if (shift >= Math.log(2) && callVol + putVol >= 1000) {
        const ok = insertEvent({
          ts,
          kind: "pc_ratio_shift",
          symbol,
          expiry: null,
          strike: null,
          type: null,
          severity: "info",
          message: `Call/put volume ratio shift: ${ratio.toFixed(2)} vs prior day ${priorRatio.toFixed(2)} (${priorDay.d})`,
          metrics: { ratio, priorRatio, callVol, putVol, priorDay: priorDay.d },
          dedupeKey: `${symbol}|pc_ratio_shift|${day}`,
        });
        if (ok) created += 1;
      }
    }
  }

  return created;
}
