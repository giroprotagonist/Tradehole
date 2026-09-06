import { useDashboardStore } from "../store/dashboard";

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function openExternal(href: string): void {
  if (window.tradehole?.openExternal) {
    void window.tradehole.openExternal(href);
  } else {
    window.open(href, "_blank", "noopener,noreferrer");
  }
}

/** Dashboard panel — reads shekelAlarm from store (polled by ShekelSpikeAlarm). */
export function ShekelSpikePanel() {
  const shekel = useDashboardStore((s) => s.shekelAlarm);
  const regime = shekel?.regime ?? "unknown";
  const spiked = shekel?.spiked === true;
  const levelClass = spiked
    ? "intel-level red"
    : regime === "firm"
      ? "intel-level yellow"
      : regime === "quiet"
        ? "intel-level green"
        : "intel-level";

  return (
    <section
      className={`panel shekel-spike-panel ${spiked ? "spiked" : ""} ${
        regime === "firm" ? "firm" : ""
      }`}
    >
      <header className="panel-header">
        <h2>Shekel Spike Alarm · USD/ILS</h2>
        <span className={levelClass}>
          {spiked
            ? "SPIKED"
            : regime === "firm"
              ? "FIRM"
              : regime === "quiet"
                ? "QUIET"
                : "—"}
        </span>
      </header>
      <p className="muted intel-rule">
        {shekel?.rule ??
          "SPIKE if USD/ILS ≥ 3.85 (band ~3.9–4.0) OR (USD/ILS ≥ 3.6 AND d/d ≥ +1.5%). Crisis threshold ~4.00. Lagging market-panic arm for Bibi secondary → YELLOW alone / RED with ≥2 locks."}
      </p>
      {!shekel && (
        <p className="muted tiny">Waiting for intel-alarm poll…</p>
      )}
      {shekel && (
        <>
          <div className="shekel-metrics">
            <div>
              <p className="eyebrow">{shekel.symbol}</p>
              <p className="shekel-price">
                {shekel.price != null ? shekel.price.toFixed(4) : "—"}
              </p>
              <p className="muted tiny">
                d/d {pct(shekel.changePct)} · vs ~{shekel.threshold.toFixed(2)}
              </p>
            </div>
            <div className="shekel-thresholds">
              <p className="muted tiny">
                hard ≥{shekel.spikeHard} · band ~{shekel.spikeFloor.toFixed(1)}–
                {shekel.threshold.toFixed(2)}
              </p>
              <p className="muted tiny">
                ROC ≥{shekel.rocFloor}+{shekel.rocPct}% d/d
              </p>
              <div className="theater-actions" style={{ marginTop: "0.35rem" }}>
                <span className={`pill ${spiked ? "live" : ""}`}>
                  spiked={spiked ? "TRUE" : "false"}
                </span>
                <span className={`pill ${regime === "firm" ? "warn" : ""}`}>
                  {regime}
                </span>
              </div>
            </div>
          </div>
          <p className="theater-read">{shekel.read}</p>
          <p className="muted tiny">
            Bibi FX leg only — nuclear Natanz/Fordow news is a separate Bibi arm.
            Lagging market-panic arm: spike alone → YELLOW; +≥2 of 5 locks → RED
            (bibi_plus_locks).
          </p>
          <div className="theater-actions" style={{ marginTop: "0.4rem" }}>
            <button
              type="button"
              className="ghost"
              onClick={() =>
                openExternal("https://finance.yahoo.com/quote/ILS=X")
              }
            >
              Yahoo ILS=X
            </button>
          </div>
        </>
      )}
    </section>
  );
}
