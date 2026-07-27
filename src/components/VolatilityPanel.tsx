import type { VolatilityReport } from "../types";
import { fmtMoney, signedClass } from "../lib/format";

type Props = {
  report: VolatilityReport | null;
  loading?: boolean;
};

function pctIv(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function SparkBars({
  points,
}: {
  points: { label: string; value: number | null }[];
}) {
  const vals = points.map((p) => p.value).filter((v): v is number => v != null && v > 0);
  const max = vals.length ? Math.max(...vals) : 1;
  const min = vals.length ? Math.min(...vals) : 0;
  const span = Math.max(0.01, max - min);

  return (
    <div className="spark-bars">
      {points.map((p) => {
        const h =
          p.value == null ? 8 : 18 + ((p.value - min) / span) * 52;
        return (
          <div key={p.label} className="spark-col" title={`${p.label}: ${pctIv(p.value)}`}>
            <div className="spark-bar" style={{ height: `${h}px` }} />
            <span>{p.label.slice(5)}</span>
            <em>{pctIv(p.value)}</em>
          </div>
        );
      })}
    </div>
  );
}

function SmileChart({
  smile,
}: {
  smile: VolatilityReport["smile"];
}) {
  const points = smile.filter((s) => s.callIv != null || s.putIv != null);
  if (!points.length) return <p className="muted">No smile points</p>;

  const ivs = points
    .flatMap((p) => [p.callIv, p.putIv])
    .filter((v): v is number => v != null);
  const max = Math.max(...ivs, 0.01);
  const min = Math.min(...ivs, 0);
  const span = Math.max(0.01, max - min);
  const w = 320;
  const h = 90;
  const pad = 8;

  const toX = (i: number) => pad + (i / Math.max(1, points.length - 1)) * (w - pad * 2);
  const toY = (iv: number) => h - pad - ((iv - min) / span) * (h - pad * 2);

  const callPath = points
    .map((p, i) =>
      p.callIv == null ? null : `${i === 0 || points[i - 1]?.callIv == null ? "M" : "L"}${toX(i)},${toY(p.callIv)}`,
    )
    .filter(Boolean)
    .join(" ");

  const putPath = points
    .map((p, i) =>
      p.putIv == null ? null : `${i === 0 || points[i - 1]?.putIv == null ? "M" : "L"}${toX(i)},${toY(p.putIv)}`,
    )
    .filter(Boolean)
    .join(" ");

  return (
    <svg className="smile-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="IV smile">
      <path d={callPath} fill="none" stroke="var(--accent)" strokeWidth="1.75" />
      <path d={putPath} fill="none" stroke="var(--up)" strokeWidth="1.75" opacity="0.85" />
    </svg>
  );
}

export function VolatilityPanel({ report, loading }: Props) {
  if (!report && loading) {
    return (
      <section className="panel vol-panel">
        <h2>Volatility</h2>
        <p className="muted">Computing IV / HV…</p>
      </section>
    );
  }

  if (!report) {
    return (
      <section className="panel vol-panel">
        <h2>Volatility</h2>
        <p className="muted">No volatility data</p>
      </section>
    );
  }

  const rich = (report.ivMinusHv20 ?? 0) > 0;
  const rankReady = report.snapshotCount >= 5;

  return (
    <section className="panel vol-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">{report.symbol} volatility</p>
          <h2>Implied vol</h2>
          <p className="muted">
            ATM ≈ ${fmtMoney(report.atmStrike, 1)} · expiry{" "}
            {report.selectedExpiry ?? "—"}
            {report.dte != null ? ` · ${report.dte}d` : ""}
          </p>
        </div>
        <span className={`pill ${rankReady ? "live" : ""}`}>
          {rankReady ? `${report.snapshotDays}d history` : "building history"}
        </span>
      </div>

      <div className="vol-hero">
        <div>
          <dt>ATM IV</dt>
          <dd>{pctIv(report.atmIv)}</dd>
        </div>
        <div>
          <dt>HV 20</dt>
          <dd>{pctIv(report.hv20)}</dd>
        </div>
        <div>
          <dt>IV − HV</dt>
          <dd className={signedClass(report.ivMinusHv20)}>
            {report.ivMinusHv20 == null
              ? "—"
              : `${report.ivMinusHv20 > 0 ? "+" : ""}${(report.ivMinusHv20 * 100).toFixed(1)} pts`}
          </dd>
          <p className="muted tiny">{rich ? "IV rich vs realized" : "IV cheap vs realized"}</p>
        </div>
        <div>
          <dt>Skew</dt>
          <dd className={signedClass(report.skew)}>
            {report.skew == null
              ? "—"
              : `${report.skew > 0 ? "+" : ""}${(report.skew * 100).toFixed(1)} pts`}
          </dd>
          <p className="muted tiny">{report.skewNote}</p>
        </div>
      </div>

      <div className="vol-rank-row">
        <div>
          <dt>IV Rank</dt>
          <dd>{rankReady && report.ivRank != null ? `${report.ivRank.toFixed(0)}` : "—"}</dd>
        </div>
        <div>
          <dt>IV %ile</dt>
          <dd>
            {rankReady && report.ivPercentile != null
              ? `${report.ivPercentile.toFixed(0)}`
              : "—"}
          </dd>
        </div>
        <div className="vol-rank-note">
          <p className="muted tiny">
            {rankReady
              ? `From ${report.snapshotCount} daily ATM snapshots on this machine.`
              : `Need ~5 daily snapshots (have ${report.snapshotCount}). Opens of the app write today\'s ATM IV.`}
          </p>
        </div>
      </div>

      {report.positionFocus && (
        <div className="vol-position">
          <p className="eyebrow">Your focus · ${report.positionFocus.strike} {report.positionFocus.type}</p>
          <div className="vol-position-grid">
            <div>
              <dt>Contract IV</dt>
              <dd>{pctIv(report.positionFocus.iv)}</dd>
            </div>
            <div>
              <dt>Expiry</dt>
              <dd className="plain">{report.positionFocus.expiry ?? "—"}</dd>
            </div>
            <div>
              <dt>Moneyness</dt>
              <dd className="plain">
                {report.positionFocus.moneyness != null
                  ? `${(report.positionFocus.moneyness * 100).toFixed(1)}% of spot`
                  : "—"}
              </dd>
            </div>
          </div>
        </div>
      )}

      <div className="vol-charts">
        <div>
          <h3>Term structure (ATM)</h3>
          <SparkBars
            points={report.termStructure.map((t) => ({
              label: t.expiry,
              value: t.atmIv,
            }))}
          />
        </div>
        <div>
          <h3>
            Smile <span className="legend"><i className="call" /> call <i className="put" /> put</span>
          </h3>
          <SmileChart smile={report.smile} />
        </div>
      </div>
    </section>
  );
}
