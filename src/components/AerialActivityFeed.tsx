import type { IsraelStrikeTells } from "../types";

type AerialEvent = NonNullable<
  IsraelStrikeTells["inputs"]["aerialEvents"]
>[number];

function formatMinute(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function stateClass(to: string): string {
  if (to === "live") return "live";
  if (to === "dark") return "dark";
  if (to === "landed") return "landed";
  if (to === "followed") return "followed";
  return "unknown";
}

function eventLine(ev: AerialEvent): string {
  const kind = ev.kind === "mil" ? ev.acType || "mil" : ev.kind;
  const from = ev.from ? ev.from.toUpperCase() : "NEW";
  const to = ev.to.toUpperCase();
  const detail = ev.detail ? ` · ${ev.detail}` : "";
  return `${ev.hex} · ${kind} · ${from} → ${to}${detail}`;
}

type Props = {
  events: AerialEvent[];
  churnSummary?: string | null;
};

/** Minute-level asset lifecycle strip — tanker/AWACS state transitions. */
export function AerialActivityFeed({ events, churnSummary }: Props) {
  if (events.length === 0 && !churnSummary) return null;

  return (
    <div className="aerial-activity-feed">
      <div className="aerial-activity-head">
        <p className="eyebrow">Asset activity · lifecycle</p>
        {churnSummary ? (
          <p className="aerial-churn-line" title="In-box Levant tanker states">
            AER-01: {churnSummary}
          </p>
        ) : null}
      </div>
      {events.length > 0 ? (
        <ul className="aerial-activity-list">
          {events.slice(0, 16).map((ev) => (
            <li key={ev.id} className={`aerial-activity-row ${stateClass(ev.to)}`}>
              <span className={`aerial-state-badge ${stateClass(ev.to)}`}>
                {ev.to.toUpperCase()}
              </span>
              <span className="aerial-activity-text">{eventLine(ev)}</span>
              {ev.ageSec != null && ev.to === "dark" ? (
                <span className="aerial-activity-age">
                  dark{" "}
                  {ev.ageSec >= 60
                    ? `${Math.round(ev.ageSec / 60)}m`
                    : `${ev.ageSec}s`}
                </span>
              ) : null}
              <time className="aerial-activity-time" dateTime={ev.at}>
                {formatMinute(ev.at)}
              </time>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted tiny">No transitions this session yet — watching hexes.</p>
      )}
    </div>
  );
}
