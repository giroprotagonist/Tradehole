import { useCallback, useEffect, useRef, useState } from "react";
import { isRobinhoodAccountKey } from "../lib/accounts";
import { fmtMoney } from "../lib/format";
import {
  resumeAlarmAudio,
  startOrderAlarm,
  stopOrderAlarm,
} from "../lib/orderAlarmSound";
import { fetchOrders } from "../services/api";
import type { BrokerOrder, EtradeStatus, Portfolio } from "../types";

/** Fast poll while working orders exist; slower idle keep-alive. */
const POLL_ACTIVE_MS = 5_000;
const POLL_IDLE_MS = 20_000;

type Props = {
  status: EtradeStatus | null;
  portfolio: Portfolio | null;
  tradingAccountIdKey?: string | null;
  /** Bump when user places/cancels so we seed the watch list immediately. */
  refreshKey?: number;
  onFill?: () => void;
};

type Watched = {
  orderId: string;
  symbolDescription: string | null;
  symbol: string | null;
  orderAction: string | null;
  orderedQuantity: number | null;
  filledQuantity: number;
  limitPrice: number | null;
  status: string;
};

export type FillAlert = {
  id: string;
  kind: "filled" | "partial" | "cancelled";
  orderId: string;
  headline: string;
  detail: string;
  at: string;
};

function orderedQty(o: BrokerOrder): number {
  return Math.abs(o.orderedQuantity ?? o.quantity ?? 0);
}

function filledQty(o: BrokerOrder): number {
  return Math.abs(o.filledQuantity ?? 0);
}

function isTerminalDead(status: string): boolean {
  const s = status.toUpperCase();
  return (
    s === "CANCELLED" ||
    s === "CANCELED" ||
    s === "EXPIRED" ||
    s === "REJECTED"
  );
}

function looksFilled(status: string, filled: number, ordered: number): boolean {
  const s = status.toUpperCase();
  if (
    s === "EXECUTED" ||
    s === "INDIVIDUAL_FILLS" ||
    s === "FILLED" ||
    s.includes("EXECUTE")
  ) {
    return true;
  }
  return ordered > 0 && filled >= ordered;
}

function toWatched(o: BrokerOrder): Watched {
  return {
    orderId: o.orderId,
    symbolDescription: o.symbolDescription,
    symbol: o.symbol,
    orderAction: o.orderAction,
    orderedQuantity: o.orderedQuantity ?? o.quantity,
    filledQuantity: filledQty(o),
    limitPrice: o.limitPrice,
    status: o.status,
  };
}

function describeOrder(w: Watched): string {
  const qty = w.orderedQuantity ?? "?";
  const name = w.symbolDescription ?? w.symbol ?? "order";
  const lim =
    w.limitPrice != null ? ` @ $${fmtMoney(w.limitPrice)}` : "";
  return `${w.orderAction ?? "ORDER"} ${qty} ${name}${lim}`;
}

async function lookupOrder(
  accountIdKey: string | undefined,
  orderId: string,
): Promise<BrokerOrder | null> {
  try {
    const data = await fetchOrders({
      accountIdKey,
      count: 50,
    });
    return data.orders.find((o) => o.orderId === orderId) ?? null;
  } catch {
    return null;
  }
}

function notifyDesktop(alert: FillAlert): void {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") {
      new Notification(
        alert.kind === "cancelled" ? "Order cancelled" : "ORDER FILLED",
        {
          body: `${alert.headline}\n${alert.detail}`,
          requireInteraction: alert.kind !== "cancelled",
          silent: true, // we play our own siren
        },
      );
    } else if (Notification.permission === "default") {
      void Notification.requestPermission();
    }
  } catch {
    /* ignore */
  }
}

