import { useEffect, useMemo, useState } from "react";
import { isRobinhoodAccountKey } from "../lib/accounts";
import { fmtMoney } from "../lib/format";
import {
  fetchTradingStatus,
  placeEtradeOrder,
  previewEtradeOrder,
} from "../services/api";
import type {
  EtradeStatus,
  OptionContract,
  OrderPreview,
  OrderPlaceResult,
  Portfolio,
  TradeOrderDraft,
  TradingStatus,
} from "../types";

const FRO_EXPIRY = "2026-09-18";
const FRO_STRIKE = 46;

type PriceType = "LIMIT" | "MARKET" | "TRAILING_STOP_CNST";
type OrderTerm = "GOOD_FOR_DAY" | "GOOD_UNTIL_CANCEL";

type Props = {
  status: EtradeStatus | null;
  portfolio: Portfolio | null;
  tradingAccountIdKey?: string | null;
  focusCall: OptionContract | null;
  onPlaced?: () => void;
  draft?: TradeOrderDraft | null;
  onDraftConsumed?: () => void;
};

export function TradeOrderPanel({
  status,
  portfolio,
  tradingAccountIdKey,
  focusCall,
  onPlaced,
  draft,
  onDraftConsumed,
}: Props) {
  const [trading, setTrading] = useState<TradingStatus | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [limitPrice, setLimitPrice] = useState("");
  const [trailAmount, setTrailAmount] = useState("5.00");
  const [priceType, setPriceType] = useState<PriceType>("LIMIT");
  const [orderTerm, setOrderTerm] = useState<OrderTerm>("GOOD_FOR_DAY");
  const [orderAction, setOrderAction] = useState<
    "BUY_OPEN" | "SELL_CLOSE" | "BUY_CLOSE" | "SELL_OPEN"
  >("BUY_OPEN");
  const [preview, setPreview] = useState<OrderPreview | null>(null);
  const [confirm, setConfirm] = useState("");
  const [placed, setPlaced] = useState<OrderPlaceResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState<string | null>(null);

  useEffect(() => {
    if (!draft) return;
    setOrderAction(draft.orderAction);
    setQuantity(Math.max(1, draft.quantity));
    if (draft.limitPrice) setLimitPrice(draft.limitPrice);
    setPriceType("LIMIT");
    setOrderTerm("GOOD_FOR_DAY");
    setPreview(null);
    setConfirm("");
    setDraftNote(`Playbook ${draft.proposalId.slice(0, 8)}… applied — preview still required`);
    onDraftConsumed?.();
  }, [draft, onDraftConsumed]);

  const authorized = status?.authorized;
  const isProduction = status?.env === "production";
  const rhSelected = isRobinhoodAccountKey(portfolio?.accountIdKey);
  const ordersAccountKey = tradingAccountIdKey ?? portfolio?.accountIdKey;

  useEffect(() => {
    void fetchTradingStatus()
      .then(setTrading)
      .catch(() => setTrading(null));
  }, []);

  useEffect(() => {
    if (focusCall?.ask != null && priceType === "LIMIT" && !limitPrice) {
      setLimitPrice(focusCall.ask.toFixed(2));
    }
  }, [focusCall, limitPrice, priceType]);

  function applyPriceType(next: PriceType) {
    setPriceType(next);
    setPreview(null);
    if (next === "TRAILING_STOP_CNST") {
      setOrderAction("SELL_CLOSE");
      setOrderTerm("GOOD_UNTIL_CANCEL");
      if (!trailAmount) setTrailAmount("5.00");
      if (quantity < 2) setQuantity(2);
      // Default trail below typical cheap long-dated premium; user can raise later.
      if (!trailAmount || Number(trailAmount) >= 1) setTrailAmount("0.25");
    }
  }

  const heldQty = useMemo(() => {
    if (!portfolio) return 0;
    return portfolio.positions
      .filter((p) => /FRO.*46.*Call/i.test(p.symbolDescription))
      .reduce((sum, p) => sum + (p.quantity ?? 0), 0);
  }, [portfolio]);

  const refPremium =
    focusCall?.bid ?? focusCall?.lastPrice ?? focusCall?.ask ?? null;
  const trailNum = Number(trailAmount);
  const trailTooWide =
    priceType === "TRAILING_STOP_CNST" &&
    refPremium != null &&
    Number.isFinite(trailNum) &&
    trailNum >= refPremium;

  const contractLabel = "FRO Sep 18 '26 $46 Call";

  const canPreview =
    Boolean(trading?.enabled) &&
    !busy &&
    (priceType !== "LIMIT" || Boolean(limitPrice)) &&
    (priceType !== "TRAILING_STOP_CNST" ||
      (Number.isFinite(trailNum) && trailNum > 0 && !trailTooWide));

  async function handlePreview() {
    setBusy(true);
    setError(null);
    setPlaced(null);
    setConfirm("");
    try {
      const result = await previewEtradeOrder({
        accountIdKey: ordersAccountKey,
        symbol: "FRO",
        callPut: "CALL",
        expiry: FRO_EXPIRY,
        strike: FRO_STRIKE,
        orderAction,
        quantity,
        priceType,
        limitPrice: priceType === "LIMIT" ? Number(limitPrice) : undefined,
        trailAmount:
          priceType === "TRAILING_STOP_CNST" ? Number(trailAmount) : undefined,
        orderTerm,
      });
      setPreview(result);
    } catch (err) {
      setPreview(null);
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handlePlace() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const result = await placeEtradeOrder(preview.previewToken, confirm);
      setPlaced(result);
      setPreview(null);
      setConfirm("");
      onPlaced?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!authorized || rhSelected) return null;

  return (
    <section className="panel trade-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">E*TRADE order</p>
          <h2>Trade {contractLabel}</h2>
        </div>
        <span className={`pill ${isProduction ? "warn" : ""}`}>
          {isProduction ? "live money" : status?.env ?? "sandbox"}
        </span>
      </div>

      {trading && !trading.enabled && (
        <p className="banner error">
          Trading disabled — set <code>ETRADE_ENABLE_TRADING=true</code> in .env
        </p>
      )}

      {isProduction && (
        <p className="trade-warning">
          Live account — preview required, then type the confirm phrase. Hold{" "}
          <strong>{heldQty}</strong> of this call. Prefer trailing stops during
          regular hours (after-hours trails can mis-price).
        </p>
      )}

      {draftNote && <p className="banner info">{draftNote}</p>}

      <div className="trade-form">
        <label>
          Action
          <select
            value={orderAction}
            onChange={(e) =>
              setOrderAction(e.target.value as typeof orderAction)
            }
          >
            <option value="BUY_OPEN">Buy to open (add calls)</option>
            <option value="SELL_CLOSE">Sell to close</option>
            <option value="BUY_CLOSE">Buy to close</option>
            <option value="SELL_OPEN">Sell to open</option>
          </select>
        </label>

        <label>
          Contracts
          <input
            type="number"
            min={1}
            step={1}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>

        <label>
          Price type
          <select
            value={priceType}
            onChange={(e) => applyPriceType(e.target.value as PriceType)}
          >
            <option value="LIMIT">Limit (take-profit / GTC @ price)</option>
            <option value="MARKET">Market</option>
            <option value="TRAILING_STOP_CNST">
              Trailing stop $ (→ market on trigger)
            </option>
          </select>
        </label>

        <label>
          Duration
          <select
            value={orderTerm}
            onChange={(e) => setOrderTerm(e.target.value as OrderTerm)}
          >
            <option value="GOOD_FOR_DAY">Day</option>
            <option value="GOOD_UNTIL_CANCEL">GTC</option>
          </select>
        </label>

        {priceType === "LIMIT" && (
          <label>
            Limit price
            <input
              type="number"
              min={0.01}
              step={0.05}
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
            />
            {focusCall && (
              <span className="muted trade-hint">
                Chain ask {fmtMoney(focusCall.ask)} · bid {fmtMoney(focusCall.bid)}
              </span>
            )}
          </label>
        )}

        {priceType === "TRAILING_STOP_CNST" && (
          <label>
            Trail amount ($)
            <input
              type="number"
              min={0.01}
              step={0.05}
              value={trailAmount}
              onChange={(e) => setTrailAmount(e.target.value)}
            />
            <span className="muted trade-hint">
              Dollar trail under the high watermark. On trigger E*TRADE sends a
              market sell-to-close. Must be &lt; current premium
              {refPremium != null ? ` (~$${fmtMoney(refPremium)})` : ""}.
            </span>
            {trailTooWide && (
              <span className="error trade-hint">
                Trail ${fmtMoney(trailNum)} ≥ premium ${fmtMoney(refPremium)} —
                E*TRADE will reject. Use a smaller trail (e.g. $0.10–$0.25
                while this call is cheap).
              </span>
            )}
          </label>
        )}
      </div>

      <div className="trade-actions">
        <button
          type="button"
          className="primary"
          disabled={!canPreview}
          onClick={() => void handlePreview()}
        >
          Preview order
        </button>
        {preview && (
          <button type="button" disabled={busy} onClick={() => setPreview(null)}>
            Clear preview
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {preview && (
        <div className="trade-preview">
          <h3>Preview — confirm to place</h3>
          <p className="trade-summary">{preview.summary}</p>
          {preview.symbolDescription && (
            <p className="muted">{preview.symbolDescription}</p>
          )}
          <dl className="trade-stats">
            <div>
              <dt>Est. total</dt>
              <dd>${fmtMoney(preview.estimatedTotalAmount)}</dd>
            </div>
            <div>
              <dt>Commission</dt>
              <dd>${fmtMoney(preview.estimatedCommission)}</dd>
            </div>
            <div>
              <dt>Preview ID</dt>
              <dd className="mono">{preview.previewId}</dd>
            </div>
          </dl>

          {preview.messages.length > 0 && (
            <ul className="trade-messages">
              {preview.messages.map((m, i) => (
                <li key={`${m.code ?? i}-${m.description}`} className={m.type.toLowerCase()}>
                  {m.description}
                </li>
              ))}
            </ul>
          )}

          <label className="confirm-label">
            Type exactly: <code>{preview.confirmPhrase}</code>
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={preview.confirmPhrase}
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <button
            type="button"
            className="danger"
            disabled={busy || confirm.trim() !== preview.confirmPhrase}
            onClick={() => void handlePlace()}
          >
            Place order
          </button>
          <p className="muted trade-expiry">
            Preview expires {new Date(preview.expiresAt).toLocaleTimeString()}
          </p>
        </div>
      )}

      {placed && (
        <div className="trade-placed">
          <h3>Order submitted</h3>
          <p>{placed.summary}</p>
          {placed.orderId && (
            <p>
              Order ID: <code>{placed.orderId}</code>
            </p>
          )}
          {placed.symbolDescription && (
            <p className="muted">{placed.symbolDescription}</p>
          )}
        </div>
      )}
    </section>
  );
}
