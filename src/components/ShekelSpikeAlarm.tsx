import { useCallback, useEffect, useRef, useState } from "react";
import {
  resumeAlarmAudio,
  startOrderAlarm,
  stopOrderAlarm,
} from "../lib/orderAlarmSound";
import {
  fetchIntelAlarm,
  type ShekelAlarmSnapshot,
} from "../services/api";
import { useDashboardStore } from "../store/dashboard";

const POLL_MS = 30_000;

function openExternal(href: string): void {
  if (window.tradehole?.openExternal) {
    void window.tradehole.openExternal(href);
  } else {
    window.open(href, "_blank", "noopener,noreferrer");
  }
}

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

/**
 * Floating chip + loud overlay for USD/ILS Shekel spike.
 * Polls /api/intel-alarm and writes shekelAlarm into the dashboard store.
 */
export function ShekelSpikeAlarm() {
  const setShekelAlarm = useDashboardStore((s) => s.setShekelAlarm);
  const [shekel, setShekel] = useState<ShekelAlarmSnapshot | null>(null);
  const [alerting, setAlerting] = useState(false);
  const primedRef = useRef(false);
  const wasSpikedRef = useRef(false);
  const titleRef = useRef(document.title);
  const flashRef = useRef<number | null>(null);

  const dismiss = useCallback(() => {
    setAlerting(false);
    stopOrderAlarm();
    if (flashRef.current != null) {
      window.clearInterval(flashRef.current);
      flashRef.current = null;
    }
    document.title = titleRef.current;
  }, []);

  const fire = useCallback((snap: ShekelAlarmSnapshot) => {
    setAlerting(true);
    void startOrderAlarm();
    void window.tradehole?.alertOrderFill?.(true);
    try {
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        new Notification("SHEKEL SPIKE · USD/ILS", {
          body: `${snap.symbol} ${snap.price?.toFixed(4) ?? "—"} · ${pct(snap.changePct)} · regime ${snap.regime}`,
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
      document.title = on
        ? `₪ SPIKE · ${snap.price?.toFixed(2) ?? "ILS"}`
        : titleRef.current;
    }, 700);
  }, []);

  const tick = useCallback(async () => {
    try {
      const state = await fetchIntelAlarm(false);
      const snap = state.shekelAlarm ?? state.bibi.shekel;
      setShekel(snap);
      setShekelAlarm(snap);

      if (!primedRef.current) {
        primedRef.current = true;
        wasSpikedRef.current = snap.spiked;
        if (typeof Notification !== "undefined") {
          if (Notification.permission === "default") {
            void Notification.requestPermission();
          }
        }
        if (snap.spiked) setAlerting(true);
        return;
      }

      if (snap.spiked && !wasSpikedRef.current) {
        fire(snap);
      } else if (!snap.spiked && wasSpikedRef.current) {
        dismiss();
      } else if (snap.spiked) {
        setAlerting(true);
      }
      wasSpikedRef.current = snap.spiked;
    } catch {
      /* transient */
    }
  }, [dismiss, fire, setShekelAlarm]);

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

  const regime = shekel?.regime ?? "unknown";
  const spiked = shekel?.spiked === true;
  const chipClass = spiked
    ? "shekel-watch-chip spiked"
    : regime === "firm"
      ? "shekel-watch-chip firm"
      : "shekel-watch-chip";

  return (
    <>
      {shekel && !alerting && (
        <button
          type="button"
          className={chipClass}
          title={shekel.read}
          onClick={() => {
            void resumeAlarmAudio();
            void tick();
          }}
        >
          Shekel · {shekel.symbol}{" "}
          {shekel.price != null ? shekel.price.toFixed(3) : "—"}
          {spiked
            ? " · SPIKED"
            : ` · vs ~${shekel.threshold.toFixed(2)}`}
        </button>
      )}

      {alerting && shekel && (
        <div
          className="fill-alarm-overlay shekel-spike"
          role="alertdialog"
          aria-modal="true"
          onClick={() => {
            void resumeAlarmAudio().then(() => void startOrderAlarm());
          }}
        >
          <div className="fill-alarm-card">
            <p className="fill-alarm-eyebrow">USD/ILS Shekel spike</p>
            <h2>
              SPIKED · {shekel.symbol}{" "}
              {shekel.price != null ? shekel.price.toFixed(4) : "—"}
            </h2>
            <p className="fill-alarm-order">
              {pct(shekel.changePct)} · vs ~{shekel.threshold.toFixed(2)}
            </p>
            <p className="fill-alarm-detail">{shekel.read}</p>
            <p className="fill-alarm-detail">{shekel.rule}</p>
            <p className="fill-alarm-detail">
              Arms Bibi secondary → overall YELLOW alone; RED if ≥2 of 5 locks
              also true (bibi_plus_locks).
            </p>
            <div className="theater-actions" style={{ marginTop: "0.75rem" }}>
              <button
                type="button"
                className="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  openExternal("https://finance.yahoo.com/quote/ILS=X");
                }}
              >
                Yahoo ILS=X
              </button>
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
