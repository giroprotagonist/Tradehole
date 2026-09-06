import {
  isRobinhoodAccountKey,
  listMarkedExternalPositions,
  ROBINHOOD_ACCOUNT_ID_KEY,
  sumExternalTotals,
} from "./externalPositions";
import {
  getPortfolio,
  listAccounts,
  type EtradeAccount,
  type PositionRow,
} from "./etrade";

export const FULL_PORTFOLIO_ACCOUNT_ID_KEY = "full";

export const FULL_PORTFOLIO_ACCOUNT: EtradeAccount = {
  accountIdKey: FULL_PORTFOLIO_ACCOUNT_ID_KEY,
  accountDesc: "Full portfolio",
  accountName: "Full portfolio",
  accountType: "COMBINED",
  accountStatus: "ACTIVE",
};

function accountLast4(a: EtradeAccount): string {
  const id = a.accountId != null ? String(a.accountId) : "";
  const norm = id.replace(/\s+/g, "");
  return norm.length >= 4 ? norm.slice(-4) : norm;
}

/** Hide brokerage + Roth IRA *8105 from the combined desk view. */
export function isExcludedFromFullPortfolio(a: EtradeAccount): boolean {
  const last4 = accountLast4(a);
  const type = (a.accountType ?? "").toUpperCase();
  const desc = `${a.accountDesc ?? ""} ${a.accountName ?? ""}`.toUpperCase();
  if (last4 === "8105") return true;
  if (type.includes("BROKERAGE") || desc.includes("BROKERAGE")) return true;
  return false;
}

export type PortfolioSection = {
  accountIdKey: string;
  accountId: string | null;
  accountDesc: string | null;
  accountType: string | null;
  accountMode: string | null;
  positions: PositionRow[];
  totals: {
    marketValue: number;
    totalCost: number;
    totalGain: number;
    daysGain: number;
  };
  stale?: boolean;
  warnings?: string[];
};

export type FullPortfolioResult = {
  accountIdKey: typeof FULL_PORTFOLIO_ACCOUNT_ID_KEY;
  accountId: null;
  accountDesc: string;
  accountType: string;
  accountMode: null;
  sections: PortfolioSection[];
  positions: PositionRow[];
  totals: PortfolioSection["totals"];
  externalTotals: PortfolioSection["totals"];
  externalCount: number;
  etradeTotals: PortfolioSection["totals"];
  fetchedAt: string;
  stale?: boolean;
  warnings?: string[];
};

function addTotals(
  acc: PortfolioSection["totals"],
  row: PortfolioSection["totals"],
): void {
  acc.marketValue += row.marketValue;
  acc.totalCost += row.totalCost;
  acc.totalGain += row.totalGain;
  acc.daysGain += row.daysGain;
}

function emptyTotals(): PortfolioSection["totals"] {
  return { marketValue: 0, totalCost: 0, totalGain: 0, daysGain: 0 };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getFullPortfolio(): Promise<FullPortfolioResult> {
  const accounts = await listAccounts();
  const included = accounts.filter((a) => !isExcludedFromFullPortfolio(a));
  const sections: PortfolioSection[] = [];
  const totals = emptyTotals();
  const etradeTotals = emptyTotals();
  let anyStale = false;
  const warnings: string[] = [];

  for (let i = 0; i < included.length; i++) {
    const account = included[i]!;
    try {
      const pf = await getPortfolio(account.accountIdKey);
      const rows = pf.positions.map((row) => ({
        ...row,
        broker: row.broker ?? "E*TRADE",
        brokerTag: row.brokerTag ?? "ET",
      }));
      const section: PortfolioSection = {
        accountIdKey: pf.accountIdKey,
        accountId: pf.accountId,
        accountDesc: pf.accountDesc,
        accountType: pf.accountType,
        accountMode: pf.accountMode,
        positions: rows,
        totals: pf.totals,
        stale: pf.stale,
        warnings: pf.warnings,
      };
      sections.push(section);
      addTotals(totals, pf.totals);
      addTotals(etradeTotals, pf.totals);
      if (pf.stale) anyStale = true;
      if (pf.warnings?.length) warnings.push(...pf.warnings);
    } catch (err) {
      warnings.push(
        `${account.accountDesc ?? account.accountType ?? account.accountIdKey}: ${String(err)}`,
      );
    }
    if (i < included.length - 1) await sleep(150);
  }

  const external = await listMarkedExternalPositions();
  const extTotals = sumExternalTotals(external);
  sections.push({
    accountIdKey: ROBINHOOD_ACCOUNT_ID_KEY,
    accountId: null,
    accountDesc: "Robinhood",
    accountType: "EXTERNAL",
    accountMode: null,
    positions: external,
    totals: extTotals,
  });
  addTotals(totals, extTotals);

  const flatPositions = sections.flatMap((s) => s.positions);

  return {
    accountIdKey: FULL_PORTFOLIO_ACCOUNT_ID_KEY,
    accountId: null,
    accountDesc: "Full portfolio",
    accountType: "COMBINED",
    accountMode: null,
    sections,
    positions: flatPositions,
    totals,
    etradeTotals,
    externalTotals: extTotals,
    externalCount: external.length,
    fetchedAt: new Date().toISOString(),
    stale: anyStale || undefined,
    warnings: warnings.length ? warnings : undefined,
  };
}

export function isFullPortfolioKey(key?: string | null): boolean {
  return (key ?? "").trim().toLowerCase() === FULL_PORTFOLIO_ACCOUNT_ID_KEY;
}

export function resolveTradingAccountIdKey(
  accounts: EtradeAccount[],
  selectedKey?: string | null,
): string | null {
  if (
    selectedKey &&
    !isFullPortfolioKey(selectedKey) &&
    !isRobinhoodAccountKey(selectedKey)
  ) {
    return selectedKey;
  }
  const included = accounts.filter(
    (a) =>
      !isRobinhoodAccountKey(a.accountIdKey) &&
      !isExcludedFromFullPortfolio(a),
  );
  const rollover = included.find((a) => accountLast4(a) === "0505");
  return rollover?.accountIdKey ?? included[0]?.accountIdKey ?? null;
}
