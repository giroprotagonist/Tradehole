import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchKineticRewind, stampKineticRewind } from "../services/api";
import type { KineticRewindReport, MideastTarget } from "../types";

function statusPills(data: KineticRewindReport | null): Array<{
  id: string;
  label: string;
  cls: string;
}> {
  if (!data) return [{ id: "load", label: "…", cls: "kr-pill unknown" }];
  const out: Array<{ id: string; label: string; cls: string }> = [];
  if (data.event?.confirmedByNews) {
    out.push({ id: "conf", label: "confirmed", cls: "kr-pill hot" });
  } else {
    out.push({ id: "quiet", label: "quiet", cls: "kr-pill quiet" });
  }
  if (data.corridorTells.length > 0) {
    out.push({
      id: "corr",
      label: `corridor soft · ${data.corridorTells.length}`,
      cls: "kr-pill warm",
    });
  }
  out.push({ id: "aer", label: "not High-go", cls: "kr-pill unknown" });
  return out;
}

function fmtKm(n: number): string {
  return `${n.toFixed(0)} km`;
}

function fmtHdg(deg: number | null): string {
  if (deg == null || !Number.isFinite(deg)) return "—";
  return `${Math.round(((deg % 360) + 360) % 360).toString().padStart(3, "0")}°`;
}

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "time unknown";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toDatetimeLocalValue(iso: string | null): string {
  const t = iso ? Date.parse(iso) : Date.now();
  const d = new Date(Number.isFinite(t) ? t : Date.now());
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(v: string): string {
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString();
}

export function KineticRewindPanel() {
  const [data, setData] = useState<KineticRewindReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [stampTime, setStampTime] = useState(() => toDatetimeLocalValue(null));
  const [stampHeadline, setStampHeadline] = useState("");
  const [stampFlash, setStampFlash] = useState<string | null>(null);

  const refresh = useCallback(async (force = false, target?: string) => {
    setLoading(true);
    try {
      const next = await fetchKineticRewind({
        target: target || undefined,
        refresh: force,
      });
      setData(next);
      setError(null);
      if (!target && next.event?.target.id) {
        setTargetId(next.event.target.id);
        if (next.event.eventAt) setStampTime(toDatetimeLocalValue(next.event.eventAt));
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(false);
    const id = window.setInterval(() => void refresh(false), 90_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const targets = data?.targets ?? [];
  const pills = statusPills(data);
  const event = data?.event ?? null;
  const hits = data?.hits ?? [];

  const grouped = useMemo(() => {
    const m = new Map<MideastTarget["country"], MideastTarget[]>();
    for (const t of targets) {
      const list = m.get(t.country) ?? [];
      list.push(t);
      m.set(t.country, list);
    }
    return m;
  }, [targets]);

  const stamp = async () => {
    const id = targetId || event?.target.id;
    if (!id) {
      setError("Pick a named target to stamp.");
      return;
    }
    try {
      await stampKineticRewind({
        targetId: id,
        eventAt: fromDatetimeLocal(stampTime),
        headline: stampHeadline.trim() || event?.headline || undefined,
        note: "confirmed by news",
      });
      setStampFlash("Stamped — later empty polls keep this");
      window.setTimeout(() => setStampFlash(null), 2200);
      await refresh(true, id);
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <section className="panel kinetic-rewind-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Confirmed kinetic · whole Mideast</p>
          <h2>Kinetic rewind</h2>
          <p className="muted tiny">
            Named-base wires → archive tankers/mil/AWACS ≤400 km · not Israel
            High-go
          </p>
        </div>
        <div className="theater-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => void refresh(true, targetId || undefined)}
            disabled={loading}
          >
            {loading ? "Rewinding…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && <p className="banner error">{error}</p>}
      {loading && !data && !error && (
        <p className="muted">Classifying named-base wires…</p>
      )}

      {data && (
        <>
          <div className="kr-head-row">
            {pills.map((p) => (
              <span key={p.id} className={p.cls}>
                {p.label}
              </span>
            ))}
          </div>

          <p className="theater-read">{data.read}</p>
          <p className="muted tiny">{data.honesty}</p>

          {event ? (
            <div className="kr-event">
              <p className="eyebrow">Event</p>
              <p className="kr-event-title">
                {event.target.label}
                <span className="muted tiny">
                  {" "}
                  · {event.target.country} · {event.target.note}
                </span>
              </p>
              <p className="mono tiny">
                {event.target.lat.toFixed(2)}N {event.target.lon.toFixed(2)}E
                {" · "}
                {fmtWhen(event.eventAt)}
                {event.timeKnown ? "" : " · window last 24h"}
                {event.actor ? ` · ${event.actor}` : ""}
                {event.confirmedByNews ? " · confirmed by news" : ""}
                {` · ${event.source}`}
              </p>
              {event.headline ? (
                <p className="muted tiny">{event.headline}</p>
              ) : null}
            </div>
          ) : (
            <p className="muted tiny">
              No confirmed named-base strike in wires or stamps. Stamp below if
              you have a wire.
            </p>
          )}

          <p className="eyebrow">
            Closest hexes ({hits.length}
            {data.corridorTells.length
              ? ` · ${data.corridorTells.length} corridor SOFT`
              : ""}
            )
          </p>
          {hits.length === 0 ? (
            <p className="muted tiny">
              {data.archiveOk
                ? "No tanker/mil/AWACS in archive within 400 km of the pin for this window."
                : "Archive query failed — osint-theater.db may be empty."}
            </p>
          ) : (
            <table className="kr-hits">
              <thead>
                <tr>
                  <th>Hex</th>
                  <th>Kind</th>
                  <th>Dist</th>
                  <th>Time</th>
                  <th>Hdg</th>
                </tr>
              </thead>
              <tbody>
                {hits.slice(0, 12).map((h) => (
                  <tr key={`${h.assetKey}-${h.ts}`}>
                    <td className="mono">
                      {h.assetKey.replace(/^hex:/i, "").slice(0, 8)}
                      {h.corridorTell ? (
                        <span className="kr-pill warm kr-inline">corridor</span>
                      ) : null}
                    </td>
                    <td>{h.kind}</td>
                    <td>{fmtKm(h.distKm)}</td>
                    <td className="muted tiny">{fmtWhen(h.ts)}</td>
                    <td>{fmtHdg(h.trackDeg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="eyebrow">Manual stamp</p>
          <p className="muted tiny">
            Pick a named pin and Rewind target — archive query does not need a
            stamp. Time + headline optional.
          </p>
          <div className="kr-stamp">
            <select
              value={targetId}
              onChange={(e) => {
                const id = e.target.value;
                setTargetId(id);
                if (id) void refresh(false, id);
              }}
              aria-label="Named target"
            >
              <option value="">Target…</option>
              {[...grouped.entries()].map(([country, list]) => (
                <optgroup key={country} label={country}>
                  {list.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                      {t.role === "context" ? " (context)" : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <input
              type="datetime-local"
              value={stampTime}
              onChange={(e) => setStampTime(e.target.value)}
              aria-label="Event time"
            />
            <input
              type="text"
              value={stampHeadline}
              onChange={(e) => setStampHeadline(e.target.value)}
              placeholder="Wire headline (optional)"
              aria-label="Headline"
            />
            <button type="button" className="ghost" onClick={() => void stamp()}>
              {stampFlash ?? "Stamp confirmed by news"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => void refresh(true, targetId || undefined)}
              disabled={!targetId}
              title="Rewind this pin from archive"
            >
              Rewind target
            </button>
          </div>

          {data.classified.filter((c) => c.confirmed).length > 0 ? (
            <>
              <p className="eyebrow">Classified wires</p>
              <ul className="theater-samples">
                {data.classified
                  .filter((c) => c.confirmed)
                  .slice(0, 5)
                  .map((c) => (
                    <li key={c.title} className="muted tiny">
                      {c.targets.map((t) => t.label).join(", ")} — {c.title}
                    </li>
                  ))}
              </ul>
            </>
          ) : null}

          <p className="muted tiny">asOf {data.asOf}</p>
        </>
      )}
    </section>
  );
}
