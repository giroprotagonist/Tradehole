type Props = {
  marketFetchedAt: string | null;
  marketLoading: boolean;
  etradeAuthorized: boolean | null;
  ironsightUp: boolean | null;
  ironsightFeedsFresh?: boolean | null;
  marketSource?: string | null;
  marketPollMs?: number | null;
  osintPollMs?: number | null;
  nowMs?: number;
  intelLevel?: "green" | "yellow" | "red" | null;
  intelLockCount?: number | null;
  intelRedReason?:
    | "five_lock"
    | "three_lock_stack"
    | "bibi_plus_locks"
    | null;
  intelBibiTrigger?: boolean | null;
  shekelPrice?: number | null;
  shekelSpiked?: boolean | null;
  shekelRegime?: "quiet" | "firm" | "spiked" | "unknown" | null;
  shekelThreshold?: number | null;
  /** Desk posture — prefer over large scenario titles. */
  froGuidance?: string | null;
  ghostLit?: number | null;
  ghostMax?: number | null;
  /** AER-01 live ladder (Israel strike aerial). */
  aerialTankers?: number | null;
  aerialAwacs?: number | null;
  aerStatus?: string | null;
  goLanguageStatus?: "quiet" | "warm" | "hot" | null;
  goLanguageHits?: string[];
  politicsHeadline?: string | null;
  runtimeMode?: "dev" | "packaged" | null;
  runtimeBuildTime?: string | null;
};

function formatPoll(ms: number): string {
  const s = ms / 1000;
  return Number.isInteger(s) ? `${s}s` : `${s.toFixed(1)}s`;
}

function ageLabel(fetchedAt: string | null, nowMs: number): string {
  if (!fetchedAt) return "idle";
  const age = Math.max(0, Math.round((nowMs - new Date(fetchedAt).getTime()) / 1000));
  if (age < 2) return "just now";
  if (age < 60) return `${age}s ago`;
  return `${Math.floor(age / 60)}m ago`;
}

