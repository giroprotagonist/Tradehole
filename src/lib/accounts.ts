import type { EtradeAccount } from "../types";

/** Synthetic Robinhood / external peer account (not an E*TRADE key). */
export const ROBINHOOD_ACCOUNT_ID_KEY = "robinhood";

/** Combined scrollable portfolio across included accounts. */
export const FULL_PORTFOLIO_ACCOUNT_ID_KEY = "full";

export const FULL_PORTFOLIO_ACCOUNT: EtradeAccount = {
  accountIdKey: FULL_PORTFOLIO_ACCOUNT_ID_KEY,
  accountDesc: "Full portfolio",
  accountName: "Full portfolio",
  accountType: "COMBINED",
  accountStatus: "ACTIVE",
};

export function isRobinhoodAccountKey(key?: string | null): boolean {
  const k = (key ?? "").trim().toLowerCase();
  return k === ROBINHOOD_ACCOUNT_ID_KEY || k === "external" || k === "rh";
}

export function isFullPortfolioKey(key?: string | null): boolean {
  return (key ?? "").trim().toLowerCase() === FULL_PORTFOLIO_ACCOUNT_ID_KEY;
}

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

/** Synthetic Robinhood row for the account picker (always available — disk book). */
export function robinhoodPickerAccount(
  accounts: EtradeAccount[] = [],
): EtradeAccount {
  return (
    accounts.find((a) => isRobinhoodAccountKey(a.accountIdKey)) ??
    ({
      accountIdKey: ROBINHOOD_ACCOUNT_ID_KEY,
      accountDesc: "Robinhood",
      accountName: "Robinhood",
      accountType: "EXTERNAL",
      accountStatus: "ACTIVE",
    } satisfies EtradeAccount)
  );
}

/** Account picker entries: full portfolio + Robinhood (RH is always listed). */
export function portfolioAccountOptions(accounts: EtradeAccount[]): EtradeAccount[] {
  return [FULL_PORTFOLIO_ACCOUNT, robinhoodPickerAccount(accounts)];
}

/** E*TRADE account used for orders/trading when the full portfolio view is selected. */
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
