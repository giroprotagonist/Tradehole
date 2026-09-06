import { useCallback, useEffect, useRef, useState } from "react";
import {
  resumeAlarmAudio,
  startOrderAlarm,
  stopOrderAlarm,
} from "../lib/orderAlarmSound";
import {
  fetchDealAlarm,
  type DealAlarmEvent,
  type DealAlarmState,
} from "../services/api";

const POLL_MS = 30_000;
const SEEN_KEY = "tradehole.dealAlarm.seen";

/** Stable content key — mirrors server contentKey (no kind; classifier renames must not re-fire). */
function contentKey(e: DealAlarmEvent): string {
  const title = e.title
    .toLowerCase()
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/^[\s—–\-_|:·•.]+/, "")
    .replace(/\bnew:\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return e.link?.trim() || title;
}

/** Theme key — Black Sea HOLD must not re-fire on every RivieraMM rewrite in-session. */
function themeKey(e: DealAlarmEvent): string | null {
  if (e.kind === "black_sea_spillover") return "kind:black_sea_spillover";
  return null;
}

function loadSeen(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveSeen(ids: Set<string>): void {
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-300)));
  } catch {
    /* ignore */
  }
}

function markSeen(seen: Set<string>, e: DealAlarmEvent): void {
  seen.add(e.id);
  seen.add(contentKey(e));
  const theme = themeKey(e);
  if (theme) seen.add(theme);
}

function alreadySeen(seen: Set<string>, e: DealAlarmEvent): boolean {
  const theme = themeKey(e);
  return (
    seen.has(e.id) ||
    seen.has(contentKey(e)) ||
    (theme != null && seen.has(theme))
  );
}

function openExternal(href: string): void {
  if (window.tradehole?.openExternal) {
    void window.tradehole.openExternal(href);
  } else {
    window.open(href, "_blank", "noopener,noreferrer");
  }
}

