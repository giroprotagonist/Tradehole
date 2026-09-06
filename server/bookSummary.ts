import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listExternalPositions } from "./externalPositions";

function dataDir(): string {
  if (process.env.TRADEHOLE_DATA_DIR) return process.env.TRADEHOLE_DATA_DIR;
  return path.join(os.homedir(), "Library", "Application Support", "Tradehole");
}

export type BookLeg = {
  account: string;
  accountIdKey: string;
  symbol: string;
  description: string;
  quantity: number;
  avgCost: number | null;
  kind: "option" | "equity";
};

export type BookSummary = {
  asOf: string;
  focus46cTotal: number;
  legs: BookLeg[];
  byAccount: Array<{
    account: string;
    accountIdKey: string;
    focus46c: number;
    legs: BookLeg[];
  }>;
};

function isFocus46Call(p: {
  symbol?: unknown;
  symbolDescription?: unknown;
  strike?: unknown;
  callPut?: unknown;
}): boolean {
  const sym = String(p.symbol ?? "").toUpperCase();
  const desc = String(p.symbolDescription ?? "").toUpperCase();
  if (sym === "FRO" && Number(p.strike) === 46 && String(p.callPut).toLowerCase() === "call") {
    return true;
  }
  if (!sym.includes("FRO") && !desc.includes("FRO")) return false;
  if (!desc.includes("46") && !sym.includes("46")) return false;
  return desc.includes("CALL") || sym.includes("C");
}

/** Aggregate Rollover/Roth (cache) + Robinhood disk book for desk strip / paste. */
export function buildBookSummary(): BookSummary {
  const legs: BookLeg[] = [];
  let focus46cTotal = 0;

  try {
    const cachePath = path.join(dataDir(), "portfolio-cache.json");
    if (fs.existsSync(cachePath)) {
      const cache = JSON.parse(fs.readFileSync(cachePath, "utf8")) as {
        cachedAt?: string;
        portfolios?: Array<{
          accountDesc?: string | null;
          accountType?: string | null;
          accountIdKey?: string;
          positions?: Array<Record<string, unknown>>;
        }>;
      };
      for (const bag of cache.portfolios ?? []) {
        const key = String(bag.accountIdKey ?? "");
        if (key === "robinhood" || key === "external") continue;
        const label =
          bag.accountDesc || bag.accountType || key || "E*TRADE";
        for (const p of bag.positions ?? []) {
          const qty = Number(p.quantity ?? 0);
          if (!qty) continue;
          const sym = String(p.symbol ?? "").toUpperCase();
          const desc = String(p.symbolDescription ?? sym);
          const focus = isFocus46Call(p);
          if (focus) focus46cTotal += qty;
          legs.push({
            account: label,
            accountIdKey: key,
            symbol: sym,
            description: desc,
            quantity: qty,
            avgCost:
              typeof p.pricePaid === "number" ? p.pricePaid : null,
            kind: String(p.typeCode ?? "").includes("OPT")
              ? "option"
              : "equity",
          });
        }
      }
    }
  } catch {
    /* ignore cache */
  }

  try {
    for (const p of listExternalPositions()) {
      const desc = `${p.symbol} ${p.expiry} $${p.strike}${p.callPut === "call" ? "c" : "p"} · RH`;
      const focus =
        p.symbol.toUpperCase() === "FRO" &&
        Math.abs(p.strike - 46) < 0.01 &&
        p.callPut === "call";
      if (focus) focus46cTotal += p.quantity;
      legs.push({
        account: "Robinhood",
        accountIdKey: "robinhood",
        symbol: p.symbol.toUpperCase(),
        description: desc,
        quantity: p.quantity,
        avgCost: p.avgCost,
        kind: "option",
      });
    }
  } catch {
    /* ignore */
  }

  const byKey = new Map<
    string,
    { account: string; accountIdKey: string; focus46c: number; legs: BookLeg[] }
  >();
  for (const leg of legs) {
    const cur = byKey.get(leg.accountIdKey) ?? {
      account: leg.account,
      accountIdKey: leg.accountIdKey,
      focus46c: 0,
      legs: [],
    };
    cur.legs.push(leg);
    if (isFocus46Call({
      symbol: leg.symbol,
      symbolDescription: leg.description,
      strike: leg.description.match(/\$(\d+)/)?.[1],
      callPut: /call/i.test(leg.description) ? "call" : undefined,
    }) || (leg.symbol === "FRO" && /\$46c/i.test(leg.description))) {
      cur.focus46c += leg.quantity;
    }
    byKey.set(leg.accountIdKey, cur);
  }

  // Recompute focus per account from legs more carefully
  for (const bag of byKey.values()) {
    bag.focus46c = bag.legs
      .filter(
        (l) =>
          l.symbol === "FRO" &&
          (/\$46\s*c/i.test(l.description) ||
            /46.*Call/i.test(l.description)),
      )
      .reduce((s, l) => s + l.quantity, 0);
  }

  return {
    asOf: new Date().toISOString(),
    focus46cTotal,
    legs,
    byAccount: [...byKey.values()],
  };
}
