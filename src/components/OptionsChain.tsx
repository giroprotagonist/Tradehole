import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { fmtMoney, fmtVol } from "../lib/format";
import { fetchAllOptionsChains } from "../services/api";
import type { OptionContract, OptionsChainSlice, OptionsChainsAll } from "../types";
import { FlashValue, formatAge, formatPollLabel } from "./FlashValue";

type Props = {
  symbol: string;
  highlightStrike?: number;
  focusExpiry?: string;
  pollMs?: number;
  nowMs?: number;
  onChainsLoaded?: (all: OptionsChainsAll) => void;
};

function nearStrike(strike: number, target: number): boolean {
  return Math.abs(strike - target) <= 2;
}

function sourcePillLabel(source: string): string {
  if (source.startsWith("etrade:realtime")) return "E*TRADE live";
  if (
    source.toLowerCase().includes("closing") ||
    source.toLowerCase().includes("eh_")
  ) {
    return "E*TRADE closing/AH";
  }
  if (source.startsWith("etrade")) return "E*TRADE delayed";
  if (source === "error") return "Error";
  return "Yahoo delayed";
}

function sourcePillClass(source: string): string {
  return source.startsWith("etrade") && source.includes("realtime") ? "live" : "";
}

function FlashCell({
  value,
  children,
}: {
  value: number | null | undefined;
  children: ReactNode;
}) {
  return (
    <td>
      <FlashValue value={value}>{children}</FlashValue>
    </td>
  );
}

