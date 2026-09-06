/**
 * Domestic politics / event-horizon chips for Bibi spoiler overlay.
 * Not a fire rule — judgment calendar only.
 */

export type PoliticsCalendarEvent = {
  id: string;
  label: string;
  /** ISO date YYYY-MM-DD (local Israel/desk day). */
  date: string;
  kind: "primary" | "talks" | "deadline" | "other";
  note: string;
  /** PAST/DISABLED events stay in archive but never surface on the chip. */
  status?: "active" | "past" | "disabled";
};

/** Static near-term desk horizons — edit as calendar moves. */
export const POLITICS_CALENDAR: PoliticsCalendarEvent[] = [
  {
    id: "hormuz-mou-sunday-2026-08",
    label: "US–Iran Hormuz MOU deadline",
    date: "2026-08-16",
    kind: "deadline",
    status: "past",
    note: "PAST / DISABLED (Aug 2026) — Sunday MOU diplomacy window is over. Do not watch Sunday clock or escalate on MOU chatter alone.",
  },
  {
    id: "likud-primary-2026-08",
    label: "Likud primary",
    date: "2026-08-17",
    kind: "primary",
    note: "Domestic political survival overlay — not a kinetic go gate. Watch fallout after results.",
  },
  {
    id: "rome-lebanon-sept",
    label: "Rome Israel–Lebanon round",
    date: "2026-09-01",
    kind: "talks",
    note: "Walkout arm DISABLED — September horizon only; do not invent same-day clock.",
  },
];

export type PoliticsCalendarChip = {
  asOf: string;
  upcoming: Array<
    PoliticsCalendarEvent & { daysUntil: number; urgency: "today" | "soon" | "ahead" }
  >;
  headline: string | null;
};

export function buildPoliticsCalendarChip(
  now = new Date(),
): PoliticsCalendarChip {
  const asOf = now.toISOString();
  const start = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const upcoming = POLITICS_CALENDAR.map((ev) => {
    const [y, m, d] = ev.date.split("-").map(Number);
    const evStart = Date.UTC(y, m - 1, d);
    const daysUntil = Math.round((evStart - start) / (24 * 60 * 60 * 1000));
    const urgency: "today" | "soon" | "ahead" =
      daysUntil <= 0 ? "today" : daysUntil <= 7 ? "soon" : "ahead";
    return { ...ev, daysUntil, urgency };
  })
    .filter(
      (ev) =>
        ev.status !== "past" &&
        ev.status !== "disabled" &&
        ev.daysUntil >= -1 &&
        ev.daysUntil <= 45,
    )
    .sort((a, b) => a.daysUntil - b.daysUntil);

  const next = upcoming[0] ?? null;
  const headline = next
    ? next.daysUntil <= 0
      ? `${next.label} · today — political overlay, not a go gate`
      : `${next.label} in ${next.daysUntil}d`
    : null;

  return { asOf, upcoming, headline };
}
