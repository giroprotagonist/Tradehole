import { useCallback, useEffect, useRef, useState } from "react";
import { BookStrip } from "./components/BookStrip";
import { CopyDossierButton } from "./components/CopyDossierButton";
import { CopyIronsightNewsButton } from "./components/CopyIronsightNewsButton";
import { EnergyQuotes } from "./components/EnergyQuotes";
import { MarketChartsPanel } from "./components/MarketChartsPanel";
import { FlowAlarm } from "./components/FlowAlarm";
import { DealWatchAlarm } from "./components/DealWatchAlarm";
import { FreeOsintToolkit } from "./components/FreeOsintToolkit";
import { Geopolitical } from "./components/Geopolitical";
import { HistoryPanel } from "./components/HistoryPanel";
import { IntelAlarmPanel } from "./components/IntelAlarmPanel";
import { DecisionFootprintPanel } from "./components/DecisionFootprintPanel";
import { IsraelStrikeAlarm } from "./components/IsraelStrikeAlarm";
import { IsraelStrikeTellsPanel } from "./components/IsraelStrikeTellsPanel";
import { KineticRewindPanel } from "./components/KineticRewindPanel";
import { MarketSurprisePanel } from "./components/MarketSurprisePanel";
import { NewsReaderPanel } from "./components/NewsReaderPanel";
import { OptionsChain } from "./components/OptionsChain";
import { OpenOrdersPanel } from "./components/OpenOrdersPanel";
import { OrderFillAlarm } from "./components/OrderFillAlarm";
import { OsintTheaterMap } from "./components/OsintTheaterMap";
import { FroCatalystPanel } from "./components/FroCatalystPanel";
import { PhysicalMarketsPanel } from "./components/PhysicalMarketsPanel";
import { Positions } from "./components/Positions";
import { ShekelSpikeAlarm } from "./components/ShekelSpikeAlarm";
import { ShekelSpikePanel } from "./components/ShekelSpikePanel";
import { StatusBar } from "./components/StatusBar";
import { StockPrice } from "./components/StockPrice";
import { StrategyIntelPanel } from "./components/StrategyIntelPanel";
import { TheaterWatchPanel } from "./components/TheaterWatchPanel";
import { TradeOrderPanel } from "./components/TradeOrderPanel";
import { TradeProposalPanel } from "./components/TradeProposalPanel";
import type { TradeOrderDraft } from "./types";
import { VolatilityPanel } from "./components/VolatilityPanel";
import { copyLiveMapAssets } from "./lib/copyMapAssets";
import {
  FULL_PORTFOLIO_ACCOUNT_ID_KEY,
  isFullPortfolioKey,
  isRobinhoodAccountKey,
  portfolioAccountOptions,
  resolveTradingAccountIdKey,
  robinhoodPickerAccount,
} from "./lib/accounts";
import {
  fetchEnergy,
  fetchEtradeAccounts,
  fetchEtradeStatus,
  fetchExternalPositions,
  fetchIntelAlarm,
  fetchIronsightStatus,
  fetchIsraelStrikeTells,
  fetchMarketSnapshot,
  fetchPortfolio,
  fetchQuote,
  fetchTheaterWatch,
  isRequestTimeout,
  logoutEtrade,
  restoreEtradeTokens,
} from "./services/api";
import { useDashboardStore } from "./store/dashboard";
import type { OptionsChainsAll, Portfolio } from "./types";

const MARKET_POLL_YAHOO_MS = 45_000;
const MARKET_POLL_ETRADE_MS = 10_000;
/** Portfolio marks were only loaded on mount/account switch — poll so all accounts stay live. */
const PORTFOLIO_POLL_MS = 20_000;
const OSINT_POLL_MS = 15_000;
const INTEL_POLL_MS = 60_000;
/** Israel strike / AER ladder — shared App poller (alarm + panel + StatusBar). */
const ISRAEL_STRIKE_POLL_MS = 30_000;

/** Prefer any E*TRADE feed over Yahoo so StatusBar/poll cadence aren't stuck on a stale Yahoo options fallback. */
function preferredMarketSource(
  froSource: string | null | undefined,
  optionsSource: string | null | undefined,
): string | null {
  const candidates = [froSource, optionsSource].filter(
    (s): s is string => Boolean(s),
  );
  return candidates.find((s) => s.startsWith("etrade")) ?? candidates[0] ?? null;
}