export function DealWatchAlarm() {
  const [state, setState] = useState<DealAlarmState | null>(null);
  const [alert, setAlert] = useState<DealAlarmEvent | null>(null);
  const seenRef = useRef<Set<string>>(loadSeen());
  const primedRef = useRef(false);
  const titleRef = useRef(document.title);
  const flashRef = useRef<number | null>(null);

  const dismiss = useCallback(() => {
    setAlert(null);
    stopOrderAlarm();
    if (flashRef.current != null) {
      window.clearInterval(flashRef.current);
      flashRef.current = null;
    }
    document.title = titleRef.current;
  }, []);

  const fire = useCallback((next: DealAlarmEvent) => {
    setAlert(next);
    void startOrderAlarm();
    void window.tradehole?.alertOrderFill?.(next.severity === "critical");
    const label =
      next.action === "trim"
        ? "DEAL TRIM"
        : next.action === "buy"
          ? "DEAL BUY"
          : next.action === "red"
            ? "BATAAN L1 RED"
            : next.action === "hold"
              ? "DEAL HOLD"
              : "DEAL WATCH";
    try {
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        new Notification(label, {
          body: `${next.kind}: ${next.title.slice(0, 140)}`,
          requireInteraction: true,
          silent: true,
        });
      } else if (
        typeof Notification !== "undefined" &&
        Notification.permission === "default"
      ) {
        void Notification.requestPermission();
      }
    } catch {
      /* ignore */
    }
    titleRef.current = document.title;
    let on = false;
    if (flashRef.current != null) window.clearInterval(flashRef.current);
    flashRef.current = window.setInterval(() => {
      on = !on;
      document.title = on ? `📣 ${label}` : titleRef.current;
    }, 700);
  }, []);

  const tick = useCallback(async () => {
    try {
      const next = await fetchDealAlarm(true);
      setState(next);
      if (!primedRef.current) {
        for (const e of next.events) markSeen(seenRef.current, e);
        saveSeen(seenRef.current);
        primedRef.current = true;
        if (typeof Notification !== "undefined") {
          if (Notification.permission === "default") {
            void Notification.requestPermission();
          }
        }
        return;
      }
      const fresh = next.events
        .filter((e) => !alreadySeen(seenRef.current, e))
        .filter((e) => e.severity === "critical" || e.severity === "warn")
        .sort((a, b) => {
          const rank = (s: string) =>
            s === "critical" ? 0 : s === "warn" ? 1 : 2;
          return rank(a.severity) - rank(b.severity);
        });
      if (fresh[0]) {
        markSeen(seenRef.current, fresh[0]);
        saveSeen(seenRef.current);
        fire(fresh[0]);
        for (const e of fresh.slice(1)) markSeen(seenRef.current, e);
        saveSeen(seenRef.current);
      }
    } catch {
      /* ignore transient */
    }
  }, [fire]);

  useEffect(() => {
    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      window.clearInterval(id);
      stopOrderAlarm();
      if (flashRef.current != null) window.clearInterval(flashRef.current);
      document.title = titleRef.current;
    };
  }, [tick]);

  const level = state?.level ?? "quiet";
  const chipClass =
    level === "trim"
      ? "deal-watch-chip trim"
      : level === "buy" || level === "red"
        ? "deal-watch-chip buy"
        : level === "hold"
          ? "deal-watch-chip hold"
          : level === "watch"
            ? "deal-watch-chip watch"
            : "deal-watch-chip";

  const armedCount =
    state?.checklist.filter((c) => c.status === "armed").length ?? 0;

  return (
    <>
      {state && !alert && (
        <button
          type="button"
          className={chipClass}
          title={state.read}
          onClick={() => {
            void resumeAlarmAudio();
            void tick();
          }}
        >
          Deal watch · {level}
          {state.actionBias !== "none" ? ` · ${state.actionBias}` : ""}
          {armedCount ? ` · ${armedCount}/7` : ""} · {POLL_MS / 1000}s
        </button>
      )}

      {alert && (
        <div
          className={`fill-alarm-overlay ${
            alert.action === "trim"
              ? "deal-trim"
              : alert.action === "buy" || alert.action === "red"
                ? "deal-buy"
                : alert.action === "hold"
                  ? "deal-hold"
                  : "partial"
          }`}
          role="alertdialog"
          aria-modal="true"
          onClick={() => {
            void resumeAlarmAudio().then(() => void startOrderAlarm());
          }}
        >
          <div className="fill-alarm-card">
            <p className="fill-alarm-eyebrow">
              Deal + 7 blind-spot alarms
            </p>
            <h2 id="deal-alarm-title">
              {alert.action.toUpperCase()} · {alert.kind.replace(/_/g, " ")}
            </h2>
            <p className="fill-alarm-order">{alert.severity.toUpperCase()}</p>
            <p className="fill-alarm-detail">{alert.read}</p>
            <p className="fill-alarm-detail">{alert.title}</p>
            {state?.bataan?.moved ? (
              <p className="fill-alarm-detail">{state.bataan.read}</p>
            ) : null}
            <p className="fill-alarm-time">
              {new Date(alert.detectedAt).toLocaleString()} · {alert.source}
            </p>
            {state && state.checklist.some((c) => c.status === "armed") ? (
              <ul className="theater-list" style={{ textAlign: "left" }}>
                {state.checklist
                  .filter((c) => c.status === "armed")
                  .map((c) => (
                    <li key={c.id}>
                      <strong>{c.action}</strong> · {c.label}
                    </li>
                  ))}
              </ul>
            ) : null}
            <div className="theater-actions" style={{ marginTop: "0.75rem" }}>
              {alert.link ? (
                <button
                  type="button"
                  className="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    openExternal(alert.link!);
                  }}
                >
                  Open source
                </button>
              ) : null}
              {(state?.links ?? []).slice(0, 3).map((l) => (
                <button
                  key={l.href}
                  type="button"
                  className="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    openExternal(l.href);
                  }}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="primary fill-alarm-dismiss"
              onClick={(e) => {
                e.stopPropagation();
                dismiss();
              }}
            >
              Dismiss alarm
            </button>
          </div>
        </div>
      )}
    </>
  );
}