function shortBuild(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

export function StatusBar({
  marketFetchedAt,
  marketLoading,
  etradeAuthorized,
  ironsightUp,
  ironsightFeedsFresh,
  marketSource,
  marketPollMs,
  osintPollMs,
  nowMs,
  intelLevel,
  intelLockCount,
  intelRedReason,
  intelBibiTrigger,
  shekelPrice,
  shekelSpiked,
  shekelRegime,
  shekelThreshold,
  froGuidance,
  ghostLit,
  ghostMax,
  aerialTankers,
  aerialAwacs,
  aerStatus,
  goLanguageStatus,
  goLanguageHits,
  politicsHeadline,
  runtimeMode,
  runtimeBuildTime,
}: Props) {
  const src = (marketSource ?? "").toLowerCase();
  const feedLabel = (() => {
    if (src.startsWith("etrade:realtime")) {
      return "E*TRADE realtime FRO/options";
    }
    if (
      src.includes("closing") ||
      src.includes("eh_") ||
      src.includes("extended") ||
      src.endsWith(":ah")
    ) {
      return "E*TRADE closing/AH marks · Yahoo may fill pre/post prints";
    }
    if (src.startsWith("etrade")) {
      return "E*TRADE delayed FRO/options · check market-data entitlement";
    }
    if (etradeAuthorized) {
      return "Yahoo-delayed fallback · E*TRADE auth OK but broker quote unavailable";
    }
    return "Yahoo-delayed quotes · connect E*TRADE for broker quotes";
  })();

  const age = ageLabel(marketFetchedAt, nowMs ?? Date.now());

  const redReasonLabel =
    intelRedReason === "five_lock"
      ? "full 5-lock"
      : intelRedReason === "three_lock_stack"
        ? "3-lock stack"
        : intelRedReason === "bibi_plus_locks"
          ? "Bibi+locks"
          : null;

  const shekelClass =
    shekelSpiked || shekelRegime === "spiked"
      ? "shekel-status spiked"
      : shekelRegime === "firm"
        ? "shekel-status firm"
        : "shekel-status";

  const ironsightLabel = (() => {
    if (ironsightUp == null) return "—";
    if (!ironsightUp) return "down";
    if (ironsightFeedsFresh === false) {
      return `degraded${osintPollMs != null ? ` · every ${formatPoll(osintPollMs)}` : ""}`;
    }
    return `up${osintPollMs != null ? ` · every ${formatPoll(osintPollMs)}` : ""}`;
  })();

  const guidanceShort = froGuidance
    ? froGuidance.replace(/^FRO:\s*/i, "").slice(0, 72)
    : null;

  const aerClass =
    aerStatus === "hot"
      ? "aer-status hot"
      : aerialTankers != null && aerialTankers >= 2
        ? "aer-status elevated"
        : "aer-status";

  const showPosture =
    guidanceShort ||
    intelLevel != null ||
    ghostLit != null ||
    aerialTankers != null;

  return (
    <footer className="status-bar">
      {showPosture && (
        <span className="posture-chrome" title={froGuidance ?? undefined}>
          {guidanceShort ? <strong>{guidanceShort}</strong> : null}
          {intelLevel != null && (
            <span className={`intel-status ${intelLevel}`}>
              {" "}
              · 5-Lock {intelLevel.toUpperCase()}
              {intelLockCount != null ? ` ${intelLockCount}/5` : ""}
              {redReasonLabel ? ` ${redReasonLabel}` : ""}
              {intelBibiTrigger ? " Bibi" : ""}
            </span>
          )}
          {ghostLit != null && (
            <span className="muted">
              {" "}
              · ghost {ghostLit}
              {ghostMax != null ? `/${ghostMax}` : "/7"}
            </span>
          )}
          {aerialTankers != null && (
            <span
              className={aerClass}
              title="AER-01 Levant tankers · ≥3 = HOT · auto-polled every 30s"
            >
              {" "}
              · AER tankers {aerialTankers}/3
              {aerialAwacs != null && aerialAwacs > 0
                ? ` · AWACS ${aerialAwacs}`
                : ""}
              {aerStatus === "hot"
                ? " HOT"
                : aerialTankers >= 2
                  ? " elevated"
                  : ""}
            </span>
          )}
          {goLanguageStatus && goLanguageStatus !== "quiet" && (
            <span
              className={`go-lang-status ${goLanguageStatus}`}
              title={
                goLanguageHits?.length
                  ? `GO-01 ${goLanguageStatus} — ${goLanguageHits[0]}`
                  : "GO-01 Hebrew/Home Front go-language — soft wake, not High-go alone"
              }
            >
              {" "}
              · GO-01 {goLanguageStatus}
            </span>
          )}
          {politicsHeadline && (
            <span
              className="politics-status"
              title="Domestic politics calendar — judgment overlay, not a fire rule"
            >
              {" "}
              · {politicsHeadline.slice(0, 48)}
            </span>
          )}
        </span>
      )}
      <span>
        Market{" "}
        {marketLoading
          ? "refreshing…"
          : marketFetchedAt
            ? `${age}${marketPollMs != null ? ` · every ${formatPoll(marketPollMs)}` : ""}`
            : "idle"}
      </span>
      <span>
        E*TRADE{" "}
        {etradeAuthorized == null ? "—" : etradeAuthorized ? "auth OK" : "logged out"}
      </span>
      <span
        className={
          ironsightUp && ironsightFeedsFresh === false
            ? "ironsight-status degraded"
            : undefined
        }
      >
        IRONSIGHT {ironsightLabel}
      </span>
      {shekelPrice != null && (
        <span className={shekelClass} title="USD/ILS Shekel spike alarm">
          ILS=X {shekelPrice.toFixed(3)}
          {shekelSpiked
            ? " · SPIKED"
            : shekelThreshold != null
              ? ` · vs ~${shekelThreshold.toFixed(2)}`
              : ""}
          {shekelRegime && !shekelSpiked ? ` · ${shekelRegime}` : ""}
        </span>
      )}
      {runtimeMode && (
        <span
          className={`runtime-banner ${runtimeMode}`}
          title="Dev uses Vite hot reload; packaged /Applications needs npm run install:mac after OSINT/UI changes"
        >
          {runtimeMode}
          {runtimeBuildTime ? ` · ${shortBuild(runtimeBuildTime)}` : ""}
        </span>
      )}
      <span className="muted">{feedLabel}</span>
    </footer>
  );
}