async function loadExternalOnlyPortfolio(): Promise<Portfolio> {
  const book = await fetchExternalPositions();
  return {
    accountIdKey: "robinhood",
    accountId: null,
    accountDesc: "Robinhood",
    accountType: "EXTERNAL",
    accountMode: null,
    positions: book.marked,
    totals: book.totals,
    externalTotals: book.totals,
    externalCount: book.marked.length,
    fetchedAt: book.fetchedAt ?? new Date().toISOString(),
  };
}

type TabId = "markets" | "trade" | "ironsight" | "map" | "news";

export default function App() {
  const [tab, setTab] = useState<TabId>("map");
  const [mapCopyFlash, setMapCopyFlash] = useState<string | null>(null);
  const mapCopyBusy = useRef(false);
  const [ordersRefreshKey, setOrdersRefreshKey] = useState(0);
  const [tradeDraft, setTradeDraft] = useState<TradeOrderDraft | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [intelLevel, setIntelLevel] = useState<
    "green" | "yellow" | "red" | null
  >(null);
  const [intelLockCount, setIntelLockCount] = useState<number | null>(null);
  const [intelRedReason, setIntelRedReason] = useState<
    "five_lock" | "three_lock_stack" | "bibi_plus_locks" | null
  >(null);
  const [intelBibiTrigger, setIntelBibiTrigger] = useState<boolean | null>(
    null,
  );
  const [froGuidance, setFroGuidance] = useState<string | null>(null);
  const [ghostLit, setGhostLit] = useState<number | null>(null);
  const [ghostMax, setGhostMax] = useState<number | null>(null);
  const [politicsHeadline, setPoliticsHeadline] = useState<string | null>(
    null,
  );
  const [ironsightFeedsFresh, setIronsightFeedsFresh] = useState<
    boolean | null
  >(null);
  const [runtimeMode, setRuntimeMode] = useState<"dev" | "packaged" | null>(
    null,
  );
  const [runtimeBuildTime, setRuntimeBuildTime] = useState<string | null>(null);
  const [optionsAll, setOptionsAll] = useState<OptionsChainsAll | null>(null);

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
    accounts,
    selectedAccountIdKey,
    portfolio,
    etradeError,
    etradeLoading,
    ironsightUp,
    ironsightUrl,
    shekelAlarm,
    israelStrike,
    setMarket,
    setMarketError,
    setMarketLoading,
    setEtrade,
    setAccounts,
    setSelectedAccountIdKey,
    setPortfolio,
    setEtradeError,
    setEtradeLoading,
    setIronsight,
    setShekelAlarm,
    setIsraelStrike,
  } = useDashboardStore();

  const tradingAccountIdKey = resolveTradingAccountIdKey(
    accounts,
    selectedAccountIdKey ?? portfolio?.accountIdKey,
  );

  const marketSource = preferredMarketSource(
    fro?.source,
    optionsAll?.primarySource ?? options?.source,
  );
  const marketPollMs = marketSource?.startsWith("etrade")
    ? MARKET_POLL_ETRADE_MS
    : MARKET_POLL_YAHOO_MS;
  const marketInFlight = useRef(false);
  const portfolioInFlight = useRef(false);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const tick = async () => {
      try {
        const s = await fetchIntelAlarm(false);
        setIntelLevel(s.level);
        setIntelLockCount(s.lockCount);
        setIntelRedReason(s.redReason);
        setIntelBibiTrigger(s.bibiTrigger);
        const shekel = s.shekelAlarm ?? s.bibi.shekel;
        if (shekel) setShekelAlarm(shekel);
      } catch {
        /* server may still be starting */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), INTEL_POLL_MS);
    return () => window.clearInterval(id);
  }, [setShekelAlarm]);

  useEffect(() => {
    const tick = async () => {
      try {
        const theater = await fetchTheaterWatch().catch(() => null);
        if (theater?.bataanGhost) {
          setGhostLit(theater.bataanGhost.formationScore);
          setGhostMax(theater.bataanGhost.formationMax);
        }
        if (theater?.politicsCalendar?.headline) {
          setPoliticsHeadline(theater.politicsCalendar.headline);
        }
      } catch {
        /* optional posture chrome */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), INTEL_POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  // Shared Israel strike / AER aerial poller — feeds alarm, panel, StatusBar.
  // First paint is last-good (no refresh=1). Force aerial is Map / panel button only.
  useEffect(() => {
    const tick = async () => {
      try {
        const ist = await fetchIsraelStrikeTells(false);
        setIsraelStrike(ist);
        if (ist.froGuidance) setFroGuidance(ist.froGuidance);
      } catch {
        /* server may still be starting / adsb transient */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), ISRAEL_STRIKE_POLL_MS);
    return () => window.clearInterval(id);
  }, [setIsraelStrike]);

  useEffect(() => {
    void (async () => {
      if (window.tradehole?.getRuntimeInfo) {
        try {
          const info = await window.tradehole.getRuntimeInfo();
          setRuntimeMode(info.packaged ? "packaged" : "dev");
          setRuntimeBuildTime(info.buildTime ?? null);
        } catch {
          setRuntimeMode("dev");
        }
      } else {
        setRuntimeMode("dev");
      }
    })();
  }, []);

  const refreshMarket = useCallback(async (force = false) => {
    if (marketInFlight.current) return;
    marketInFlight.current = true;
    setMarketLoading(true);
    try {
      // Fast path: paint FRO (+ energy) without waiting for options/vol/physical.
      try {
        const [quote, energy] = await Promise.all([
          fetchQuote("FRO"),
          fetchEnergy().catch(() => null),
        ]);
        setMarket({
          fro: quote,
          energy,
          options: null,
          fetchedAt: new Date().toISOString(),
        });
        setMarketLoading(true);
      } catch {
        /* snapshot still tried below */
      }

      const snap = await fetchMarketSnapshot(force);
      setMarket(snap);
    } catch (err) {
      // Keep any fast-path fro/energy already painted; no red timeout if last-good exists.
      const have = useDashboardStore.getState().fro;
      if (!have || !isRequestTimeout(err)) {
        setMarketError(String(err));
      } else {
        setMarketLoading(false);
      }
    } finally {
      marketInFlight.current = false;
    }
  }, [setMarket, setMarketError, setMarketLoading]);

  const refreshPortfolio = useCallback(
    async (
      accountIdKeyOverride?: string,
      opts?: { silent?: boolean },
    ) => {
      if (portfolioInFlight.current) return;
      portfolioInFlight.current = true;
      const silent = Boolean(opts?.silent);
      if (!silent) setEtradeLoading(true);
      try {
        const status = await fetchEtradeStatus();
        setEtrade(status);
        if (status.authorized) {
          const acctList = await fetchEtradeAccounts();
          setAccounts(acctList);
          const preferred =
            accountIdKeyOverride ??
            useDashboardStore.getState().selectedAccountIdKey;
          const pickerKeys = portfolioAccountOptions(acctList).map(
            (a) => a.accountIdKey,
          );
          const resolvedKey =
            (preferred && pickerKeys.includes(preferred) ? preferred : null) ??
            (isRobinhoodAccountKey(preferred) &&
            pickerKeys.includes("robinhood")
              ? "robinhood"
              : null) ??
            FULL_PORTFOLIO_ACCOUNT_ID_KEY;
          if (resolvedKey) setSelectedAccountIdKey(resolvedKey);
          const pf = await fetchPortfolio(resolvedKey);
          setSelectedAccountIdKey(pf.accountIdKey);
          setPortfolio(pf);
        } else {
          // E*TRADE logged out — still show Robinhood disk book + picker.
          const rhOnly = [robinhoodPickerAccount()];
          setAccounts(rhOnly);
          const preferred =
            accountIdKeyOverride ??
            useDashboardStore.getState().selectedAccountIdKey;
          const viewKey = isRobinhoodAccountKey(preferred)
            ? "robinhood"
            : isFullPortfolioKey(preferred)
              ? "full"
              : "robinhood";
          setSelectedAccountIdKey(viewKey);
          try {
            const ext = await loadExternalOnlyPortfolio();
            if (viewKey === "full") {
              setPortfolio({
                ...ext,
                accountIdKey: FULL_PORTFOLIO_ACCOUNT_ID_KEY,
                accountDesc: "Full portfolio",
                accountType: "COMBINED",
                sections: [
                  {
                    accountIdKey: "robinhood",
                    accountId: null,
                    accountDesc: "Robinhood",
                    accountType: "EXTERNAL",
                    accountMode: null,
                    positions: ext.positions,
                    totals: ext.totals,
                  },
                ],
              });
            } else {
              setPortfolio(ext);
            }
          } catch {
            setPortfolio(null);
          }
          if (!silent) setEtradeLoading(false);
        }
      } catch (err) {
        const msg = String(err);
        if (/session expired|token_expired/i.test(msg)) {
          try {
            await logoutEtrade();
          } catch {
            /* ignore */
          }
          if (window.tradehole?.clearTokens) await window.tradehole.clearTokens();
          const status = await fetchEtradeStatus();
          setEtrade(status);
          setAccounts([robinhoodPickerAccount()]);
          setSelectedAccountIdKey("robinhood");
          try {
            const ext = await loadExternalOnlyPortfolio();
            setPortfolio(ext);
          } catch {
            setPortfolio(null);
          }
          setEtradeError(
            "E*TRADE session expired. Open authorize URL and paste a new verification code.",
          );
          return;
        }
        // Keep last-good portfolio painted, but never pretend the poll succeeded.
        setEtradeError(msg);
      } finally {
        portfolioInFlight.current = false;
      }
    },
    [
      setAccounts,
      setEtrade,
      setEtradeError,
      setEtradeLoading,
      setPortfolio,
      setSelectedAccountIdKey,
    ],
  );

  const refreshOsint = useCallback(async () => {
    try {
      const s = await fetchIronsightStatus();
      setIronsight(s.up, s.url);
      setIronsightFeedsFresh(
        typeof s.feedsFresh === "boolean" ? s.feedsFresh : s.up,
      );
    } catch {
      setIronsight(false, ironsightUrl);
      setIronsightFeedsFresh(false);
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
            // Market poll often races ahead of token restore on cold start —
            // force broker quotes once auth is in the API process.
            await Promise.all([refreshPortfolio(), refreshMarket()]);
            return;
          }
        }
        if (status.authorized) {
          await Promise.all([refreshPortfolio(), refreshMarket()]);
        }
      } catch (err) {
        setEtradeError(String(err));
      }
    })();
  }, [refreshMarket, refreshPortfolio, setEtrade, setEtradeError]);

  useEffect(() => {
    void refreshMarket();
    const id = window.setInterval(() => void refreshMarket(), marketPollMs);
    return () => window.clearInterval(id);
  }, [refreshMarket, marketPollMs]);

  useEffect(() => {
    if (!etrade?.authorized) return;
    const id = window.setInterval(
      () => void refreshPortfolio(undefined, { silent: true }),
      PORTFOLIO_POLL_MS,
    );
    return () => window.clearInterval(id);
  }, [etrade?.authorized, refreshPortfolio]);

  useEffect(() => {
    void refreshOsint();
    const id = window.setInterval(() => void refreshOsint(), OSINT_POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshOsint]);

  const onOptionsAllLoaded = useCallback((all: OptionsChainsAll) => {
    setOptionsAll(all);
  }, []);

  const focusCall =
    optionsAll?.chains
      .find((c) => c.expiry === "2026-09-18")
      ?.calls.find((c) => c.strike === 46) ??
    optionsAll?.chains.flatMap((c) => c.calls).find((c) => c.strike === 46) ??
    options?.calls.find((c) => c.strike === 46) ??
    null;

  const aerialRefreshCooldownUntil = useRef(0);
  const [aerialRefreshBusy, setAerialRefreshBusy] = useState(false);

  const refreshAerialForMap = useCallback(async () => {
    const now = Date.now();
    if (now < aerialRefreshCooldownUntil.current || aerialRefreshBusy) return;
    aerialRefreshCooldownUntil.current = now + 20_000;
    setAerialRefreshBusy(true);
    try {
      const ist = await fetchIsraelStrikeTells(true);
      setIsraelStrike(ist);
      if (ist.froGuidance) setFroGuidance(ist.froGuidance);
    } catch {
      /* aerial refresh best-effort */
    } finally {
      setAerialRefreshBusy(false);
    }
  }, [setIsraelStrike, aerialRefreshBusy]);

  return (
    <div
      className={`app ${tab === "ironsight" ? "app-ironsight" : ""} ${tab === "map" ? "app-map" : ""} ${tab === "news" ? "app-news" : ""} ${tab === "trade" ? "app-trade" : ""}`}
    >
      <header className="chrome">
        <span className="brand-mark">Tradehole</span>
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
            className={tab === "trade" ? "tab active" : "tab"}
            onClick={() => setTab("trade")}
          >
            Trade
          </button>
          <button
            type="button"
            className={tab === "ironsight" ? "tab active" : "tab"}
            onClick={() => setTab("ironsight")}
          >
            IRONSIGHT
            <span className={`tab-dot ${ironsightUp ? "on" : ""}`} />
          </button>
          <button
            type="button"
            className={tab === "map" ? "tab active" : "tab"}
            onClick={() => setTab("map")}
          >
            Map
          </button>
          <button
            type="button"
            className={tab === "news" ? "tab active" : "tab"}
            onClick={() => setTab("news")}
          >
            News
          </button>
        </nav>
        <div className="chrome-actions">
          {tab === "markets" && <CopyDossierButton symbol="FRO" />}
          {(tab === "markets" || tab === "trade") && (
            <button
              type="button"
              className="ghost chrome-btn"
              disabled={marketLoading || etradeLoading}
              onClick={() => {
                void refreshMarket(true);
                void refreshPortfolio();
              }}
            >
              Refresh
            </button>
          )}
          {tab === "ironsight" && <CopyIronsightNewsButton compact />}
          {tab === "ironsight" && (
            <button
              type="button"
              className="ghost chrome-btn"
              onClick={() => void refreshOsint()}
            >
              Recheck
            </button>
          )}
          <button
            type="button"
            className="ghost chrome-btn osint-map-copy-all"
            disabled={mapCopyFlash === "Fetching…"}
            title="Copy LIVE Map board (aerial + theater stamps + zones) from API — works on any tab"
            onClick={() => {
              if (mapCopyBusy.current) return;
              mapCopyBusy.current = true;
              setMapCopyFlash("Fetching…");
              void copyLiveMapAssets({ israelStrike })
                .then(() => {
                  setMapCopyFlash("Copied Map assets");
                  window.setTimeout(() => setMapCopyFlash(null), 2000);
                })
                .catch(() => {
                  setMapCopyFlash("Copy failed");
                  window.setTimeout(() => setMapCopyFlash(null), 2200);
                })
                .finally(() => {
                  mapCopyBusy.current = false;
                });
            }}
          >
            {mapCopyFlash ?? "Copy displayed assets"}
          </button>
          {tab === "map" && (
            <button
              type="button"
              className="ghost chrome-btn"
              disabled={aerialRefreshBusy}
              title="Force Levant AER-01 refresh (20s cooldown — avoid adsb.lol 429)"
              onClick={() => void refreshAerialForMap()}
            >
              {aerialRefreshBusy ? "Refreshing…" : "Refresh aerial"}
            </button>
          )}
        </div>
      </header>

      {marketError && (tab === "markets" || tab === "trade") && (
        <p className="banner error">{marketError}</p>
      )}

      {tab === "markets" ? (
        <main className="dashboard dashboard-markets">
          <div className="col-left">
            <StockPrice
              quote={fro}
              loading={marketLoading}
              pollMs={marketPollMs}
              nowMs={nowMs}
            />
            <EnergyQuotes energy={energy} pollMs={marketPollMs} />
            <MarketChartsPanel />
            <PhysicalMarketsPanel physical={physical} loading={marketLoading} />
            <FroCatalystPanel />
            <ShekelSpikePanel />
          </div>

          <div className="col-right markets-intel">
            <IsraelStrikeTellsPanel onOpenMap={() => setTab("map")} />
            <KineticRewindPanel />
            <DecisionFootprintPanel />
            <MarketSurprisePanel />
            <IntelAlarmPanel />
            <TheaterWatchPanel />
            <p className="muted tiny markets-trade-hint">
              Options, book, and playbook live on the{" "}
              <button
                type="button"
                className="linkish"
                onClick={() => setTab("trade")}
              >
                Trade
              </button>{" "}
              tab.
            </p>
          </div>
        </main>
      ) : tab === "trade" ? (
        <main className="dashboard dashboard-trade">
          <div className="trade-top">
            <StockPrice
              quote={fro}
              loading={marketLoading}
              pollMs={marketPollMs}
              nowMs={nowMs}
            />
            <BookStrip refreshKey={ordersRefreshKey} />
          </div>
          <div className="col-left trade-main">
            <OptionsChain
              symbol="FRO"
              highlightStrike={46}
              focusExpiry="2026-09-18"
              pollMs={marketPollMs}
              nowMs={nowMs}
              onChainsLoaded={onOptionsAllLoaded}
            />
            <VolatilityPanel report={volatility} loading={marketLoading} />
            <StrategyIntelPanel symbol="FRO" />
            <HistoryPanel symbol="FRO" />
          </div>
          <div className="col-right trade-book">
            <TradeProposalPanel
              onApproveDraft={(draft) => setTradeDraft(draft)}
            />
            <Positions
              status={etrade}
              accounts={accounts}
              selectedAccountIdKey={selectedAccountIdKey}
              portfolio={portfolio}
              error={etradeError}
              loading={etradeLoading}
              onAuthorized={() => void refreshPortfolio()}
              onAccountChange={(accountIdKey) => {
                setSelectedAccountIdKey(accountIdKey);
                void refreshPortfolio(accountIdKey);
              }}
              onLoggedOut={() => {
                setPortfolio(null);
                void refreshPortfolio();
              }}
              onExternalChanged={() => void refreshPortfolio()}
            />
            <OpenOrdersPanel
              status={etrade}
              portfolio={portfolio}
              tradingAccountIdKey={tradingAccountIdKey}
              refreshKey={ordersRefreshKey}
            />
            <TradeOrderPanel
              status={etrade}
              portfolio={portfolio}
              tradingAccountIdKey={tradingAccountIdKey}
              focusCall={focusCall}
              draft={tradeDraft}
              onDraftConsumed={() => setTradeDraft(null)}
              onPlaced={() => {
                setOrdersRefreshKey((k) => k + 1);
                void refreshPortfolio();
              }}
            />
          </div>
        </main>
      ) : tab === "ironsight" ? (
        <main className="ironsight-main">
          <FreeOsintToolkit />
          <Geopolitical up={ironsightUp} url={ironsightUrl} mode="page" />
        </main>
      ) : tab === "news" ? (
        <main className="news-reader-main">
          <NewsReaderPanel />
        </main>
      ) : (
        <main className="osint-map-main">
          <OsintTheaterMap
            onRefreshAerial={() => void refreshAerialForMap()}
          />
        </main>
      )}

      <StatusBar
        marketFetchedAt={marketFetchedAt}
        marketLoading={marketLoading}
        etradeAuthorized={etrade?.authorized ?? null}
        ironsightUp={ironsightUp}
        ironsightFeedsFresh={ironsightFeedsFresh}
        marketSource={marketSource}
        marketPollMs={marketPollMs}
        osintPollMs={OSINT_POLL_MS}
        nowMs={nowMs}
        intelLevel={intelLevel}
        intelLockCount={intelLockCount}
        intelRedReason={intelRedReason}
        intelBibiTrigger={intelBibiTrigger}
        shekelPrice={shekelAlarm?.price ?? null}
        shekelSpiked={shekelAlarm?.spiked ?? null}
        shekelRegime={shekelAlarm?.regime ?? null}
        shekelThreshold={shekelAlarm?.threshold ?? null}
        froGuidance={froGuidance}
        ghostLit={ghostLit}
        ghostMax={ghostMax}
        aerialTankers={israelStrike?.inputs.aerialTankersLevant ?? null}
        aerialAwacs={israelStrike?.inputs.aerialAwacsLevant ?? null}
        aerStatus={
          israelStrike?.tells.find((t) => t.id === "AER-01")?.status ?? null
        }
        goLanguageStatus={israelStrike?.inputs.goLanguageStatus ?? null}
        goLanguageHits={israelStrike?.inputs.goLanguageHits ?? []}
        politicsHeadline={politicsHeadline}
        runtimeMode={runtimeMode}
        runtimeBuildTime={runtimeBuildTime}
      />

      <OrderFillAlarm
        status={etrade}
        portfolio={portfolio}
        tradingAccountIdKey={tradingAccountIdKey}
        refreshKey={ordersRefreshKey}
        onFill={() => {
          setOrdersRefreshKey((k) => k + 1);
          void refreshPortfolio();
        }}
      />
      <FlowAlarm symbol="FRO" />
      <DealWatchAlarm />
      <ShekelSpikeAlarm />
      <IsraelStrikeAlarm />
    </div>
  );
}
