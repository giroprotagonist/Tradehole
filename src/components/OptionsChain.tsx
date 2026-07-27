import { fmtMoney, fmtVol } from "../lib/format";
import type { OptionContract, OptionsChain } from "../types";

type Props = {
  options: OptionsChain | null;
  selectedExpiry: string | null;
  onExpiryChange: (expiry: string) => void;
  highlightStrike?: number;
};

function nearStrike(strike: number, target: number): boolean {
  return Math.abs(strike - target) <= 2;
}

function ContractTable({
  rows,
  highlightStrike,
}: {
  rows: OptionContract[];
  highlightStrike: number;
}) {
  return (
    <div className="table-wrap">
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
          {rows.map((row) => (
            <tr
              key={row.contractSymbol}
              className={nearStrike(row.strike, highlightStrike) ? "highlight" : undefined}
            >
              <td>{fmtMoney(row.strike, 1)}</td>
              <td>{fmtMoney(row.lastPrice)}</td>
              <td>{fmtMoney(row.bid)}</td>
              <td>{fmtMoney(row.ask)}</td>
              <td>
                {row.impliedVolatility != null
                  ? `${(row.impliedVolatility * 100).toFixed(1)}%`
                  : "—"}
              </td>
              <td>{fmtVol(row.volume)}</td>
              <td>{fmtVol(row.openInterest)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OptionsChain({
  options,
  selectedExpiry,
  onExpiryChange,
  highlightStrike = 46,
}: Props) {
  if (!options) {
    return (
      <section className="panel options-panel">
        <h2>Options</h2>
        <p className="muted">Loading chain…</p>
      </section>
    );
  }

  const spot = options.underlyingPrice ?? highlightStrike;
  const calls = options.calls
    .filter(
      (c) =>
        Math.abs(c.strike - highlightStrike) <= 10 ||
        Math.abs(c.strike - spot) <= 6,
    )
    .sort((a, b) => a.strike - b.strike);
  const puts = options.puts
    .filter(
      (p) =>
        Math.abs(p.strike - highlightStrike) <= 10 ||
        Math.abs(p.strike - spot) <= 6,
    )
    .sort((a, b) => a.strike - b.strike);

  return (
    <section className="panel options-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">FRO options</p>
          <h2>Chain</h2>
          <p className="muted">
            Highlighting strikes near ${highlightStrike} · underlying $
            {fmtMoney(options.underlyingPrice)}
          </p>
        </div>
        <label className="expiry-select">
          <span>Expiry</span>
          <select
            value={selectedExpiry ?? options.selectedExpiry ?? ""}
            onChange={(e) => onExpiryChange(e.target.value)}
          >
            {options.expirationDates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="chain-split">
        <div>
          <h3>Calls</h3>
          <ContractTable rows={calls} highlightStrike={highlightStrike} />
        </div>
        <div>
          <h3>Puts</h3>
          <ContractTable rows={puts} highlightStrike={highlightStrike} />
        </div>
      </div>
    </section>
  );
}
