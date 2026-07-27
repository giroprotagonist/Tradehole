import { useCallback, useEffect, useState } from "react";
import { fmtMoney } from "../lib/format";
import { fetchOrders } from "../services/api";
import type { BrokerOrder, EtradeStatus, Portfolio } from "../types";

const POLL_MS = 30_000;

type Props = {
  status: EtradeStatus | null;
  portfolio: Portfolio | null;
  refreshKey?: number;
};

function statusClass(status: string): string {
  const s = status.toUpperCase();
  if (s === "OPEN" || s === "CANCEL_REQUESTED") return "open";
  if (s === "EXECUTED" || s === "INDIVIDUAL_FILLS") return "filled";
  if (s === "CANCELLED" || s === "EXPIRED" || s === "REJECTED") return "dead";
  return "";
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function priceLabel(order: BrokerOrder): string {
  const pt = order.priceType ?? "—";
  if (pt === "LIMIT" && order.limitPrice != null) {
    return `LIMIT @ $${fmtMoney(order.limitPrice)}`;
  }
  if (pt === "STOP" && order.stopPrice != null) {
    return `STOP @ $${fmtMoney(order.stopPrice)}`;
  }
  if (pt === "STOP_LIMIT") {
    return `STOP_LIMIT stop $${fmtMoney(order.stopPrice)} / lim $${fmtMoney(order.limitPrice)}`;
  }
  if (pt?.startsWith("TRAILING_STOP") && order.stopPrice != null) {
    return `${pt} trail $${fmtMoney(order.stopPrice)}`;
  }
  if (pt?.startsWith("TRAILING_STOP") && order.offsetValue != null) {
    return `${pt} trail $${fmtMoney(order.offsetValue)}`;
  }
  return pt;
}

function qtyLabel(order: BrokerOrder): string {
  const ordered = order.orderedQuantity ?? order.quantity;
  const filled = order.filledQuantity;
  if (ordered == null) return "—";
  if (filled != null && filled > 0) return `${filled}/${ordered}`;
  return String(ordered);
}

export function OpenOrdersPanel({ status, portfolio, refreshKey = 0 }: Props) {
  const [filter, setFilter] = useState<"OPEN" | "ALL">("OPEN");
  const [orders, setOrders] = useState<BrokerOrder[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const authorized = status?.authorized;

  const refresh = useCallback(async () => {
    if (!authorized) {
      setOrders([]);
      return;
    }
    setLoading(true);
    try {
      const data = await fetchOrders({
        accountIdKey: portfolio?.accountIdKey,
        status: filter === "OPEN" ? "OPEN" : undefined,
        count: 50,
      });
      setOrders(data.orders);
      setFetchedAt(data.fetchedAt);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [authorized, filter, portfolio?.accountIdKey]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  useEffect(() => {
    if (!authorized) return;
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [authorized, refresh]);

  if (!authorized) return null;

  return (
    <section className="panel orders-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">E*TRADE working book</p>
          <h2>Orders</h2>
        </div>
        <div className="orders-head-actions">
          <div className="orders-filter">
            <button
              type="button"
              className={filter === "OPEN" ? "ghost active" : "ghost"}
              onClick={() => setFilter("OPEN")}
            >
              Open
            </button>
            <button
              type="button"
              className={filter === "ALL" ? "ghost active" : "ghost"}
              onClick={() => setFilter("ALL")}
            >
              Recent
            </button>
          </div>
          <button type="button" className="ghost" disabled={loading} onClick={() => void refresh()}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {orders.length === 0 && !loading && !error && (
        <p className="muted">
          {filter === "OPEN" ? "No open orders." : "No recent orders returned."}
        </p>
      )}

      <ul className="orders-list">
        {orders.map((order) => {
          const isOpen = expanded === order.orderId;
          return (
            <li key={`${order.orderId}-${order.placedTime}`} className="order-card">
              <button
                type="button"
                className="order-card-main"
                onClick={() =>
                  setExpanded(isOpen ? null : order.orderId)
                }
              >
                <div className="order-card-top">
                  <span className={`pill ${statusClass(order.status)}`}>
                    {order.status}
                  </span>
                  <span className="order-id mono">#{order.orderId}</span>
                  <span className="muted order-type">{order.orderType ?? "—"}</span>
                </div>
                <div className="order-headline">
                  <strong>
                    {order.orderAction ?? "—"} {qtyLabel(order)}
                  </strong>{" "}
                  {order.symbolDescription ?? order.symbol ?? "—"}
                </div>
                <div className="order-sub muted">
                  {priceLabel(order)} · {order.orderTerm ?? "—"}
                  {order.osiKey ? ` · ${order.osiKey}` : ""}
                </div>
              </button>

              {isOpen && (
                <div className="order-detail">
                  <dl className="order-grid">
                    <div>
                      <dt>Placed</dt>
                      <dd>{formatWhen(order.placedTime)}</dd>
                    </div>
                    <div>
                      <dt>Executed</dt>
                      <dd>{formatWhen(order.executedTime)}</dd>
                    </div>
                    <div>
                      <dt>Session</dt>
                      <dd>{order.marketSession ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Order value</dt>
                      <dd>
                        {order.orderValue != null
                          ? `$${fmtMoney(order.orderValue)}`
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Limit</dt>
                      <dd>{fmtMoney(order.limitPrice)}</dd>
                    </div>
                    <div>
                      <dt>Stop / trail</dt>
                      <dd>
                        {order.stopPrice != null
                          ? fmtMoney(order.stopPrice)
                          : order.offsetValue != null
                            ? fmtMoney(order.offsetValue)
                            : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Filled</dt>
                      <dd>
                        {order.filledQuantity ?? 0} /{" "}
                        {order.orderedQuantity ?? order.quantity ?? "—"}
                        {order.averageExecutionPrice != null
                          ? ` @ $${fmtMoney(order.averageExecutionPrice)}`
                          : ""}
                      </dd>
                    </div>
                    <div>
                      <dt>Est. total</dt>
                      <dd>
                        {order.estimatedTotalAmount != null
                          ? `$${fmtMoney(order.estimatedTotalAmount)}`
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Strike / expiry</dt>
                      <dd>
                        {order.strikePrice != null ? `$${order.strikePrice}` : "—"}{" "}
                        {order.callPut ?? ""} {order.expiry ?? ""}
                      </dd>
                    </div>
                    <div>
                      <dt>Commission</dt>
                      <dd>
                        {order.estimatedCommission != null
                          ? `$${fmtMoney(order.estimatedCommission)}`
                          : "—"}
                      </dd>
                    </div>
                  </dl>

                  {order.messages.length > 0 && (
                    <ul className="trade-messages">
                      {order.messages.map((m, i) => (
                        <li key={`${order.orderId}-m-${i}`}>{m.description}</li>
                      ))}
                    </ul>
                  )}

                  {order.events.length > 0 && (
                    <div className="order-events">
                      <p className="eyebrow">Events</p>
                      <ul>
                        {order.events.map((e, i) => (
                          <li key={`${order.orderId}-e-${i}`}>
                            <span className="mono">{e.name}</span>
                            <span className="muted"> {formatWhen(e.dateTime)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {fetchedAt && (
        <p className="muted orders-fetched">
          Orders as of {new Date(fetchedAt).toLocaleTimeString()}
        </p>
      )}
    </section>
  );
}
