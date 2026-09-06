import { Fragment, useState, type FormEvent } from "react";
import {
  addExternalPosition,
  completeEtradeOAuth,
  deleteExternalPosition,
  logoutEtrade,
  renewEtrade,
  startEtradeOAuth,
  updateExternalPosition,
} from "../services/api";
import { fmtMoney, fmtPct, signedClass } from "../lib/format";
import {
  FULL_PORTFOLIO_ACCOUNT_ID_KEY,
  isFullPortfolioKey,
  isRobinhoodAccountKey,
  portfolioAccountOptions,
} from "../lib/accounts";
import type { EtradeAccount, EtradeStatus, Portfolio, PortfolioSection, PositionRow } from "../types";

type Props = {
  status: EtradeStatus | null;
  accounts: EtradeAccount[];
  selectedAccountIdKey: string | null;
  portfolio: Portfolio | null;
  error: string | null;
  loading: boolean;
  onAuthorized: () => void;
  onAccountChange: (accountIdKey: string) => void;
  onLoggedOut: () => void;
  onExternalChanged: () => void;
};

function accountLabel(a: EtradeAccount): string {
  if (a.accountIdKey === FULL_PORTFOLIO_ACCOUNT_ID_KEY) return "Full portfolio";
  const desc = a.accountDesc || a.accountName || a.accountType || "Account";
  const last4 =
    a.accountId && a.accountId.length >= 4
      ? `*${a.accountId.slice(-4)}`
      : a.accountId || null;
  const id = last4 ? ` · ${last4}` : "";
  const type = a.accountType && a.accountType !== "EXTERNAL" ? ` (${a.accountType})` : "";
  return `${desc}${id}${type}`;
}

function sectionLabel(section: PortfolioSection): string {
  const desc = section.accountDesc || section.accountType || "Account";
  const last4 =
    section.accountId && String(section.accountId).length >= 4
      ? `*${String(section.accountId).slice(-4)}`
      : section.accountId
        ? `*${section.accountId}`
        : null;
  const id = last4 ? ` · ${last4}` : "";
  const type =
    section.accountType && section.accountType !== "EXTERNAL"
      ? ` (${section.accountType})`
      : "";
  return `${desc}${id}${type}`;
}

