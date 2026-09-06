import { useCallback, useEffect, useRef, useState } from "react";
import {
  resumeAlarmAudio,
  startOrderAlarm,
  stopOrderAlarm,
} from "../lib/orderAlarmSound";
import { fetchHistoryAlerts, type FlowEventRow } from "../services/api";

const POLL_MS = 15_000;
const SEEN_KEY = "tradehole.flowAlerts.seen";

type Props = {
  symbol?: string;
};

function loadSeen(): Set<number> {
  try {
    const raw = sessionStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as number[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveSeen(ids: Set<number>): void {
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-200)));
  } catch {
    /* ignore */
  }
}

export function FlowAlarm({ symbol = "FRO" }: Props) {
  const [alert, setAlert] = useState<FlowEventRow | null>(null);
  const [watching, setWatching] = useState(false);
  const seenRef = useRef<Set<number>>(loadSeen());
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

  const fire = useCallback((next: FlowEventRow) => {
    setAlert(next);
    void startOrderAlarm();
    void window.tradehole?.alertOrderFill?.(next.severity === "critical");
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification("FLOW ALERT", {
          body: next.message,
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
      document.title = on ? `⚡ FLOW · ${next.kind}` : titleRef.current;
    }, 700);
  }, []);

  const tick = useCallback(async () => {
    try {
      const data = await fetchHistoryAlerts({
        symbol,
        since: new Date(Date.now() - 36 * 3_600_000).toISOString(),
      });
      setWatching(data.status.enabled);
      if (!primedRef.current) {
        for (const a of data.alerts) seenRef.current.add(a.id);
        saveSeen(seenRef.current);
        primedRef.current = true;
        return;
      }
      const fresh = data.alerts
        .filter((a) => !seenRef.current.has(a.id))
        .sort((a, b) => (a.ts < b.ts ? 1 : -1));
      if (fresh[0]) {
        seenRef.current.add(fresh[0].id);
        saveSeen(seenRef.current);
        fire(fresh[0]);
        for (const a of fresh.slice(1)) seenRef.current.add(a.id);
        saveSeen(seenRef.current);
      }
    } catch {
      /* ignore transient */
    }
  }, [symbol, fire]);

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

  return (
    <>
      {watching && !alert && (
        <p className="fill-watch-chip flow-watch-chip" title="Watching SQLite flow anomalies">
          Flow watch · every {POLL_MS / 1000}s
        </p>
      )}

      {alert && (
        <div
          className={`fill-alarm-overlay ${alert.severity === "critical" ? "filled" : "partial"}`}
          role="alertdialog"
          aria-modal="true"
          onClick={() => {
            void resumeAlarmAudio().then(() => void startOrderAlarm());
          }}
        >
          <div className="fill-alarm-card">
            <p className="fill-alarm-eyebrow">Options flow alert</p>
            <h2 id="flow-alarm-title">{alert.kind.replace(/_/g, " ").toUpperCase()}</h2>
            <p className="fill-alarm-order">{alert.severity.toUpperCase()}</p>
            <p className="fill-alarm-detail">{alert.message}</p>
            <p className="fill-alarm-time">
              {new Date(alert.ts).toLocaleString()}
              {alert.expiry ? ` · ${alert.expiry}` : ""}
              {alert.strike != null ? ` · $${alert.strike}` : ""}
              {alert.type ? ` ${alert.type}` : ""}
            </p>
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