function ContractTable({
  rows,
  highlightStrike,
  scrollToFocus = false,
}: {
  rows: OptionContract[];
  highlightStrike: number;
  scrollToFocus?: boolean;
}) {
  const prevMap = useRef<Map<string, OptionContract>>(new Map());
  const wrapRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLTableRowElement>(null);
  const scrolledFor = useRef<string | null>(null);
  const [flashKeys, setFlashKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    const nextFlash = new Set<string>();
    for (const row of rows) {
      const prev = prevMap.current.get(row.contractSymbol);
      if (prev) {
        const changed =
          prev.lastPrice !== row.lastPrice ||
          prev.bid !== row.bid ||
          prev.ask !== row.ask ||
          prev.impliedVolatility !== row.impliedVolatility ||
          prev.volume !== row.volume;
        if (changed) nextFlash.add(row.contractSymbol);
      }
    }
    prevMap.current = new Map(rows.map((r) => [r.contractSymbol, r]));
    if (nextFlash.size) {
      setFlashKeys(nextFlash);
      const t = window.setTimeout(() => setFlashKeys(new Set()), 1400);
      return () => window.clearTimeout(t);
    }
  }, [rows]);

  const focusRow = (() => {
    let best: OptionContract | null = null;
    for (const row of rows) {
      if (Math.abs(row.strike - highlightStrike) < 0.01) return row;
      if (
        !best ||
        Math.abs(row.strike - highlightStrike) <
          Math.abs(best.strike - highlightStrike)
      ) {
        best = row;
      }
    }
    return best;
  })();

  useEffect(() => {
    if (!scrollToFocus) return;
    const key = `${highlightStrike}:${focusRow?.contractSymbol ?? ""}:${rows.length}`;
    if (scrolledFor.current === key) return;
    const row = highlightRef.current;
    const wrap = wrapRef.current;
    if (!row || !wrap) return;
    scrolledFor.current = key;
    const top =
      row.offsetTop - wrap.clientHeight / 2 + row.clientHeight / 2;
    wrap.scrollTop = Math.max(0, top);
  }, [rows, highlightStrike, focusRow?.contractSymbol, scrollToFocus]);

  return (
    <div className="table-wrap chain-table-wrap" ref={wrapRef}>
      <table>
        <thead>
          <tr>
            <th>Strike</th>
            <th>Last</th>
            <th>Bid</th>
            <th>Ask</th>
            <th>IV</th>
            <th>Vol</th>
            <th>OI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const near = nearStrike(row.strike, highlightStrike);
            const isFocus = focusRow?.contractSymbol === row.contractSymbol;
            const flashed = flashKeys.has(row.contractSymbol);
            return (
              <tr
                key={row.contractSymbol}
                ref={isFocus ? highlightRef : undefined}
                className={[near ? "highlight" : "", flashed ? "row-tick" : ""]
                  .filter(Boolean)
                  .join(" ") || undefined}
              >
                <td>{fmtMoney(row.strike, 1)}</td>
                <FlashCell value={row.lastPrice}>{fmtMoney(row.lastPrice)}</FlashCell>
                <FlashCell value={row.bid}>{fmtMoney(row.bid)}</FlashCell>
                <FlashCell value={row.ask}>{fmtMoney(row.ask)}</FlashCell>
                <FlashCell value={row.impliedVolatility}>
                  {row.impliedVolatility != null
                    ? `${(row.impliedVolatility * 100).toFixed(1)}%`
                    : "—"}
                </FlashCell>
                <FlashCell value={row.volume}>{fmtVol(row.volume)}</FlashCell>
                <td>{fmtVol(row.openInterest)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ExpirySection({
  chain,
  highlightStrike,
  focusExpiry,
}: {
  chain: OptionsChainSlice;
  highlightStrike: number;
  focusExpiry: string;
}) {
  const calls = [...chain.calls].sort((a, b) => a.strike - b.strike);
  const puts = [...chain.puts].sort((a, b) => a.strike - b.strike);
  const isFocusExpiry = chain.expiry === focusExpiry;

  if (chain.error) {
    return (
      <section className="chain-expiry-section">
        <header className="chain-expiry-head">
          <h3 className="expiry-header">{chain.expiry}</h3>
          <span className="pill">{sourcePillLabel(chain.source)}</span>
        </header>
        <p className="muted">{chain.error}</p>
      </section>
    );
  }

  return (
    <section className="chain-expiry-section">
      <header className="chain-expiry-head">
        <h3 className="expiry-header">
          {chain.expiry}
          {isFocusExpiry ? " · focus expiry" : ""}
        </h3>
        <span className={`pill ${sourcePillClass(chain.source)}`} title={chain.source}>
          {sourcePillLabel(chain.source)}
        </span>
      </header>
      <div className="chain-split">
        <div>
          <h4>Calls</h4>
          <ContractTable
            rows={calls}
            highlightStrike={highlightStrike}
            scrollToFocus={isFocusExpiry}
          />
        </div>
        <div>
          <h4>Puts</h4>
          <ContractTable rows={puts} highlightStrike={highlightStrike} />
        </div>
      </div>
    </section>
  );
}

export function OptionsChain({
  symbol,
  highlightStrike = 46,
  focusExpiry = "2026-09-18",
  pollMs,
  nowMs,
  onChainsLoaded,
}: Props) {
  const [all, setAll] = useState<OptionsChainsAll | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const data = await fetchAllOptionsChains(symbol);
      setAll(data);
      setError(null);
      onChainsLoaded?.(data);
    } catch (err) {
      setError(String(err));
    } finally {
      inFlight.current = false;
    }
  }, [symbol, onChainsLoaded]);

  useEffect(() => {
    void refresh();
    if (!pollMs) return;
    const id = window.setInterval(() => void refresh(), pollMs);
    return () => window.clearInterval(id);
  }, [refresh, pollMs]);

  if (!all && !error) {
    return (
      <section className="panel options-panel options-panel-all">
        <h2>Options</h2>
        <p className="muted">Loading all chains…</p>
      </section>
    );
  }

  if (!all && error) {
    return (
      <section className="panel options-panel options-panel-all">
        <h2>Options</h2>
        <p className="banner error">{error}</p>
      </section>
    );
  }

  if (!all) return null;

  const totalCalls = all.chains.reduce((n, c) => n + c.calls.length, 0);
  const totalPuts = all.chains.reduce((n, c) => n + c.puts.length, 0);
  const age = formatAge(all.fetchedAt, nowMs ?? Date.now());

  return (
    <section className="panel options-panel options-panel-all">
      <div className="panel-head">
        <div>
          <p className="eyebrow">FRO options</p>
          <h2>All chains</h2>
          <p className="muted">
            {all.expirationDates.length} expiries · focus ${highlightStrike} highlighted ·
            underlying $
            <FlashValue value={all.underlyingPrice}>
              {fmtMoney(all.underlyingPrice)}
            </FlashValue>
            {" · "}
            {totalCalls} calls / {totalPuts} puts
          </p>
          <p className="feed-meta muted tiny">
            {age}
            {pollMs != null ? ` · polls every ${formatPollLabel(pollMs)}` : ""}
            {" · cells flash when last/bid/ask/IV/vol move"}
          </p>
          {error && <p className="muted tiny">Last refresh error: {error}</p>}
        </div>
        <div className="panel-head-actions">
          <span
            className={`pill ${sourcePillClass(all.primarySource)}`}
            title={all.feedSources.join(", ")}
          >
            {sourcePillLabel(all.primarySource)}
          </span>
        </div>
      </div>

      <div className="chain-all-list">
        {all.chains.map((chain) => (
          <ExpirySection
            key={chain.expiry}
            chain={chain}
            highlightStrike={highlightStrike}
            focusExpiry={focusExpiry}
          />
        ))}
      </div>
    </section>
  );
}
