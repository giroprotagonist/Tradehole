import { getHistoryDb } from "../history/db";

export type FocusContract = {
  expiry: string;
  strike: number;
  type: "call" | "put";
  label: string;
};

export const STRATEGY_FOCUS: FocusContract[] = [
  { expiry: "2026-08-21", strike: 40, type: "call", label: "Aug21 $40c" },
  { expiry: "2026-08-21", strike: 45, type: "call", label: "Aug21 $45c" },
  { expiry: "2026-09-18", strike: 46, type: "call", label: "Sep18 $46c (position)" },
  { expiry: "2026-08-21", strike: 55, type: "put", label: "Aug21 $55p hedge" },
];

export type OiDeltaRow = {
  label: string;
  expiry: string;
  strike: number;
  type: "call" | "put";
  oiLatest: number | null;
  oiPrevDay: number | null;
  oiSessionOpen: number | null;
  deltaOiDay: number | null;
  deltaOiSession: number | null;
  volumeLatest: number | null;
  latestTs: string | null;
  prevDayTs: string | null;
  signal: "opening" | "closing" | "mixed" | "unknown";
  note: string;
};

function calendarDay(ts: string): string {
  return ts.slice(0, 10);
}

function signalFromDelta(
  deltaDay: number | null,
  volume: number | null,
): OiDeltaRow["signal"] {
  if (deltaDay == null) return "unknown";
  if (deltaDay >= 500) return "opening";
  if (deltaDay <= -500) return "closing";
  if (volume != null && volume >= 500 && Math.abs(deltaDay) < 200) return "mixed";
  if (deltaDay > 50) return "opening";
  if (deltaDay < -50) return "closing";
  return "mixed";
}

function latestOi(
  symbol: string,
  expiry: string,
  strike: number,
  type: string,
): { oi: number | null; volume: number | null; ts: string | null } {
  const db = getHistoryDb();
  if (!db) return { oi: null, volume: null, ts: null };
  const row = db
    .prepare(
      `SELECT open_interest, volume, ts FROM option_snapshots
       WHERE symbol = ? AND expiry = ? AND strike = ? AND type = ?
       ORDER BY ts DESC LIMIT 1`,
    )
    .get(symbol, expiry, strike, type) as
    | { open_interest: number | null; volume: number | null; ts: string }
    | undefined;
  if (!row) return { oi: null, volume: null, ts: null };
  return { oi: row.open_interest, volume: row.volume, ts: row.ts };
}

function oiOnOrBeforeDay(
  symbol: string,
  expiry: string,
  strike: number,
  type: string,
  day: string,
): { oi: number | null; ts: string | null } {
  const db = getHistoryDb();
  if (!db) return { oi: null, ts: null };
  const row = db
    .prepare(
      `SELECT open_interest, ts FROM option_snapshots
       WHERE symbol = ? AND expiry = ? AND strike = ? AND type = ?
         AND substr(ts,1,10) = ?
       ORDER BY ts DESC LIMIT 1`,
    )
    .get(symbol, expiry, strike, type, day) as
    | { open_interest: number | null; ts: string }
    | undefined;
  if (!row) return { oi: null, ts: null };
  return { oi: row.open_interest, ts: row.ts };
}

function firstOiOnDay(
  symbol: string,
  expiry: string,
  strike: number,
  type: string,
  day: string,
): { oi: number | null; ts: string | null } {
  const db = getHistoryDb();
  if (!db) return { oi: null, ts: null };
  const row = db
    .prepare(
      `SELECT open_interest, ts FROM option_snapshots
       WHERE symbol = ? AND expiry = ? AND strike = ? AND type = ?
         AND substr(ts,1,10) = ?
       ORDER BY ts ASC LIMIT 1`,
    )
    .get(symbol, expiry, strike, type, day) as
    | { open_interest: number | null; ts: string }
    | undefined;
  if (!row) return { oi: null, ts: null };
  return { oi: row.open_interest, ts: row.ts };
}

function previousDataDay(symbol: string, beforeDay: string): string | null {
  const db = getHistoryDb();
  if (!db) return null;
  const row = db
    .prepare(
      `SELECT substr(ts,1,10) AS d FROM option_snapshots
       WHERE symbol = ? AND substr(ts,1,10) < ?
       ORDER BY ts DESC LIMIT 1`,
    )
    .get(symbol, beforeDay) as { d?: string } | undefined;
  return row?.d ?? null;
}

export function computeOiDeltas(
  symbol = "FRO",
  focus: FocusContract[] = STRATEGY_FOCUS,
): OiDeltaRow[] {
  const sym = symbol.toUpperCase();
  return focus.map((f) => {
    const latest = latestOi(sym, f.expiry, f.strike, f.type);
    const today = latest.ts ? calendarDay(latest.ts) : new Date().toISOString().slice(0, 10);
    const prevDay = previousDataDay(sym, today);
    const prev = prevDay
      ? oiOnOrBeforeDay(sym, f.expiry, f.strike, f.type, prevDay)
      : { oi: null, ts: null };
    const sessionOpen = firstOiOnDay(sym, f.expiry, f.strike, f.type, today);

    const deltaOiDay =
      latest.oi != null && prev.oi != null ? latest.oi - prev.oi : null;
    const deltaOiSession =
      latest.oi != null && sessionOpen.oi != null
        ? latest.oi - sessionOpen.oi
        : null;

    let note = "";
    if (prev.oi == null) {
      note =
        "No prior-day OI in SQLite yet — keep app open through tomorrow's close for true ΔOI. Session ΔOI shown when available.";
    } else if (deltaOiDay != null && deltaOiDay >= 500) {
      note = "OI rising ≥500 — likely net opening / holding overnight.";
    } else if (deltaOiDay != null && deltaOiDay <= -500) {
      note = "OI falling ≥500 — likely closing / unwinding.";
    } else if (
      latest.volume != null &&
      latest.volume >= 500 &&
      deltaOiDay != null &&
      Math.abs(deltaOiDay) < 200
    ) {
      note = "High volume with flat OI — likely day-trading / closing same day.";
    } else {
      note = "Modest OI change — inconclusive alone.";
    }

    return {
      label: f.label,
      expiry: f.expiry,
      strike: f.strike,
      type: f.type,
      oiLatest: latest.oi,
      oiPrevDay: prev.oi,
      oiSessionOpen: sessionOpen.oi,
      deltaOiDay,
      deltaOiSession,
      volumeLatest: latest.volume,
      latestTs: latest.ts,
      prevDayTs: prev.ts,
      signal: signalFromDelta(deltaOiDay, latest.volume),
      note,
    };
  });
}