function PositionRows({
  positions,
  editingId,
  editQty,
  editCost,
  busy,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDeleteExternal,
  setEditQty,
  setEditCost,
  allowExternalEdit,
}: {
  positions: PositionRow[];
  editingId: string | null;
  editQty: string;
  editCost: string;
  busy: boolean;
  onStartEdit: (row: PositionRow) => void;
  onSaveEdit: (id: string) => void;
  onCancelEdit: () => void;
  onDeleteExternal: (id: string) => void;
  setEditQty: (v: string) => void;
  setEditCost: (v: string) => void;
  allowExternalEdit: boolean;
}) {
  if (positions.length === 0) {
    return (
      <tr>
        <td colSpan={7} className="muted">
          No positions in this account
        </td>
      </tr>
    );
  }

  return (
    <>
      {positions.map((row) => {
        const isExt = Boolean(row.externalId);
        const tag = row.brokerTag ?? (isExt ? "RH" : null);
        const rowKey =
          row.externalId ??
          `${row.symbol}-${row.symbolDescription}-${row.quantity}`;
        const editing = editingId != null && editingId === row.externalId;
        return (
          <tr key={rowKey} className={isExt ? "ext-pos-row" : undefined}>
            <td>
              <div className="sym">
                <strong>
                  {row.symbol}
                  {tag ? (
                    <span
                      className={`pill broker-tag ${tag === "RH" ? "rh" : ""}`}
                      title={row.broker ?? tag}
                    >
                      {tag}
                    </span>
                  ) : null}
                </strong>
                <span className="muted">{row.symbolDescription}</span>
                {isExt && row.mark != null && (
                  <span className="muted mark-hint">
                    mark {fmtMoney(row.mark)}
                    {row.bid != null || row.ask != null
                      ? ` · ${fmtMoney(row.bid)} / ${fmtMoney(row.ask)}`
                      : ""}
                  </span>
                )}
              </div>
            </td>
            <td>
              {editing ? (
                <input
                  className="ext-inline"
                  value={editQty}
                  onChange={(e) => setEditQty(e.target.value)}
                  inputMode="decimal"
                />
              ) : (
                row.quantity
              )}
            </td>
            <td>
              {editing ? (
                <input
                  className="ext-inline"
                  value={editCost}
                  onChange={(e) => setEditCost(e.target.value)}
                  inputMode="decimal"
                />
              ) : (
                fmtMoney(row.pricePaid)
              )}
            </td>
            <td>{fmtMoney(row.marketValue)}</td>
            <td className={signedClass(row.totalGain)}>
              {fmtMoney(row.totalGain)}{" "}
              <span className="muted">{fmtPct(row.totalGainPct)}</span>
            </td>
            <td className={signedClass(row.daysGain)}>
              {fmtMoney(row.daysGain)}
            </td>
            <td className="ext-actions">
              {isExt && row.externalId && allowExternalEdit && (
                editing ? (
                  <>
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy}
                      onClick={() => onSaveEdit(row.externalId!)}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy}
                      onClick={onCancelEdit}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy}
                      onClick={() => onStartEdit(row)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="danger"
                      disabled={busy}
                      onClick={() => onDeleteExternal(row.externalId!)}
                    >
                      Del
                    </button>
                  </>
                )
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}

function emptyAddForm() {
  return {
    broker: "Robinhood",
    symbol: "FRO",
    expiry: "",
    strike: "",
    callPut: "call" as "call" | "put",
    quantity: "",
    avgCost: "",
  };
}

export function Positions({
  status,
  accounts,
  selectedAccountIdKey,
  portfolio,
  error,
  loading,
  onAuthorized,
  onAccountChange,
  onLoggedOut,
  onExternalChanged,
}: Props) {
  const [verifier, setVerifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState(emptyAddForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editCost, setEditCost] = useState("");

  async function handleStart() {
    setBusy(true);
    setLocalError(null);
    setVerifier("");
    try {
      const { authorizeUrl } = await startEtradeOAuth();
      if (window.tradehole?.openExternal) {
        await window.tradehole.openExternal(authorizeUrl);
      } else {
        window.open(authorizeUrl, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      setLocalError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleComplete() {
    setBusy(true);
    setLocalError(null);
    try {
      const result = await completeEtradeOAuth(verifier.trim());
      if (window.tradehole?.saveTokens) {
        await window.tradehole.saveTokens(result.tokens);
      }
      setVerifier("");
      onAuthorized();
    } catch (err) {
      const msg = String(err);
      // Stale request tokens / codes cannot be retried — clear the field so the
      // user doesn't hammer Complete with the same expired code.
      if (/access_token failed|Request token is|Open authorize URL again|No pending request/i.test(msg)) {
        setVerifier("");
      }
      setLocalError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    try {
      await logoutEtrade();
      if (window.tradehole?.clearTokens) await window.tradehole.clearTokens();
      onLoggedOut();
    } catch (err) {
      setLocalError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRenew() {
    setBusy(true);
    setLocalError(null);
    try {
      await renewEtrade();
      onAuthorized();
    } catch (err) {
      const msg = String(err);
      if (/session expired|token_expired/i.test(msg)) {
        try {
          await logoutEtrade();
        } catch {
          /* ignore */
        }
        if (window.tradehole?.clearTokens) await window.tradehole.clearTokens();
        onLoggedOut();
        setLocalError(
          "E*TRADE session expired. Open authorize URL and paste a new verification code — Renew cannot recover a fully expired token.",
        );
      } else {
        setLocalError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleAddExternal(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLocalError(null);
    try {
      await addExternalPosition({
        broker: addForm.broker.trim() || "Robinhood",
        symbol: addForm.symbol.trim(),
        expiry: addForm.expiry.trim(),
        strike: Number(addForm.strike),
        callPut: addForm.callPut,
        quantity: Number(addForm.quantity),
        avgCost: Number(addForm.avgCost),
      });
      setAddForm(emptyAddForm());
      setShowAdd(false);
      onExternalChanged();
    } catch (err) {
      setLocalError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteExternal(id: string) {
    setBusy(true);
    setLocalError(null);
    try {
      await deleteExternalPosition(id);
      if (editingId === id) setEditingId(null);
      onExternalChanged();
    } catch (err) {
      setLocalError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEdit(id: string) {
    setBusy(true);
    setLocalError(null);
    try {
      await updateExternalPosition(id, {
        quantity: Number(editQty),
        avgCost: Number(editCost),
      });
      setEditingId(null);
      onExternalChanged();
    } catch (err) {
      setLocalError(String(err));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(row: PositionRow) {
    if (!row.externalId) return;
    setEditingId(row.externalId);
    setEditQty(String(row.quantity));
    setEditCost(row.pricePaid != null ? String(row.pricePaid) : "");
  }

  const authorized = status?.authorized;
  const displayError = localError ?? error;
  const activeKey = selectedAccountIdKey ?? portfolio?.accountIdKey ?? "";
  const isFull = isFullPortfolioKey(activeKey) || isFullPortfolioKey(portfolio?.accountIdKey);
  const isRobinhood =
    isRobinhoodAccountKey(portfolio?.accountIdKey) ||
    isRobinhoodAccountKey(activeKey);
  const pickerAccounts = portfolioAccountOptions(accounts);
  const sections: PortfolioSection[] =
    portfolio?.sections ??
    (portfolio
      ? [
          {
            accountIdKey: portfolio.accountIdKey,
            accountId: portfolio.accountId,
            accountDesc: portfolio.accountDesc,
            accountType: portfolio.accountType,
            accountMode: portfolio.accountMode,
            positions: portfolio.positions,
            totals: portfolio.totals,
            stale: portfolio.stale,
          },
        ]
      : []);
  const positionCount = sections.reduce((n, s) => n + s.positions.length, 0);
  const allowExternalEdit = isRobinhood || isFull;
  const showRhBook = isRobinhood || isFull;

  return (
    <section className="panel pnl-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">
            {isFull
              ? "Full portfolio"
              : isRobinhood
                ? "Robinhood account"
                : `E*TRADE ${status?.env ?? "sandbox"}`}
          </p>
          <h2>Positions &amp; P&amp;L</h2>
        </div>
        <span className={`pill ${authorized || isRobinhood ? "live" : ""}`}>
          {!status?.configured && !isRobinhood
            ? "keys missing"
            : authorized
              ? "connected"
              : isRobinhood
                ? "Robinhood"
                : "not authorized"}
        </span>
      </div>

      {!status?.configured && !isRobinhood && (
        <p className="muted">
          Add <code>ETRADE_CONSUMER_KEY</code> and <code>ETRADE_CONSUMER_SECRET</code>{" "}
          to <code>.env</code>, then restart the server.
        </p>
      )}

      {status?.configured && !authorized && !isRobinhood && (
        <div className="oauth-box">
          <p className="muted">
            Click Open authorize URL, then paste the verification code immediately
            (codes + request tokens expire in ~5 minutes and cannot be reused).
            Robinhood legs still show below without E*TRADE — use the View selector
            for Robinhood-only.
          </p>
          <div className="oauth-actions">
            <button type="button" disabled={busy} onClick={() => void handleStart()}>
              Open authorize URL
            </button>
            <input
              value={verifier}
              onChange={(e) => setVerifier(e.target.value)}
              placeholder="Verification code"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="primary"
              disabled={busy || !verifier.trim()}
              onClick={() => void handleComplete()}
            >
              Complete OAuth
            </button>
          </div>
        </div>
      )}

      {authorized && (
        <div className="oauth-actions compact">
          <button type="button" disabled={busy} onClick={() => void handleRenew()}>
            Renew token
          </button>
          <button type="button" disabled={busy} onClick={() => void handleLogout()}>
            Log out
          </button>
        </div>
      )}

      {status?.configured && !authorized && isRobinhood && (
        <p className="muted tiny">
          E*TRADE not connected — showing Robinhood disk book only. Switch View to
          Full portfolio to authorize E*TRADE.
        </p>
      )}

      {(pickerAccounts.length > 0 || isRobinhood || isFull) && (
        <div className="account-select">
          <label htmlFor="etrade-account">
            View
            <select
              id="etrade-account"
              value={
                activeKey === "external"
                  ? "robinhood"
                  : activeKey ||
                    (isRobinhood
                      ? "robinhood"
                      : FULL_PORTFOLIO_ACCOUNT_ID_KEY)
              }
              disabled={busy || loading}
              onChange={(e) => onAccountChange(e.target.value)}
            >
              {(pickerAccounts.length
                ? pickerAccounts
                : portfolioAccountOptions([])
              ).map((a) => (
                <option key={a.accountIdKey} value={a.accountIdKey}>
                  {accountLabel(a)}
                </option>
              ))}
            </select>
          </label>
          {isFull && portfolio?.fetchedAt && (
            <p className="muted account-hint">
              Included accounts (brokerage &amp; Roth *8105 hidden) ·{" "}
              {positionCount} position{positionCount === 1 ? "" : "s"} · as of{" "}
              {new Date(portfolio.fetchedAt).toLocaleTimeString()}
              {portfolio.stale ? " · STALE CACHE" : ""}
            </p>
          )}
          {portfolio?.accountDesc && isRobinhood && (
            <p className="muted account-hint">
              Robinhood · {positionCount} position{positionCount === 1 ? "" : "s"}{" "}
              · marks as of{" "}
              {portfolio.fetchedAt
                ? new Date(portfolio.fetchedAt).toLocaleTimeString()
                : "—"}
            </p>
          )}
        </div>
      )}

      {displayError && <p className="error">{displayError}</p>}

      {loading && <p className="muted">Loading portfolio…</p>}

      {portfolio && (
        <>
          <div className="pnl-summary">
            <div>
              <dt>Market value</dt>
              <dd>${fmtMoney(portfolio.totals.marketValue)}</dd>
            </div>
            <div>
              <dt>Total P&amp;L</dt>
              <dd className={signedClass(portfolio.totals.totalGain)}>
                ${fmtMoney(portfolio.totals.totalGain)}
              </dd>
            </div>
            <div>
              <dt>Today P&amp;L</dt>
              <dd className={signedClass(portfolio.totals.daysGain)}>
                ${fmtMoney(portfolio.totals.daysGain)}
              </dd>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Qty</th>
                  <th>Cost</th>
                  <th>Mkt</th>
                  <th>Total P&amp;L</th>
                  <th>Today</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sections.map((section) => (
                  <Fragment key={section.accountIdKey}>
                    {isFull && (
                      <tr className="portfolio-section-head">
                        <td colSpan={7}>
                          <strong>{sectionLabel(section)}</strong>
                          <span className="muted">
                            {" "}
                            · {section.positions.length} leg
                            {section.positions.length === 1 ? "" : "s"} · MV $
                            {fmtMoney(section.totals.marketValue)}
                          </span>
                        </td>
                      </tr>
                    )}
                    <PositionRows
                      positions={section.positions}
                      editingId={editingId}
                      editQty={editQty}
                      editCost={editCost}
                      busy={busy}
                      allowExternalEdit={allowExternalEdit}
                      onStartEdit={startEdit}
                      onSaveEdit={(id) => void handleSaveEdit(id)}
                      onCancelEdit={() => setEditingId(null)}
                      onDeleteExternal={(id) => void handleDeleteExternal(id)}
                      setEditQty={setEditQty}
                      setEditCost={setEditCost}
                    />
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="ext-book">
        <div className="ext-book-head">
          <p className="muted">
            {showRhBook
              ? "Robinhood book — persisted on disk, marked from the options chain when available. Edit RH legs inline or switch to Robinhood-only view."
              : "Full portfolio includes Robinhood — edit RH legs inline or switch to Robinhood-only view."}
          </p>
          {showRhBook && (
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => setShowAdd((v) => !v)}
            >
              {showAdd ? "Cancel" : "Add position"}
            </button>
          )}
        </div>

        {showRhBook && showAdd && (
          <form className="ext-add-form" onSubmit={(e) => void handleAddExternal(e)}>
            <label>
              Broker
              <input
                value={addForm.broker}
                onChange={(e) =>
                  setAddForm((f) => ({ ...f, broker: e.target.value }))
                }
                placeholder="Robinhood"
              />
            </label>
            <label>
              Symbol
              <input
                value={addForm.symbol}
                onChange={(e) =>
                  setAddForm((f) => ({ ...f, symbol: e.target.value }))
                }
                required
              />
            </label>
            <label>
              Expiry
              <input
                type="date"
                value={addForm.expiry}
                onChange={(e) =>
                  setAddForm((f) => ({ ...f, expiry: e.target.value }))
                }
                required
              />
            </label>
            <label>
              Strike
              <input
                value={addForm.strike}
                onChange={(e) =>
                  setAddForm((f) => ({ ...f, strike: e.target.value }))
                }
                inputMode="decimal"
                required
              />
            </label>
            <label>
              Side
              <select
                value={addForm.callPut}
                onChange={(e) =>
                  setAddForm((f) => ({
                    ...f,
                    callPut: e.target.value as "call" | "put",
                  }))
                }
              >
                <option value="call">Call</option>
                <option value="put">Put</option>
              </select>
            </label>
            <label>
              Qty
              <input
                value={addForm.quantity}
                onChange={(e) =>
                  setAddForm((f) => ({ ...f, quantity: e.target.value }))
                }
                inputMode="decimal"
                required
              />
            </label>
            <label>
              Avg cost
              <input
                value={addForm.avgCost}
                onChange={(e) =>
                  setAddForm((f) => ({ ...f, avgCost: e.target.value }))
                }
                inputMode="decimal"
                required
              />
            </label>
            <button type="submit" className="primary" disabled={busy}>
              Add position
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
