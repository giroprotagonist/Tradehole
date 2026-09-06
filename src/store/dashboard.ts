import { create } from "zustand";
import { FULL_PORTFOLIO_ACCOUNT_ID_KEY } from "../lib/accounts";
import type { EnergyQuotesPayload, ShekelAlarmSnapshot } from "../services/api";
import type {
  EtradeAccount,
  EtradeStatus,
  IsraelStrikeTells,
  OptionsChain,
  PhysicalMarkets,
  Portfolio,
  StockQuote,
  VolatilityReport,
} from "../types";

const ACCOUNT_STORAGE_KEY = "tradehole.etrade.accountIdKey";

function loadStoredAccountKey(): string | null {
  try {
    return localStorage.getItem(ACCOUNT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistAccountKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(ACCOUNT_STORAGE_KEY, key);
    else localStorage.removeItem(ACCOUNT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

type DashboardState = {
  fro: StockQuote | null;
  energy: EnergyQuotesPayload | null;
  options: OptionsChain | null;
  volatility: VolatilityReport | null;
  physical: PhysicalMarkets | null;
  marketFetchedAt: string | null;
  marketError: string | null;
  marketLoading: boolean;

  etrade: EtradeStatus | null;
  accounts: EtradeAccount[];
  selectedAccountIdKey: string | null;
  portfolio: Portfolio | null;
  etradeError: string | null;
  etradeLoading: boolean;

  ironsightUp: boolean | null;
  ironsightUrl: string;

  /** USD/ILS Shekel spike alarm (from intel-alarm poll). */
  shekelAlarm: ShekelAlarmSnapshot | null;
  setShekelAlarm: (shekelAlarm: ShekelAlarmSnapshot | null) => void;

  /** Shared Israel strike tells (App poller → alarm + panel + StatusBar). */
  israelStrike: IsraelStrikeTells | null;
  setIsraelStrike: (israelStrike: IsraelStrikeTells | null) => void;

  selectedExpiry: string | null;
  setSelectedExpiry: (expiry: string | null) => void;

  setMarket: (payload: {
    fro: StockQuote;
    energy: EnergyQuotesPayload | null;
    options: OptionsChain | null;
    volatility?: VolatilityReport | null;
    physical?: PhysicalMarkets | null;
    fetchedAt: string;
    partialErrors?: string[];
  }) => void;
  setMarketError: (error: string | null) => void;
  setMarketLoading: (loading: boolean) => void;

  setEtrade: (status: EtradeStatus | null) => void;
  setAccounts: (accounts: EtradeAccount[]) => void;
  setSelectedAccountIdKey: (accountIdKey: string | null) => void;
  setPortfolio: (portfolio: Portfolio | null) => void;
  setEtradeError: (error: string | null) => void;
  setEtradeLoading: (loading: boolean) => void;

  setIronsight: (up: boolean, url: string) => void;
};

export const useDashboardStore = create<DashboardState>((set) => ({
  fro: null,
  energy: null,
  options: null,
  volatility: null,
  physical: null,
  marketFetchedAt: null,
  marketError: null,
  marketLoading: false,

  etrade: null,
  accounts: [],
  selectedAccountIdKey: loadStoredAccountKey() ?? FULL_PORTFOLIO_ACCOUNT_ID_KEY,
  portfolio: null,
  etradeError: null,
  etradeLoading: false,

  ironsightUp: null,
  ironsightUrl: "http://localhost:3170",

  shekelAlarm: null,
  setShekelAlarm: (shekelAlarm) => set({ shekelAlarm }),

  israelStrike: null,
  setIsraelStrike: (israelStrike) => set({ israelStrike }),

  selectedExpiry: null,
  setSelectedExpiry: (expiry) => set({ selectedExpiry: expiry }),

  setMarket: ({ fro, energy, options, volatility, physical, fetchedAt, partialErrors }) =>
    set((state) => ({
      fro,
      energy: energy ?? state.energy,
      options: options ?? state.options,
      volatility: volatility ?? state.volatility,
      physical: physical ?? state.physical,
      marketFetchedAt: fetchedAt,
      marketError: partialErrors?.length
        ? `Partial: ${partialErrors.join("; ")}`
        : null,
      marketLoading: false,
      selectedExpiry:
        state.selectedExpiry ?? options?.selectedExpiry ?? state.selectedExpiry,
    })),
  setMarketError: (marketError) => set({ marketError, marketLoading: false }),
  setMarketLoading: (marketLoading) => set({ marketLoading }),

  setEtrade: (etrade) => set({ etrade }),
  setAccounts: (accounts) => set({ accounts }),
  setSelectedAccountIdKey: (selectedAccountIdKey) => {
    persistAccountKey(selectedAccountIdKey);
    set({ selectedAccountIdKey });
  },
  setPortfolio: (portfolio) => set({ portfolio, etradeError: null, etradeLoading: false }),
  setEtradeError: (etradeError) => set({ etradeError, etradeLoading: false }),
  setEtradeLoading: (etradeLoading) => set({ etradeLoading }),

  setIronsight: (ironsightUp, ironsightUrl) => set({ ironsightUp, ironsightUrl }),
}));
