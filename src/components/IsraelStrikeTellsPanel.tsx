import { useCallback, useEffect, useState } from "react";
import {
  fetchIsraelStrikeTells,
  setIsraelStrikeManual,
} from "../services/api";
import { copyText } from "../lib/clipboard";
import { staleServeText } from "../lib/format";
import { formatAerialAssetLine } from "../lib/aerialFormat";
import { useDashboardStore } from "../store/dashboard";
import type {
  IsraelStrikeScenario,
  IsraelStrikeTells,
  Nav01Posture,
} from "../types";
import { LevantAerialMap } from "./LevantAerialMap";
import { AerialActivityFeed } from "./AerialActivityFeed";

async function openExternal(href: string): Promise<void> {
  if (window.tradehole?.openExternal) {
    await window.tradehole.openExternal(href);
    return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
}

function scenarioClass(s: IsraelStrikeScenario): string {
  switch (s) {
    case "high_confidence_go":
      return "ist-band go";
    case "medium_confidence":
      return "ist-band medium";
    case "false_flag":
      return "ist-band feint";
    case "silence_only":
      return "ist-band silence";
    case "unknown":
      return "ist-band unknown";
    default:
      return "ist-band quiet";
  }
}

function statusClass(status: string): string {
  return `ist-status ${status}`;
}

function feedBannerClass(status: string): string {
  if (status === "ok") return "ist-feed ok";
  if (status === "dark") return "ist-feed dark";
  if (status === "degraded") return "ist-feed degraded";
  return "ist-feed failed";
}

function feedBannerLabel(status: string): string {
  if (status === "ok") return "FEED OK";
  if (status === "dark") return "DARK";
  if (status === "degraded") return "DEGRADED · LAST-GOOD";
  return "FEED FAILED";
}

function tellPill(t: { lit: boolean; status: string } | undefined): string {
  if (!t) return "ist-pill quiet";
  if (t.lit && t.status === "hot") return "ist-pill hot";
  if (t.lit) return "ist-pill warm";
  if (t.status === "unknown" || t.status === "manual") return "ist-pill unknown";
  return "ist-pill quiet";
}

const NAV01_OPTS: Array<[Nav01Posture, string]> = [
  ["not_set", "Not set"],
  ["loitering_cyprus", "Loitering Cyprus"],
  ["quiet", "Quiet"],
  ["ais_dark_suspected", "AIS dark?"],
];

const CYPRUS_CHECKLIST = `Cyprus watch checklist (NAV-01) — AISStream primary when keyed
1. Prefer AISStream auto navy-like when KEY set + LIVE (Tradehole Map / NAV-01 banner)
2. Backup only: open MT Cyprus zoom / Larnaca / Famagusta (or VesselFinder / CUT-AIS)
3. Filter or scan for navy / military / Sa'ar / corvette / tanker
4. Count navy-like hulls → enter "I count N" only when AISStream off/empty
5. Mark Loitering Cyprus if Sa'ar/corvette loitering; AIS dark if hulls vanish
Warships often AIS-dark — blank/empty AIS ≠ clear. No MarineTraffic premium unlock.
`;

function buildSnapshotMarkdown(data: IsraelStrikeTells): string {
  const aer = data.tells.find((t) => t.id === "AER-01");
  const nav = data.tells.find((t) => t.id === "NAV-01");
  const exec = data.tells.find((t) => t.id === "EXEC-01");
  const i = data.inputs;
  const ais = i.cyprusAis;
  const age =
    i.aerialSampleAgeSec != null && i.aerialSampleAgeSec > 0
      ? `${i.aerialSampleAgeSec}s`
      : i.aerialFromCache
        ? "cached"
        : "live";
  const aisLine = ais.enabled
    ? `AISStream ${ais.status} · box ${ais.totalInBox} · navy-like ${ais.navyLikeCount} · mil ${ais.militaryCount} · tanker ${ais.tankerCount}`
    : "AISStream off";
  const go = data.tells.find((t) => t.id === "GO-01");
  const goHits =
    go?.evidence?.length
      ? go.evidence.slice(0, 4).map((e) => `  - ${e}`)
      : [];

  const liveTracks = i.aerialTracks ?? [];
  const darkTracks = i.aerialLastGoodTracks ?? [];
  const assetLines: string[] = [];
  for (const t of liveTracks) {
    assetLines.push(`  - ${formatAerialAssetLine(t)}`);
  }
  for (const t of darkTracks) {
    assetLines.push(`  - ${formatAerialAssetLine({ ...t, stale: true })}`);
  }
  if (assetLines.length === 0 && i.aerialSamples.length > 0) {
    for (const s of i.aerialSamples.slice(0, 24)) {
      assetLines.push(`  - ${s}`);
    }
  }

  return [
    `**Israel Strike Tells** · ${data.statusLabel} · score ${data.score}/100 · ${data.asOf}`,
    `- **ACTION (froGuidance):** ${data.froGuidance}`,
    `- Title is a label only — do **not** treat scenario title alone as go / buy-ask.`,
    `- **AER-01** ${aer?.status.toUpperCase() ?? "?"} · ${feedBannerLabel(i.aerialFeedStatus)} · tankers ${i.aerialTankersLevant ?? "—"} · AWACS ${i.aerialAwacsLevant ?? "—"} · other mil ${i.aerialOtherMil ?? "—"} · age ${age}`,
    `- **Honesty:** \`class\` is Tradehole label; \`type\` is raw ICAO from ADS-B (e.g. E35L = Embraer Legacy 600 bizjet, **not** E-3 Sentry AWACS). Always paste type+hex.`,
    `- **Aerial assets (${liveTracks.length} live · ${darkTracks.length} dark):**`,
    ...(assetLines.length ? assetLines : ["  - (none plotted)"]),
    `- **NAV-01** ${nav?.status.toUpperCase() ?? "?"} · posture \`${i.nav01Posture}\`${i.nav01Note ? ` · ${i.nav01Note}` : ""} · manual navy ${i.nav01NavyCount ?? "—"}/${i.nav01NavyThreshold} · ${aisLine}`,
    `- **EXEC-01** ${exec?.status.toUpperCase() ?? "?"} · ILS ${i.shekelPrice?.toFixed(4) ?? "—"}${i.shekelChangePct != null ? ` (${i.shekelChangePct >= 0 ? "+" : ""}${i.shekelChangePct.toFixed(2)}%)` : ""} · lagging confirmation (not High-go gate)`,
    `- **GO-01** ${go?.status.toUpperCase() ?? "quiet"} · ${go?.read ?? "—"}`,
    ...goHits,
    `- Lead: AER-01 HOT (≥3 tankers) / NAV-01 / LLBG / Hebrew go language — Shekel often lags surprise kinetic`,
    `- ${data.oneLiner}`,
  ].join("\n");
}

export function IsraelStrikeTellsPanel({
  onOpenMap,
}: {
  onOpenMap?: () => void;
} = {}) {
  const data = useDashboardStore((s) => s.israelStrike);
  const setIsraelStrike = useDashboardStore((s) => s.setIsraelStrike);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyFlash, setCopyFlash] = useState<string | null>(null);
  const [navNote, setNavNote] = useState("");
  const [navyCountDraft, setNavyCountDraft] = useState("");
  const [showRules, setShowRules] = useState(false);
  const [showGaps, setShowGaps] = useState(false);
  const [showManual, setShowManual] = useState(false);

  // Sync draft fields when manual NAV state changes (not every aerial poll).
  useEffect(() => {
    if (!data) return;
    setNavNote(data.manual.nav01.note ?? "");
    setNavyCountDraft(
      data.manual.nav01.navyCount != null
        ? String(data.manual.nav01.navyCount)
        : "",
    );
  }, [
    data?.manual.nav01.note,
    data?.manual.nav01.navyCount,
    data?.manual.nav01.updatedAt,
    data?.manual.nav01.posture,
  ]);

  const refresh = useCallback(
    async (force = false) => {
      setBusy(true);
      try {
        const next = await fetchIsraelStrikeTells(force);
        setIsraelStrike(next);
        setError(null);
      } catch (err) {
        const have = useDashboardStore.getState().israelStrike;
        if (!have) setError(String(err));
      } finally {
        setBusy(false);
      }
    },
    [setIsraelStrike],
  );

  // App owns the steady poller; panel only loads last-good on first mount if empty.
  // refresh=1 (force aerial) is manual "Refresh aerial" only.
  useEffect(() => {
    if (data) return;
    void refresh(false);
  }, [data, refresh]);

  const markNav = useCallback(
    async (posture: Nav01Posture) => {
      try {
        const navyParsed =
          navyCountDraft.trim() === ""
            ? null
            : Math.max(0, Math.floor(Number(navyCountDraft)));
        await setIsraelStrikeManual({
          nav01: {
            posture,
            note: navNote,
            navyCount: Number.isFinite(navyParsed as number)
              ? navyParsed
              : null,
          },
        });
        await refresh(false);
      } catch (err) {
        setError(String(err));
      }
    },
    [navNote, navyCountDraft, refresh],
  );

  const saveNavNote = useCallback(async () => {
    if (!data) return;
    try {
      await setIsraelStrikeManual({
        nav01: { posture: data.manual.nav01.posture, note: navNote },
      });
      await refresh(false);
    } catch (err) {
      setError(String(err));
    }
  }, [data, navNote, refresh]);

  const saveNavyCount = useCallback(async () => {
    if (!data) return;
    try {
      const navyParsed =
        navyCountDraft.trim() === ""
          ? null
          : Math.max(0, Math.floor(Number(navyCountDraft)));
      await setIsraelStrikeManual({
        nav01: {
          posture: data.manual.nav01.posture,
          navyCount: Number.isFinite(navyParsed as number) ? navyParsed : null,
        },
      });
      await refresh(false);
    } catch (err) {
      setError(String(err));
    }
  }, [data, navyCountDraft, refresh]);

  const copySnapshot = useCallback(async () => {
    if (!data) return;
    try {
      await copyText(buildSnapshotMarkdown(data));
      setCopyFlash("Copied");
      window.setTimeout(() => setCopyFlash(null), 1600);
    } catch (err) {
      setError(String(err));
    }
  }, [data]);

  const copyChecklist = useCallback(async () => {
    try {
      await copyText(CYPRUS_CHECKLIST);
      setCopyFlash("Checklist copied");
      window.setTimeout(() => setCopyFlash(null), 1600);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const aer = data?.tells.find((t) => t.id === "AER-01");
  const nav = data?.tells.find((t) => t.id === "NAV-01");
  const exec = data?.tells.find((t) => t.id === "EXEC-01");
  const lit = data?.tells.filter((t) => t.lit) ?? [];
  const autoTells = data?.tells.filter((t) => t.layer === "auto") ?? [];
  const manualTells = data?.tells.filter((t) => t.layer === "manual") ?? [];
  const feedStatus = data?.inputs.aerialFeedStatus ?? "failed";
  const ais = data?.inputs.cyprusAis;
  const ageLabel =
    data?.inputs.aerialSampleAgeSec != null &&
    data.inputs.aerialSampleAgeSec > 0
      ? `${data.inputs.aerialSampleAgeSec}s ago`
      : data?.inputs.aerialFromCache
        ? "cached"
        : "live";

  const navyMetric =
    ais?.enabled && ais.navyLikeCount > 0
      ? `${ais.navyLikeCount} navy-like`
      : data?.inputs.nav01NavyCount != null
        ? `count ${data.inputs.nav01NavyCount}`
        : nav?.status === "unknown" || nav?.status === "quiet"
          ? "—"
          : data?.inputs.nav01Posture.replace(/_/g, " ") ?? "—";

  return (
    <section className="panel israel-strike-tells-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Pre-launch · Israel strike</p>
          <h2>Israel Strike Tells</h2>
          <p className="muted tiny">
            AER/NAV/ELEC/DIP/POL + Shekel (lags) · free OSINT · no auto-trade.
            Auto-polls every ~30s (shared desk poller) — soft alert at 2
            tankers, wake-up at AER HOT ≥3 / High-go / NAV HOT. App must stay
            open for siren.
          </p>
        </div>
        <div className="theater-actions">
          {staleServeText(data) && (
            <span className="pill warn" title={data?.degradedReason ?? undefined}>
              {staleServeText(data)}
            </span>
          )}
          <button
            type="button"
            className="ghost"
            onClick={() => setShowRules((v) => !v)}
          >
            {showRules ? "Hide rules" : "Rules"}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => setShowGaps((v) => !v)}
          >
            {showGaps ? "Hide gaps" : "Gaps"}
          </button>
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => void refresh(true)}
            title="Force fresh adsb.lol sample (auto-poll already runs every ~30s)"
          >
            {busy ? "Refreshing…" : "Refresh aerial"}
          </button>
          <button type="button" className="ghost" onClick={() => void copySnapshot()}>
            {copyFlash ?? "Copy tells snapshot"}
          </button>
        </div>
      </div>

      {error && <p className="banner error">{error}</p>}
      {!data && !error && <p className="muted">Scoring Israel strike tells…</p>}

      {data && (
        <>
          <div className="ist-shot-strip">
            <div className={`ist-shot-cell ${tellPill(aer)}`}>
              <p className="ist-shot-id">AER-01</p>
              <p className="ist-shot-status">
                {(aer?.status ?? "unknown").toUpperCase()}
              </p>
              <p className="ist-shot-metric">
                {data.inputs.aerialTankersLevant ?? "—"}
                <span className="muted tiny"> tankers</span>
              </p>
              <p className="ist-shot-sub">
                AWACS {data.inputs.aerialAwacsLevant ?? "—"} · {ageLabel}
              </p>
              {data.inputs.aer01Churn?.summary ? (
                <p
                  className="ist-shot-churn muted tiny"
                  title="Levant in-box tanker lifecycle — not the HOT gate count alone"
                >
                  {data.inputs.aer01Churn.summary}
                </p>
              ) : null}
              {data.inputs.aerialSessionPeak ? (
                <p className="ist-shot-peak muted tiny" title="Session max since process start — awareness only, not a go gate">
                  Peak today: {data.inputs.aerialSessionPeak.tankers}t /{" "}
                  {data.inputs.aerialSessionPeak.awacs} AWACS @{" "}
                  {new Date(data.inputs.aerialSessionPeak.at).toLocaleTimeString(
                    undefined,
                    { hour: "2-digit", minute: "2-digit" },
                  )}
                </p>
              ) : null}
            </div>
            <div className={`ist-shot-cell ${tellPill(nav)}`}>
              <p className="ist-shot-id">NAV-01</p>
              <p className="ist-shot-status">
                {(nav?.status ?? "manual").toUpperCase()}
              </p>
              <p className="ist-shot-metric ist-shot-metric-sm">{navyMetric}</p>
              <p className="ist-shot-sub">Cyprus Sa&apos;ar / corvette</p>
            </div>
            <div className={`ist-shot-cell ${tellPill(exec)}`}>
              <p className="ist-shot-id">EXEC-01</p>
              <p className="ist-shot-status">
                {(exec?.status ?? "quiet").toUpperCase()}
              </p>
              <p className="ist-shot-metric">
                {data.inputs.shekelPrice != null
                  ? data.inputs.shekelPrice.toFixed(4)
                  : "—"}
              </p>
              <p className="ist-shot-sub">Shekel lags (confirm)</p>
            </div>
            <div className="ist-shot-cell ist-shot-scenario">
              <p className="ist-shot-id">SCENARIO</p>
              <span className={scenarioClass(data.scenario)}>
                {data.statusLabel}
              </span>
              <p className="ist-shot-metric">
                {data.score}
                <span className="muted tiny">/100</span>
              </p>
              <p className="ist-shot-sub">no auto-trade</p>
            </div>
          </div>

          <div className={feedBannerClass(feedStatus)}>
            <strong>{feedBannerLabel(feedStatus)}</strong>
            <span>
              · tankers {data.inputs.aerialTankersLevant ?? "—"} · AWACS{" "}
              {data.inputs.aerialAwacsLevant ?? "—"} · other mil{" "}
              {data.inputs.aerialOtherMil ?? "—"} · {ageLabel}
              {data.inputs.aerialBoxesOk.length > 0
                ? ` · boxes ${data.inputs.aerialBoxesOk.join("+")}`
                : ""}
              {data.inputs.aerialError
                ? ` · ${data.inputs.aerialError.slice(0, 120)}`
                : ""}
              {data.inputs.aerialSessionPeak
                ? ` · peak ${data.inputs.aerialSessionPeak.tankers}t/${data.inputs.aerialSessionPeak.awacs}a (session)`
                : ""}
              {(data.inputs.aerialTracks ?? []).filter((t) => t.followed).length
                ? ` · ${(data.inputs.aerialTracks ?? []).filter((t) => t.followed).length} FOLLOWED outbound`
                : ""}
              {data.inputs.aer01Churn?.summary
                ? ` · churn: ${data.inputs.aer01Churn.summary}`
                : ""}
            </span>
          </div>

          <AerialActivityFeed
            events={data.inputs.aerialEvents ?? []}
            churnSummary={data.inputs.aer01Churn?.summary}
          />

          {(data.inputs.mapOverlays ||
            (data.inputs.aerialTracks && data.inputs.aerialTracks.length > 0) ||
            (data.inputs.aerialLastGoodTracks &&
              data.inputs.aerialLastGoodTracks.length > 0)) ? (
            <LevantAerialMap
              tracks={data.inputs.aerialTracks ?? []}
              lastGoodTracks={data.inputs.aerialLastGoodTracks ?? []}
              overlays={data.inputs.mapOverlays}
              ageLabel={ageLabel}
              feedOk={data.inputs.aerialFeedOk}
              onOpenFullMap={onOpenMap}
            />
          ) : null}

          {(data.inputs.aerialTracks?.length ||
            data.inputs.aerialLastGoodTracks?.length ||
            data.inputs.aerialSamples.length > 0) && (
            <div className="ist-asset-board">
              <p className="eyebrow">Aerial assets · full type / hex</p>
              <p className="muted tiny">
                <code>class</code> = our label · <code>type</code> = raw ICAO
                (E35L ≠ E-3 AWACS). Paste uses this board.
              </p>
              <ul className="theater-samples ist-callsigns">
                {(data.inputs.aerialTracks ?? []).map((t) => (
                  <li key={`live-${t.hex}`}>{formatAerialAssetLine(t)}</li>
                ))}
                {(data.inputs.aerialLastGoodTracks ?? []).map((t) => (
                  <li key={`dark-${t.hex}`}>
                    {formatAerialAssetLine({ ...t, stale: true })}
                  </li>
                ))}
                {!data.inputs.aerialTracks?.length &&
                  !data.inputs.aerialLastGoodTracks?.length &&
                  data.inputs.aerialSamples.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
              </ul>
            </div>
          )}

          <p className="theater-read">{data.oneLiner}</p>
          <p className="muted tiny">{data.froGuidance}</p>

          <div className="ist-nav01-block">
            <div className="ist-nav01-head">
              <span className={statusClass(nav?.status ?? "manual")}>
                {(nav?.status ?? "MANUAL").toUpperCase()}
              </span>{" "}
              <strong>NAV-01</strong> · Cyprus Sa&apos;ar / corvette loiter
              {nav?.lit ? (
                <span className="pill" style={{ marginLeft: "0.35rem" }}>
                  LIT
                </span>
              ) : null}
            </div>
            <p className="muted tiny">{nav?.read}</p>

            {ais && (
              <div
                className={
                  ais.enabled
                    ? ais.status === "live"
                      ? "ist-ais-banner live"
                      : ais.status === "error"
                        ? "ist-ais-banner err"
                        : ais.status === "empty" || ais.status === "stale"
                          ? "ist-ais-banner empty"
                          : ais.status === "connecting"
                            ? "ist-ais-banner empty"
                            : "ist-ais-banner"
                    : "ist-ais-banner off"
                }
              >
                <strong>
                  {!ais.enabled
                    ? "AISStream · KEY UNSET"
                    : ais.status === "empty"
                      ? "AISStream · EMPTY (auto)"
                      : ais.status === "stale"
                        ? "AISStream · STALE (auto)"
                        : ais.status === "error"
                          ? "AISStream · ERROR"
                          : ais.status === "connecting"
                            ? `AISStream · CONNECTING${
                                ais.statusAgeSec != null && ais.statusAgeSec > 0
                                  ? ` · ${ais.statusAgeSec}s`
                                  : ""
                              }`
                            : `AISStream · ${ais.status.toUpperCase()} (auto)`}
                </strong>
                <span>
                  {!ais.enabled
                    ? " · set AISSTREAM_API_KEY (aisstream.io free) — deep links are backup only"
                    : ais.status === "empty" || ais.status === "stale"
                      ? ` · not quiet confirmation · box ${ais.totalInBox}${ais.error ? ` · ${ais.error.slice(0, 100)}` : ""}${
                          ais.statusAgeSec != null && ais.statusAgeSec > 0
                            ? ` · ${ais.statusAgeSec}s`
                            : ""
                        }`
                      : ais.status === "error"
                        ? ` · ${ais.error?.slice(0, 120) ?? "reconnect armed"}${
                            ais.statusAgeSec != null && ais.statusAgeSec > 0
                              ? ` · ${ais.statusAgeSec}s`
                              : ""
                          } · deep links backup`
                      : ais.status === "connecting"
                        ? ` · waiting for first ping${
                            ais.statusAgeSec != null && ais.statusAgeSec > 0
                              ? ` · ${ais.statusAgeSec}s`
                              : ""
                          } — will ERROR after ~60s if hung`
                        : ` · box ${ais.totalInBox} · navy-like ${ais.navyLikeCount} · mil ${ais.militaryCount} · tanker ${ais.tankerCount}${ais.error ? ` · ${ais.error.slice(0, 100)}` : ""}`}
                </span>
              </div>
            )}

            {ais?.vessels && ais.vessels.length > 0 && (
              <ul className="ist-ais-list">
                {ais.vessels.slice(0, 12).map((v) => (
                  <li key={v.mmsi}>
                    <span className={`ist-ais-cat ${v.category}`}>
                      {v.category}
                    </span>{" "}
                    {v.name}{" "}
                    <span className="muted tiny">
                      {v.shipTypeLabel}
                      {v.sog != null ? ` · ${v.sog.toFixed(1)} kn` : ""} ·{" "}
                      {v.lat.toFixed(2)},{v.lon.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="theater-actions">
              {(nav?.links ?? []).map((l) => (
                <button
                  key={l.href}
                  type="button"
                  className="ghost"
                  onClick={() => void openExternal(l.href)}
                >
                  {l.label}
                  {ais?.enabled && ais.status === "live" ? " (backup)" : ""}
                </button>
              ))}
              <button
                type="button"
                className="ghost"
                onClick={() => void copyChecklist()}
              >
                Copy Cyprus checklist
              </button>
            </div>

            <div className="ist-nav01-count-row">
              <label className="muted tiny" htmlFor="nav01-navy-count">
                {ais?.enabled && ais.status === "live"
                  ? "Optional override — I count N navy-like (AISStream is primary)"
                  : "I count N navy-like in Cyprus box (when AISStream off/empty)"}
              </label>
              <input
                id="nav01-navy-count"
                className="theater-input ist-nav01-count-input"
                inputMode="numeric"
                value={navyCountDraft}
                onChange={(e) => setNavyCountDraft(e.target.value)}
                onBlur={() => void saveNavyCount()}
                placeholder={`≥${data.inputs.nav01NavyThreshold} lights NAV-01`}
              />
              <button
                type="button"
                className="ghost"
                onClick={() => void saveNavyCount()}
              >
                Save count
              </button>
            </div>

            <div className="theater-actions">
              {NAV01_OPTS.map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  className={
                    data.manual.nav01.posture === val
                      ? "ghost active"
                      : "ghost"
                  }
                  onClick={() => void markNav(val)}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              className="theater-input"
              value={navNote}
              onChange={(e) => setNavNote(e.target.value)}
              onBlur={() => void saveNavNote()}
              placeholder='Screenshot note e.g. "Saar 6 ~15nm S Larnaca · MT 10:12Z"'
            />
            <p className="muted tiny">
              Deep links open public maps for eyeballing — Tradehole does not
              unlock MarineTraffic premium or bypass Cloudflare.
            </p>
          </div>

          <p className="eyebrow">Lit tells</p>
          <ul className="theater-list df-signals">
            {lit.length === 0 && (
              <li className="muted tiny">
                No tells lit — quiet or dark. Mark NAV-01 or wait for AER-01 / LLBG (Shekel lags).
              </li>
            )}
            {lit.map((t) => (
              <li key={t.id}>
                <span className={statusClass(t.status)}>
                  {t.status.toUpperCase()}
                </span>{" "}
                <strong>{t.id}</strong> · {t.label}{" "}
                <span className="muted tiny">
                  {t.points >= 0 ? `+${t.points}` : t.points}
                </span>
                <br />
                <span className="muted tiny">{t.read}</span>
                {t.evidence.length > 0 && (
                  <ul className="theater-samples ist-tell-evidence">
                    {t.evidence.slice(0, 4).map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                )}
                <div className="theater-actions">
                  {t.links.slice(0, 6).map((l) => (
                    <button
                      key={l.href}
                      type="button"
                      className="ghost"
                      onClick={() => void openExternal(l.href)}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>

          <p className="eyebrow">All auto tells</p>
          <ul className="theater-list ist-all-tells">
            {autoTells.map((t) => (
              <li key={t.id} className={t.lit ? "ist-lit" : "ist-unlit"}>
                <span className={statusClass(t.status)}>
                  {t.status.toUpperCase()}
                </span>{" "}
                <strong>{t.id}</strong> · {t.label}
                <br />
                <span className="muted tiny">{t.read}</span>
                {t.lit && t.evidence.length > 0 && (
                  <ul className="theater-samples ist-tell-evidence">
                    {t.evidence.slice(0, 3).map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>

          <div className="theater-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => setShowManual((v) => !v)}
            >
              {showManual ? "Hide other manual gaps" : "Show other manual / Layer-3"}
            </button>
          </div>
          {showManual && (
            <ul className="theater-list">
              {manualTells
                .filter((t) => t.id !== "NAV-01")
                .map((t) => (
                  <li key={t.id}>
                    <span className={statusClass("manual")}>MANUAL</span>{" "}
                    <strong>{t.id}</strong> · {t.label}
                    <br />
                    <span className="muted tiny">{t.read}</span>
                    <div className="theater-actions">
                      {t.links.map((l) => (
                        <button
                          key={l.href}
                          type="button"
                          className="ghost"
                          onClick={() => void openExternal(l.href)}
                        >
                          {l.label}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
            </ul>
          )}

          <p className="eyebrow">Next triggers</p>
          <ul className="theater-samples">
            {data.nextTriggers.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>

          {showGaps && (
            <>
              <p className="eyebrow">Honesty gaps</p>
              <ul className="theater-samples">
                {data.gaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </>
          )}

          {showRules && (
            <>
              <p className="eyebrow">Composite rules</p>
              <ul className="theater-samples">
                {data.rulesSummary.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <p className="muted tiny">{data.thesis}</p>
            </>
          )}

          <div className="theater-actions">
            <button
              type="button"
              className="ghost"
              onClick={() =>
                void openExternal("https://www.flightradar24.com/32.01,34.89/8")
              }
            >
              FR24 LLBG
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() =>
                void openExternal(
                  "https://www.marinetraffic.com/en/ais/home/centerx:33.7/centery:34.95/zoom:9",
                )
              }
            >
              MT Cyprus zoom
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() =>
                void openExternal(
                  "https://www.marinetraffic.com/en/ais/home/centerx:35.0/centery:32.82/zoom:11",
                )
              }
            >
              MT Haifa
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() =>
                void openExternal("https://api.adsb.lol/v2/mil")
              }
            >
              adsb.lol
            </button>
          </div>
        </>
      )}
    </section>
  );
}
