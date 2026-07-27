import { useState } from "react";
import {
  completeEtradeOAuth,
  logoutEtrade,
  renewEtrade,
  startEtradeOAuth,
} from "../services/api";
import { fmtMoney, fmtPct, signedClass } from "../lib/format";
import type { EtradeStatus, Portfolio } from "../types";

type Props = {
  status: EtradeStatus | null;
  portfolio: Portfolio | null;
  error: string | null;
  loading: boolean;
  onAuthorized: () => void;
  onLoggedOut: () => void;
};

export function Positions({
  status,
  portfolio,
  error,
  loading,
  onAuthorized,
  onLoggedOut,
}: Props) {
  const [verifier, setVerifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleStart() {
    setBusy(true);
    setLocalError(null);
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
      setLocalError(String(err));
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
      setLocalError(String(err));
    } finally {
      setBusy(false);
    }
  }

  const authorized = status?.authorized;
  const displayError = localError ?? error;

  return (
    <section className="panel pnl-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">E*TRADE {status?.env ?? "sandbox"}</p>
          <h2>Positions &amp; P&amp;L</h2>
        </div>
        <span className={`pill ${authorized ? "live" : ""}`}>
          {!status?.configured
            ? "keys missing"
            : authorized
              ? "connected"
              : "not authorized"}
        </span>
      </div>

      {!status?.configured && (
        <p className="muted">
          Add <code>ETRADE_CONSUMER_KEY</code> and <code>ETRADE_CONSUMER_SECRET</code>{" "}
          to <code>.env</code>, then restart the server.
        </p>
      )}

      {status?.configured && !authorized && (
        <div className="oauth-box">
          <p className="muted">
            Authorize this app with your E*TRADE account, then paste the verification
            code below.
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
                </tr>
              </thead>
              <tbody>
                {portfolio.positions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No positions in sandbox portfolio
                    </td>
                  </tr>
                ) : (
                  portfolio.positions.map((row) => (
                    <tr key={`${row.symbol}-${row.symbolDescription}`}>
                      <td>
                        <div className="sym">
                          <strong>{row.symbol}</strong>
                          <span className="muted">{row.symbolDescription}</span>
                        </div>
                      </td>
                      <td>{row.quantity}</td>
                      <td>{fmtMoney(row.pricePaid)}</td>
                      <td>{fmtMoney(row.marketValue)}</td>
                      <td className={signedClass(row.totalGain)}>
                        {fmtMoney(row.totalGain)}{" "}
                        <span className="muted">{fmtPct(row.totalGainPct)}</span>
                      </td>
                      <td className={signedClass(row.daysGain)}>
                        {fmtMoney(row.daysGain)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
