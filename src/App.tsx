import { useCallback, useEffect, useState } from "react";
import { CopyDossierButton } from "./components/CopyDossierButton";
import { CopyIronsightNewsButton } from "./components/CopyIronsightNewsButton";
import { EnergyQuotes } from "./components/EnergyQuotes";
import { Geopolitical } from "./components/Geopolitical";
import { OptionsChain } from "./components/OptionsChain";
import { OpenOrdersPanel } from "./components/OpenOrdersPanel";
import { PhysicalMarketsPanel } from "./components/PhysicalMarketsPanel";
import { Positions } from "./components/Positions";
import { StatusBar } from "./components/StatusBar";
import { StockPrice } from "./components/StockPrice";
import { TradeOrderPanel } from "./components/TradeOrderPanel";
import { VolatilityPanel } from "./components/VolatilityPanel";
import {
  fetchEtradeStatus,
  fetchIronsightStatus,
  fetchMarketSnapshot,
  fetchOptions,
  fetchPortfolio,
  restoreEtradeTokens,
} from "./services/api";
import { useDashboardStore } from "./store/dashboard";

const MARKET_POLL_MS = 45_000;
const OSINT_POLL_MS = 15_000;

type TabId = "markets" | "ironsight";

export default function App() {
  const [tab, setTab] = useState<TabId>("markets");
  const [ordersRefreshKey, setOrdersRefreshKey] = useState(0);
  const {
    fro,
    energy,
    options,
    volatility,
    physical,
    marketFetchedAt,
    marketError,
    marketLoading,
    etrade,
    portfolio,
    etradeError,
    etradeLoading,
    ironsightUp,
    ironsightUrl,
    selectedExpiry,
    setSelectedExpiry,
    setMarket,
    setMarketError,
    setMarketLoading,
    setEtrade,
    setPortfolio,
    setEtradeError,
    setEtradeLoading,
    setIronsight,
  } = useDashboardStore();

  const refreshMarket = useCallback(async () => {
    setMarketLoading(true);
    try {
      const snap = await fetchMarketSnapshot();
      setMarket(snap);
    } catch (err) {
      setMarketError(String(err));
    }
  }, [setMarket, setMarketError, setMarketLoading]);

  const refreshPortfolio = useCallback(async () => {
    setEtradeLoading(true);
    try {
      const status = await fetchEtradeStatus();
      setEtrade(status);
      if (status.authorized) {
        const pf = await fetchPortfolio();
        setPortfolio(pf);
      } else {
        setPortfolio(null);
        setEtradeLoading(false);
      }
    } catch (err) {
      setEtradeError(String(err));
    }
  }, [setEtrade, setEtradeError, setEtradeLoading, setPortfolio]);

  const refreshOsint = useCallback(async () => {
    try {
      const s = await fetchIronsightStatus();
      setIronsight(s.up, s.url);
    } catch {
      setIronsight(false, ironsightUrl);
    }
  }, [ironsightUrl, setIronsight]);

  useEffect(() => {
    void (async () => {
      try {
        const status = await fetchEtradeStatus();
        setEtrade(status);
        if (!status.authorized && window.tradehole?.loadTokens) {
          const tokens = await window.tradehole.loadTokens();
          if (tokens) {
            await restoreEtradeTokens(tokens);
            await refreshPortfolio();
            return;
          }
        }
        if (status.authorized) await refreshPortfolio();
      } catch (err) {
        setEtradeError(String(err));
      }
    })();
  }, [refreshPortfolio, setEtrade, setEtradeError]);

  useEffect(() => {
    void refreshMarket();
    const id = window.setInterval(() => void refreshMarket(), MARKET_POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshMarket]);

  useEffect(() => {
    void refreshOsint();
    const id = window.setInterval(() => void refreshOsint(), OSINT_POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshOsint]);

  useEffect(() => {
    if (!selectedExpiry || !options || !fro || !energy) return;
    if (selectedExpiry === options.selectedExpiry) return;
    void (async () => {
      try {
        const chain = await fetchOptions("FRO", selectedExpiry);
        setMarket({
          fro,
          energy,
          options: chain,
          volatility: volatility ?? undefined,
          physical: physical ?? undefined,
          fetchedAt: new Date().toISOString(),
        });
      } catch (err) {
        setMarketError(String(err));
      }
    })();
  }, [selectedExpiry, options, fro, energy, volatility, physical, setMarket, setMarketError]);

  const focusCall =
    options?.calls.find(
      (c) => c.strike === 46 && options.selectedExpiry === "2026-09-18",
    ) ??
    options?.calls.find((c) => c.strike === 46) ??
    null;

  return (
    <div className={`app ${tab === "ironsight" ? "app-ironsight" : ""}`}>
      <header className="topbar">
        <div className="brand-block">
          <div className="brand">
            <span className="brand-mark">Tradehole</span>
            <span className="brand-sub">FRO options monitor</span>
          </div>
          <nav className="tab-nav" aria-label="Main">
            <button
              type="button"
              className={tab === "markets" ? "tab active" : "tab"}
              onClick={() => setTab("markets")}
            >
              Markets
            </button>
            <button
              type="button"
              className={tab === "ironsight" ? "tab active" : "tab"}
              onClick={() => setTab("ironsight")}
            >
              IRONSIGHT
              <span className={`tab-dot ${ironsightUp ? "on" : ""}`} />
            </button>
          </nav>
        </div>
        <div className="topbar-actions">
          {tab === "markets" && <CopyDossierButton symbol="FRO" />}
          {tab === "markets" && (
            <button
              type="button"
              className="ghost"
              disabled={marketLoading}
              onClick={() => void refreshMarket()}
            >
              Refresh market
            </button>
          )}
          {tab === "ironsight" && <CopyIronsightNewsButton />}
          {tab === "ironsight" && (
            <button type="button" className="ghost" onClick={() => void refreshOsint()}>
              Recheck OSINT
            </button>
          )}
        </div>
      </header>

      {marketError && tab === "markets" && (
        <p className="banner error">{marketError}</p>
      )}

      {tab === "markets" ? (
        <main className="dashboard dashboard-markets">
          <div className="col-left">
            <StockPrice quote={fro} loading={marketLoading} />
            <EnergyQuotes energy={energy} />
            <PhysicalMarketsPanel physical={physical} />
            <VolatilityPanel report={volatility} loading={marketLoading} />
          </div>

          <div className="col-center">
            <OptionsChain
              options={options}
              selectedExpiry={selectedExpiry}
              onExpiryChange={setSelectedExpiry}
            />
          </div>

          <div className="col-right">
            <Positions
              status={etrade}
              portfolio={portfolio}
              error={etradeError}
              loading={etradeLoading}
              onAuthorized={() => void refreshPortfolio()}
              onLoggedOut={() => {
                setPortfolio(null);
                void refreshPortfolio();
              }}
            />
            <OpenOrdersPanel
              status={etrade}
              portfolio={portfolio}
              refreshKey={ordersRefreshKey}
            />
            <TradeOrderPanel
              status={etrade}
              portfolio={portfolio}
              focusCall={focusCall}
              onPlaced={() => {
                setOrdersRefreshKey((k) => k + 1);
                void refreshPortfolio();
              }}
            />
          </div>
        </main>
      ) : (
        <main className="ironsight-main">
          <Geopolitical up={ironsightUp} url={ironsightUrl} mode="page" />
        </main>
      )}

      <StatusBar
        marketFetchedAt={marketFetchedAt}
        marketLoading={marketLoading}
        etradeAuthorized={etrade?.authorized ?? null}
        ironsightUp={ironsightUp}
      />
    </div>
  );
}
