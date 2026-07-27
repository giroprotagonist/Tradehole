import { create } from "zustand";
import type {
  EtradeStatus,
  OptionsChain,
  PhysicalMarkets,
  Portfolio,
  StockQuote,
  VolatilityReport,
} from "../types";

type DashboardState = {
  fro: StockQuote | null;
  energy: { wti: StockQuote; brent: StockQuote } | null;
  options: OptionsChain | null;
  volatility: VolatilityReport | null;
  physical: PhysicalMarkets | null;
  marketFetchedAt: string | null;
  marketError: string | null;
  marketLoading: boolean;

  etrade: EtradeStatus | null;
  portfolio: Portfolio | null;
  etradeError: string | null;
  etradeLoading: boolean;

  ironsightUp: boolean | null;
  ironsightUrl: string;

  selectedExpiry: string | null;
  setSelectedExpiry: (expiry: string | null) => void;

  setMarket: (payload: {
    fro: StockQuote;
    energy: { wti: StockQuote; brent: StockQuote };
    options: OptionsChain;
    volatility?: VolatilityReport;
    physical?: PhysicalMarkets;
    fetchedAt: string;
  }) => void;
  setMarketError: (error: string | null) => void;
  setMarketLoading: (loading: boolean) => void;

  setEtrade: (status: EtradeStatus | null) => void;
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
  portfolio: null,
  etradeError: null,
  etradeLoading: false,

  ironsightUp: null,
  ironsightUrl: "http://localhost:3170",

  selectedExpiry: null,
  setSelectedExpiry: (expiry) => set({ selectedExpiry: expiry }),

  setMarket: ({ fro, energy, options, volatility, physical, fetchedAt }) =>
    set((state) => ({
      fro,
      energy,
      options,
      volatility: volatility ?? state.volatility,
      physical: physical ?? state.physical,
      marketFetchedAt: fetchedAt,
      marketError: null,
      marketLoading: false,
      selectedExpiry: state.selectedExpiry ?? options.selectedExpiry,
    })),
  setMarketError: (marketError) => set({ marketError, marketLoading: false }),
  setMarketLoading: (marketLoading) => set({ marketLoading }),

  setEtrade: (etrade) => set({ etrade }),
  setPortfolio: (portfolio) => set({ portfolio, etradeError: null, etradeLoading: false }),
  setEtradeError: (etradeError) => set({ etradeError, etradeLoading: false }),
  setEtradeLoading: (etradeLoading) => set({ etradeLoading }),

  setIronsight: (ironsightUp, ironsightUrl) => set({ ironsightUp, ironsightUrl }),
}));