export function OrderFillAlarm({
  status,
  portfolio,
  tradingAccountIdKey,
  refreshKey = 0,
  onFill,
}: Props) {
  const [alert, setAlert] = useState<FillAlert | null>(null);
  const [watching, setWatching] = useState(0);
  const [lastCheck, setLastCheck] = useState<string | null>(null);
  const watchedRef = useRef<Map<string, Watched>>(new Map());
  const primedRef = useRef(false);
  const titleRef = useRef(document.title);
  const flashRef = useRef<number | null>(null);

  const authorized = status?.authorized;
  const accountIdKey = tradingAccountIdKey ?? portfolio?.accountIdKey;
  const rhSelected = isRobinhoodAccountKey(portfolio?.accountIdKey);

  const fireAlert = useCallback(
    (next: FillAlert) => {
      setAlert(next);
      notifyDesktop(next);
      void window.tradehole?.alertOrderFill?.(next.kind !== "cancelled");
      if (next.kind !== "cancelled") {
        void startOrderAlarm();
        titleRef.current = document.title;
        let on = false;
        if (flashRef.current != null) window.clearInterval(flashRef.current);
        flashRef.current = window.setInterval(() => {
          on = !on;
          document.title = on
            ? `🚨 FILLED #${next.orderId}`
            : titleRef.current;
        }, 700);
      }
      if (next.kind === "filled" || next.kind === "partial") {
        onFill?.();
      }
    },
    [onFill],
  );

  const dismiss = useCallback(() => {
    setAlert(null);
    stopOrderAlarm();
    if (flashRef.current != null) {
      window.clearInterval(flashRef.current);
      flashRef.current = null;
    }
    document.title = titleRef.current;
  }, []);

  const tick = useCallback(async () => {
    if (!authorized || rhSelected) {
      watchedRef.current.clear();
      primedRef.current = false;
      setWatching(0);
      return;
    }

    let open: BrokerOrder[] = [];
    try {
      const data = await fetchOrders({
        accountIdKey,
        status: "OPEN",
        count: 50,
      });
      open = data.orders;
      setLastCheck(data.fetchedAt);
    } catch {
      return;
    }

    const prev = watchedRef.current;
    const nextMap = new Map<string, Watched>();
    for (const o of open) {
      nextMap.set(o.orderId, toWatched(o));
    }

    // First successful snapshot only seeds — don't alarm for pre-existing opens.
    if (!primedRef.current) {
      watchedRef.current = nextMap;
      primedRef.current = true;
      setWatching(nextMap.size);
      return;
    }

    // Partial fills while still OPEN
    for (const [id, cur] of nextMap) {
      const before = prev.get(id);
      if (!before) continue;
      if (cur.filledQuantity > before.filledQuantity) {
        const ordered = cur.orderedQuantity ?? before.orderedQuantity;
        const fully =
          ordered != null && cur.filledQuantity >= Math.abs(ordered);
        fireAlert({
          id: `${id}-partial-${cur.filledQuantity}-${Date.now()}`,
          kind: fully ? "filled" : "partial",
          orderId: id,
          headline: fully ? "ORDER FILLED" : "PARTIAL FILL",
          detail: `${describeOrder(cur)} · filled ${cur.filledQuantity}${
            ordered != null ? ` / ${Math.abs(ordered)}` : ""
          }`,
          at: new Date().toISOString(),
        });
      }
    }

    // Orders that left the OPEN book
    for (const [id, before] of prev) {
      if (nextMap.has(id)) continue;

      const found = await lookupOrder(accountIdKey, id);
      const statusNow = found?.status ?? "";
      const filled = found ? filledQty(found) : before.filledQuantity;
      const ordered = found
        ? orderedQty(found)
        : Math.abs(before.orderedQuantity ?? 0);

      if (found && isTerminalDead(statusNow) && !looksFilled(statusNow, filled, ordered)) {
        fireAlert({
          id: `${id}-dead-${Date.now()}`,
          kind: "cancelled",
          orderId: id,
          headline: `ORDER ${statusNow.toUpperCase()}`,
          detail: describeOrder(before),
          at: new Date().toISOString(),
        });
      } else {
        // Missing from OPEN + executed / filled qty / or unknown → treat as fill
        const avg =
          found?.averageExecutionPrice != null
            ? ` @ $${fmtMoney(found.averageExecutionPrice)}`
            : "";
        fireAlert({
          id: `${id}-fill-${Date.now()}`,
          kind: "filled",
          orderId: id,
          headline: "ORDER FILLED",
          detail: `${describeOrder(found ? toWatched(found) : before)} · filled ${
            filled || ordered || "?"
          }${avg}${statusNow ? ` · ${statusNow}` : ""}`,
          at: new Date().toISOString(),
        });
      }
    }

    watchedRef.current = nextMap;
    setWatching(nextMap.size);
  }, [authorized, rhSelected, accountIdKey, fireAlert]);

  useEffect(() => {
    if (!authorized || rhSelected) return;
    void tick();
  }, [authorized, rhSelected, refreshKey, tick]);

  useEffect(() => {
    if (!authorized || rhSelected) return;
    const ms = watching > 0 ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    const id = window.setInterval(() => void tick(), ms);
    return () => window.clearInterval(id);
  }, [authorized, rhSelected, watching, tick]);

  useEffect(() => {
    return () => {
      stopOrderAlarm();
      if (flashRef.current != null) window.clearInterval(flashRef.current);
      document.title = titleRef.current;
    };
  }, []);

  // Request notification permission once when we start watching opens
  useEffect(() => {
    if (watching > 0 && typeof Notification !== "undefined") {
      if (Notification.permission === "default") {
        void Notification.requestPermission();
      }
    }
  }, [watching]);

  return (
    <>
      {authorized && watching > 0 && !alert && (
        <p className="fill-watch-chip" title="Polling open orders for fills">
          Fill watch · {watching} open · every {POLL_ACTIVE_MS / 1000}s
          {lastCheck
            ? ` · checked ${new Date(lastCheck).toLocaleTimeString()}`
            : ""}
        </p>
      )}

      {alert && (
        <div
          className={`fill-alarm-overlay ${alert.kind}`}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="fill-alarm-title"
          onClick={() => {
            void resumeAlarmAudio().then(() => {
              if (alert.kind !== "cancelled") void startOrderAlarm();
            });
          }}
        >
          <div className="fill-alarm-card">
            <p className="fill-alarm-eyebrow">
              {alert.kind === "cancelled" ? "Order update" : "Tradehole alert"}
            </p>
            <h2 id="fill-alarm-title">{alert.headline}</h2>
            <p className="fill-alarm-order">#{alert.orderId}</p>
            <p className="fill-alarm-detail">{alert.detail}</p>
            <p className="fill-alarm-time">
              {new Date(alert.at).toLocaleTimeString()}
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
