import { useCallback, useEffect, useRef, useState } from "react";
import { fmtMoney, staleServeText } from "../lib/format";
import { fetchTheaterWatch } from "../services/api";
import type { TheaterWatch } from "../types";

const AIS_STATUS_KEY = "tradehole.ais.hormuzStatus";
const AIS_NOTE_KEY = "tradehole.ais.hormuzNote";

type AisStatus = "unknown" | "anchored" | "cape" | "normal";
type HullStatus = "unknown" | "sprinting" | "loitering" | "anchored";
type IrgcStatus =
  | "unknown"
  | "dispersing"
  | "massing"
  | "reinforcing"
  | "quiet";
type CapeStatus = "unknown" | "diverting" | "normal";
type RomeStatus =
  | "unknown"
  | "sept_next"
  | "ongoing"
  | "disarmament_demand"
  | "concluded";

const HULL_KEYS = ["bataan", "boxer", "newYork"] as const;
type HullKey = (typeof HULL_KEYS)[number];

const HULL_STATUS_OPTS: Array<[HullStatus, string]> = [
  ["unknown", "Not set"],
  ["sprinting", "Sprinting ≥15kt"],
  ["loitering", "Loitering"],
  ["anchored", "Anchored"],
];

function loadLocal(key: string, fallback = ""): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function loadAisStatus(): AisStatus {
  const v = loadLocal(AIS_STATUS_KEY, "unknown");
  if (v === "anchored" || v === "cape" || v === "unknown" || v === "normal")
    return v;
  return "unknown";
}

function loadHullStatus(key: HullKey): HullStatus {
  const v = loadLocal(`tradehole.kharg.${key}Status`, "unknown");
  if (
    v === "unknown" ||
    v === "sprinting" ||
    v === "loitering" ||
    v === "anchored"
  )
    return v;
  return "unknown";
}

function loadIrgcStatus(): IrgcStatus {
  const v = loadLocal("tradehole.kharg.irgcStatus", "unknown");
  if (
    v === "unknown" ||
    v === "dispersing" ||
    v === "massing" ||
    v === "reinforcing" ||
    v === "quiet"
  )
    return v;
  return "unknown";
}

function loadCapeStatus(): CapeStatus {
  const v = loadLocal("tradehole.kharg.capeStatus", "unknown");
  if (v === "unknown" || v === "diverting" || v === "normal") return v;
  return "unknown";
}

function loadRomeStatus(): RomeStatus {
  const v = loadLocal("tradehole.bibi.romeStatus", "sept_next");
  // Migrate retired "walkout" localStorage → September calendar gap
  if (v === "walkout") return "sept_next";
  if (
    v === "unknown" ||
    v === "sept_next" ||
    v === "ongoing" ||
    v === "disarmament_demand" ||
    v === "concluded"
  )
    return v;
  return "sept_next";
}

async function openExternal(href: string): Promise<void> {
  if (window.tradehole?.openExternal) {
    await window.tradehole.openExternal(href);
    return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
}

function pct(n: number | null | undefined, d = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(d)}%`;
}

function humanizeTheaterError(err: unknown): string {
  if (err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return "Theater refresh timed out — server still building signals; try again.";
  }
  const raw = err instanceof Error ? err.message : String(err);
  if (/fetch failed|Failed to fetch|NetworkError|ECONNREFUSED|ETIMEDOUT/i.test(raw)) {
    return "Theater API unreachable — check that Tradehole server is running.";
  }
  if (/^TypeError:/i.test(raw)) {
    return "Theater refresh failed — temporary network or server error.";
  }
  return raw || "Theater refresh failed.";
}

export function TheaterWatchPanel() {
  const [data, setData] = useState<TheaterWatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [aisStatus, setAisStatus] = useState<AisStatus>(loadAisStatus);
  const [aisNote, setAisNote] = useState(() => loadLocal(AIS_NOTE_KEY));
  const [hullStatus, setHullStatus] = useState<Record<HullKey, HullStatus>>(
    () => ({
      bataan: loadHullStatus("bataan"),
      boxer: loadHullStatus("boxer"),
      newYork: loadHullStatus("newYork"),
    }),
  );
  const [hullNote, setHullNote] = useState<Record<HullKey, string>>(() => ({
    bataan: loadLocal("tradehole.kharg.bataanNote"),
    boxer: loadLocal("tradehole.kharg.boxerNote"),
    newYork: loadLocal("tradehole.kharg.newYorkNote"),
  }));
  const [irgcStatus, setIrgcStatus] = useState<IrgcStatus>(loadIrgcStatus);
  const [irgcNote, setIrgcNote] = useState(() =>
    loadLocal("tradehole.kharg.irgcNote"),
  );
  const [capeStatus, setCapeStatus] = useState<CapeStatus>(loadCapeStatus);
  const [capeNote, setCapeNote] = useState(() =>
    loadLocal("tradehole.kharg.capeNote"),
  );
  const [romeStatus, setRomeStatus] = useState<RomeStatus>(loadRomeStatus);
  const [romeNote, setRomeNote] = useState(() =>
    loadLocal("tradehole.bibi.romeNote"),
  );
  const [copied, setCopied] = useState(false);

  const dataRef = useRef<TheaterWatch | null>(null);
  dataRef.current = data;

  const refresh = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const next = await fetchTheaterWatch(force);
      setData(next);
      setError(null);
    } catch (err) {
      if (!dataRef.current) setError(humanizeTheaterError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(false);
    const id = window.setInterval(() => void refresh(false), 90_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    try {
      localStorage.setItem(AIS_STATUS_KEY, aisStatus);
      localStorage.setItem(AIS_NOTE_KEY, aisNote);
      for (const key of HULL_KEYS) {
        localStorage.setItem(`tradehole.kharg.${key}Status`, hullStatus[key]);
        localStorage.setItem(`tradehole.kharg.${key}Note`, hullNote[key]);
      }
      localStorage.setItem("tradehole.kharg.irgcStatus", irgcStatus);
      localStorage.setItem("tradehole.kharg.irgcNote", irgcNote);
      localStorage.setItem("tradehole.kharg.capeStatus", capeStatus);
      localStorage.setItem("tradehole.kharg.capeNote", capeNote);
      localStorage.setItem("tradehole.bibi.romeStatus", romeStatus);
      localStorage.setItem("tradehole.bibi.romeNote", romeNote);
    } catch {
      /* ignore */
    }
  }, [
    aisStatus,
    aisNote,
    hullStatus,
    hullNote,
    irgcStatus,
    irgcNote,
    capeStatus,
    capeNote,
    romeStatus,
    romeNote,
  ]);

  const aisRead =
    aisStatus === "anchored"
      ? data?.ais.readAnchored
      : aisStatus === "cape"
        ? data?.ais.readCapeDiversion
        : aisStatus === "normal"
          ? "VLCCs moving normally through the Strait — no clear loitering or Cape diversion signal."
          : "AIS posture not set — optional Layer-3 mark after Decision Footprint / Market Surprise; deep-link maps if needed.";

  const copyFiveCheck = useCallback(async () => {
    if (!data) return;
    const k = data.khargPickaxe;
    const b = data.bibiSpoiler;
    const lines = [
      `# Tradehole 5-check pack · ${data.fetchedAt}`,
      "",
      "## 1. Hormuz VLCCs (manual AIS · Layer-3 gap)",
      `Status: ${aisStatus}`,
      aisNote
        ? `Note: ${aisNote}`
        : "Note: (optional — Decision Footprint / Market Surprise are primary; AIS is Layer-3 corroboration only)",
      `Read: ${aisRead}`,
      "",
      "## 2. BDTI",
      `Latest: ${data.bdti.latest?.value ?? "—"} @ ${data.bdti.latest?.date ?? "—"}`,
      `d/d: ${pct(data.bdti.changePct1d)} · 5d: ${pct(data.bdti.changePct5d)}`,
      `Rising vs soft oil: ${data.bdti.risingVsOil == null ? "—" : data.bdti.risingVsOil ? "YES" : "no"}`,
      data.bdti.read,
      "",
      "## 3. Peers vs FRO",
      ...data.peers.rows.map(
        (r) =>
          `${r.symbol} (${r.label}): $${fmtMoney(r.price)} ${pct(r.changePct)}`,
      ),
      data.peers.read,
      "",
      "## 4. WTI calendar (front vs Dec '26)",
      `${data.wtiCurve.near.label}: $${fmtMoney(data.wtiCurve.near.price)} ${pct(data.wtiCurve.near.changePct)}`,
      `${data.wtiCurve.far.label}: $${fmtMoney(data.wtiCurve.far.price)} ${pct(data.wtiCurve.far.changePct)}`,
      `Spread: $${data.wtiCurve.spread?.toFixed(2) ?? "—"} · ${data.wtiCurve.regime}`,
      data.wtiCurve.read,
      "",
      "## 5. Polymarket",
      data.polymarket.ceasefire
        ? `Ceasefire: ${data.polymarket.ceasefire.yesPct ?? "—"}% — ${data.polymarket.ceasefire.question}`
        : "Ceasefire: —",
      data.polymarket.hormuz
        ? `Hormuz: ${data.polymarket.hormuz.yesPct ?? "—"}% — ${data.polymarket.hormuz.question}`
        : "Hormuz: —",
      data.polymarket.read,
      "",
      "## 6. War-risk insurance (news)",
      `Regime: ${data.warRiskInsurance.regime}`,
      data.warRiskInsurance.read,
      ...data.warRiskInsurance.items.slice(0, 5).map((i) => `- ${i.title}`),
      "",
      "## 7. Oman / Iran state media",
      `Regime: ${data.stateMedia.regime}`,
      data.stateMedia.read,
      ...data.stateMedia.items
        .slice(0, 6)
        .map((i) => `- [${i.source}] ${i.title}`),
      "",
      "## 8. HO / RB product calendars",
      `Regime: ${data.productCurves.regime}`,
      data.productCurves.read,
      `HO spread $${data.productCurves.heatingOil.spread?.toFixed(4) ?? "—"}/gal (${data.productCurves.heatingOil.regime})`,
      `RB spread $${data.productCurves.gasoline.spread?.toFixed(4) ?? "—"}/gal (${data.productCurves.gasoline.regime})`,
      "",
      "## 9. Kharg / Pickaxe ARG tell",
      k.thesis,
      k.amphibious.context,
      "",
      "| Ship | Check | Bullish Kharg | Bearish delay |",
      "| --- | --- | --- | --- |",
      ...k.amphibious.decisionTable.map(
        (r) =>
          `| ${r.ship} | ${r.check} | ${r.bullishKharg} | ${r.bearishDelay} |`,
      ),
      "",
      ...k.amphibious.vessels.flatMap((v) => [
        `${v.name} (${v.hull}): ${hullStatus[v.key]}${hullNote[v.key] ? ` — ${hullNote[v.key]}` : ""}`,
        ...(v.ironsight
          ? [
              `  IRONSIGHT: ${v.ironsight.status} @ ${v.ironsight.lat.toFixed(2)},${v.ironsight.lon.toFixed(2)}`,
            ]
          : []),
      ]),
      k.amphibious.readOptionA,
      k.amphibious.readOptionB,
      "",
      `E-6B airborne: ${k.e6b.airborneCount} (${k.e6b.regime})`,
      k.e6b.read,
      `IRGC boats: auto=${k.irgcBoats.regime} · manual=${irgcStatus}${irgcNote ? ` — ${irgcNote}` : ""}`,
      k.irgcBoats.read,
      `VLCC Cape: auto=${k.vlccCape.regime} · manual=${capeStatus}${capeNote ? ` — ${capeNote}` : ""}`,
      k.vlccCape.read,
      "",
      ...(data.eastAfricaCape
        ? [
            "## 9d2. East Africa / Somali-basin Cape route (freight watch — not High-go)",
            data.eastAfricaCape.thesis,
            `Regime: ${data.eastAfricaCape.regime}`,
            data.eastAfricaCape.read,
            ...data.eastAfricaCape.signals.map(
              (s) =>
                `- ${s.id}: ${s.status}${s.lit ? ` — ${s.read}` : ""}`,
            ),
            ...data.eastAfricaCape.signals.flatMap((s) =>
              s.evidence.slice(0, 2).map((e) => `  - ${e}`),
            ),
            ...data.eastAfricaCape.rules.map((r) => `- ${r}`),
            "",
          ]
        : []),
      "## 9e. Bataan ghost tracking (pre-AIS)",
      data.bataanGhost.thesis,
      `Formation: ${data.bataanGhost.formationRegime} · score ${data.bataanGhost.formationScore}/${data.bataanGhost.formationMax}`,
      data.bataanGhost.read,
      data.bataanGhost.oneLiner,
      "| Sign | Status | Look for |",
      "| --- | --- | --- |",
      ...data.bataanGhost.signs.map(
        (s) => `| ${s.label} | ${s.status} | ${s.lookFor} |`,
      ),
      ...data.bataanGhost.signs.flatMap((s) => [
        `${s.label}: ${s.status} — ${s.read}`,
        ...s.evidence.slice(0, 3).map((e) => `  - ${e}`),
      ]),
      "",
      "## 10. Bibi Spoiler",
      b.thesis,
      `Rome Trap: ${b.scenarios.romeTrap}`,
      `Nuclear breakout: ${b.scenarios.nuclearBreakout}`,
      `Trade: ${b.tradeImplication}`,
      `Rome: auto=${b.romeTalks.regime} · manual=${romeStatus}${romeNote ? ` — ${romeNote}` : ""}`,
      "Rome next: September — walkout arm DISABLED / not a same-day binary. Do not invent a Rome walkout clock.",
      b.romeTalks.read,
      `USD/ILS ${b.shekel.price?.toFixed(4) ?? "—"} (${pct(b.shekel.changePct)}) vs ~${b.shekel.threshold.toFixed(2)} · ${b.shekel.regime}`,
      b.shekel.read,
      `IDF ground: ${b.idfGround.regime} · IRONSIGHT ${b.idfGround.ironsightOnline ? "up" : "down"}`,
      b.idfGround.read,
      "",
      "## Bonus · Brent / aerial / $46c / Insiders",
      `Brent Sep−Dec: $${data.brentCurve.spread?.toFixed(2) ?? "—"} (${data.brentCurve.regime})`,
      `Gulf tankers: ${data.aerial.tankerCount} · AWACS ${data.aerial.awacsCount} (${data.aerial.regime})`,
      ...(data.aerial.widerTheater
        ? [
            `Wider theater (plot-only): ${data.aerial.widerTheater.tankerCount}t / ${data.aerial.widerTheater.awacsCount}a — not mass_stack, not AER-01`,
          ]
        : []),
      `Sep $46c bid $${fmtMoney(data.focus46c.bid)} · vol ${data.focus46c.volume ?? "—"} (${data.focus46c.regime})`,
      data.insiders.read,
    ];
    const text = lines.join("\n");
    if (window.tradehole?.writeClipboard) {
      await window.tradehole.writeClipboard(text);
    } else {
      await navigator.clipboard.writeText(text);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  }, [
    aisNote,
    aisRead,
    aisStatus,
    capeNote,
    capeStatus,
    data,
    hullNote,
    hullStatus,
    irgcNote,
    irgcStatus,
    romeNote,
    romeStatus,
  ]);

  return (
    <section className="panel theater-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Live free signals</p>
          <h2>Theater watch · exit-timing pack</h2>
          <p className="muted tiny">
            AIS (Layer-3 gap) · BDTI · peers · WTI · Polymarket · war-risk · state media · HO/RB
            · Kharg ARG · East Africa Cape · Ghost · Bibi Spoiler
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
            disabled={loading}
            onClick={() => void refresh(true)}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            className="ghost"
            disabled={!data || loading}
            onClick={() => void copyFiveCheck()}
          >
            {copied ? "Copied" : "Copy pack"}
          </button>
        </div>
      </div>

      {error && <p className="banner error">{error}</p>}
      {!data && !error && (
        <p className="muted">Loading theater signals…</p>
      )}
      {!data && error && loading && (
        <p className="muted">Retrying theater signals…</p>
      )}
      {data && loading && (
        <p className="muted tiny">Refreshing theater signals…</p>
      )}
      {data?.fetchedAt && !loading && (
        <p className="muted tiny">
          Updated {new Date(data.fetchedAt).toLocaleTimeString()}
        </p>
      )}

      {data && (
        <div className="theater-grid">
          <div className="theater-card">
            <p className="eyebrow">Layer-3 · Hormuz VLCCs (manual AIS gap)</p>
            <p className="muted tiny">{data.ais.note}</p>
            <div className="theater-actions">
              {data.ais.links.map((l) => (
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
            <div className="theater-actions">
              {(
                [
                  ["unknown", "Not set"],
                  ["anchored", "Anchored"],
                  ["normal", "Normal transit"],
                  ["cape", "Cape diversion"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  className={aisStatus === v ? "ghost active" : "ghost"}
                  onClick={() => setAisStatus(v)}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              className="theater-input"
              value={aisNote}
              onChange={(e) => setAisNote(e.target.value)}
              placeholder='e.g. "6 VLCCs loitering Fujairah · 1 US DDG toward Strait"'
            />
            <p className="theater-read">{aisRead}</p>
          </div>

          <div className="theater-card">
            <p className="eyebrow">2 · BDTI (daily proxy)</p>
            <p className="theater-big">
              {data.bdti.latest?.value ?? "—"}
              <span className="muted tiny"> {pct(data.bdti.changePct1d)} d/d</span>
            </p>
            <p className="muted tiny">
              as of {data.bdti.latest?.date ?? "—"} · prev{" "}
              {data.bdti.prev?.value ?? "—"} · 5d {pct(data.bdti.changePct5d)}
              {(() => {
                const d = data.bdti.latest?.date;
                if (!d) return "";
                const t = Date.parse(`${d}T12:00:00Z`);
                if (!Number.isFinite(t)) return "";
                const lag = Math.max(
                  0,
                  Math.round((Date.now() - t) / 86_400_000),
                );
                return lag >= 5 ? ` · lag ~${lag}d (not live)` : "";
              })()}
            </p>
            <button
              type="button"
              className="ghost"
              onClick={() => void openExternal(data.bdti.sourceUrl)}
            >
              Open StockQ BDTI
            </button>
            <p className="theater-read">{data.bdti.read}</p>
          </div>

          <div className="theater-card">
            <p className="eyebrow">3 · Peers vs FRO</p>
            <ul className="theater-samples">
              {data.peers.rows.map((r) => (
                <li key={r.symbol}>
                  <strong>{r.symbol}</strong> ${fmtMoney(r.price)}{" "}
                  {pct(r.changePct)}
                </li>
              ))}
            </ul>
            <span className="pill">{data.peers.regime.replace(/_/g, " ")}</span>
            <p className="theater-read">{data.peers.read}</p>
          </div>

          <div className="theater-card">
            <p className="eyebrow">4 · WTI front vs Dec &apos;26</p>
            <p className="theater-big">
              {data.wtiCurve.spread != null
                ? `$${data.wtiCurve.spread.toFixed(2)}`
                : "—"}
            </p>
            <p className="muted tiny">
              {data.wtiCurve.near.label} ${fmtMoney(data.wtiCurve.near.price)}{" "}
              {pct(data.wtiCurve.near.changePct)} · {data.wtiCurve.far.label} $
              {fmtMoney(data.wtiCurve.far.price)}{" "}
              {pct(data.wtiCurve.far.changePct)}
            </p>
            <span className="pill">
              {data.wtiCurve.regime.replace(/_/g, " ")}
            </span>
            <p className="theater-read">{data.wtiCurve.read}</p>
          </div>

          <div className="theater-card emphasize">
            <p className="eyebrow">5 · Polymarket</p>
            <p className="theater-big">
              {data.polymarket.ceasefire?.yesPct != null
                ? `${data.polymarket.ceasefire.yesPct}%`
                : "—"}
              <span className="muted tiny"> ceasefire-ish</span>
            </p>
            <p className="muted tiny">
              Hormuz normal {data.polymarket.hormuz?.yesPct ?? "—"}%
            </p>
            <p className="theater-read">{data.polymarket.read}</p>
            {data.polymarket.top.slice(0, 3).map((m) => (
              <p key={m.question} className="muted tiny">
                {m.yesPct ?? "—"}% · {m.question}
              </p>
            ))}
          </div>

          <div className="theater-card">
            <p className="eyebrow">6 · War-risk insurance</p>
            <span className="pill">
              {data.warRiskInsurance.regime.replace(/_/g, " ")}
            </span>
            <p className="theater-read">{data.warRiskInsurance.read}</p>
            <ul className="theater-samples">
              {data.warRiskInsurance.items.slice(0, 4).map((i) => (
                <li key={i.title + i.pubDate}>
                  <button
                    type="button"
                    className="linkish"
                    onClick={() =>
                      void openExternal(
                        i.link || data.warRiskInsurance.searchUrl,
                      )
                    }
                  >
                    {i.title}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="ghost"
              onClick={() => void openExternal(data.warRiskInsurance.searchUrl)}
            >
              Google News · war risk Hormuz
            </button>
          </div>

          <div className="theater-card">
            <p className="eyebrow">7 · Oman / Iran state media</p>
            <span className="pill">
              {data.stateMedia.regime.replace(/_/g, " ")}
            </span>
            {(data.stateMedia.kineticHits?.length ?? 0) > 0 && (
              <span className="pill warn">kinetic</span>
            )}
            <p className="theater-read">{data.stateMedia.read}</p>
            <ul className="theater-samples">
              {data.stateMedia.items.slice(0, 4).map((i) => (
                <li key={i.title + i.source}>
                  <strong>{i.source}</strong>{" "}
                  <button
                    type="button"
                    className="linkish"
                    onClick={() =>
                      void openExternal(
                        i.link || data.stateMedia.links[0]?.href || "",
                      )
                    }
                  >
                    {i.title}
                  </button>
                </li>
              ))}
            </ul>
            <div className="theater-actions">
              {data.stateMedia.links.slice(0, 2).map((l) => (
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
          </div>

          <div className="theater-card">
            <p className="eyebrow">8 · HO / RB calendars</p>
            <p className="theater-big">
              HO{" "}
              {data.productCurves.heatingOil.spread != null
                ? `$${data.productCurves.heatingOil.spread.toFixed(3)}`
                : "—"}
              <span className="muted tiny"> /gal</span>
            </p>
            <p className="muted tiny">
              RB{" "}
              {data.productCurves.gasoline.spread != null
                ? `$${data.productCurves.gasoline.spread.toFixed(3)}`
                : "—"}
              /gal · {data.productCurves.regime.replace(/_/g, " ")}
            </p>
            <span className="pill">
              {data.productCurves.regime.replace(/_/g, " ")}
            </span>
            <p className="theater-read">{data.productCurves.read}</p>
          </div>

          <div className="theater-card emphasize">
            <p className="eyebrow">9a · ARG tell (Bataan · Boxer · New York)</p>
            <p className="muted tiny">{data.khargPickaxe.amphibious.context}</p>
            <p className="theater-read">
              {data.khargPickaxe.amphibious.readOptionA}
            </p>
            <p className="theater-read">
              {data.khargPickaxe.amphibious.readOptionB}
            </p>
            {data.khargPickaxe.amphibious.vessels.map((v) => (
              <div key={v.key} className="theater-arg-hull">
                <p className="muted tiny">
                  <strong>
                    {v.name} ({v.hull})
                  </strong>{" "}
                  — {v.role}
                  {v.ironsight
                    ? ` · IRONSIGHT ${v.ironsight.status} @ ${v.ironsight.lat.toFixed(1)},${v.ironsight.lon.toFixed(1)}`
                    : " · no IRONSIGHT stamp"}
                </p>
                <div className="theater-actions">
                  {v.links.map((l) => (
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
                <div className="theater-actions">
                  {HULL_STATUS_OPTS.map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      className={
                        hullStatus[v.key] === val ? "ghost active" : "ghost"
                      }
                      onClick={() =>
                        setHullStatus((prev) => ({ ...prev, [v.key]: val }))
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <input
                  className="theater-input"
                  value={hullNote[v.key]}
                  onChange={(e) =>
                    setHullNote((prev) => ({
                      ...prev,
                      [v.key]: e.target.value,
                    }))
                  }
                  placeholder={`${v.hull} note — e.g. "18 kts NE toward Strait"`}
                />
              </div>
            ))}
            {data.khargPickaxe.amphibious.error && (
              <p className="muted tiny">
                {/TypeError|fetch failed/i.test(
                  data.khargPickaxe.amphibious.error,
                )
                  ? "IRONSIGHT naval stamp unavailable"
                  : data.khargPickaxe.amphibious.error}
              </p>
            )}
          </div>

          <div className="theater-card">
            <p className="eyebrow">9b · E-6B Mercury</p>
            <p className="theater-big">
              {data.khargPickaxe.e6b.airborneCount}
              <span className="muted tiny"> airborne</span>
            </p>
            <span className="pill">
              {data.khargPickaxe.e6b.regime.replace(/_/g, " ")}
            </span>
            <p className="theater-read">{data.khargPickaxe.e6b.read}</p>
            <ul className="theater-samples">
              {data.khargPickaxe.e6b.samples.map((s) => (
                <li key={`${s.callsign}-${s.lat}`}>
                  {s.callsign} {s.aircraftType} @ {s.lat.toFixed(1)},
                  {s.lon.toFixed(1)}
                </li>
              ))}
            </ul>
          </div>

          <div className="theater-card">
            <p className="eyebrow">9c · IRGC fast boats</p>
            <span className="pill">
              auto {data.khargPickaxe.irgcBoats.regime.replace(/_/g, " ")}
            </span>
            <p className="theater-read">{data.khargPickaxe.irgcBoats.read}</p>
            <div className="theater-actions">
              {(
                [
                  ["unknown", "Not set"],
                  ["dispersing", "Dispersing"],
                  ["massing", "Massing Oman"],
                  ["reinforcing", "Reinforce Kharg"],
                  ["quiet", "Quiet"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  className={irgcStatus === v ? "ghost active" : "ghost"}
                  onClick={() => setIrgcStatus(v)}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              className="theater-input"
              value={irgcNote}
              onChange={(e) => setIrgcNote(e.target.value)}
              placeholder="Manual IRGC boat note"
            />
            <div className="theater-actions">
              {data.khargPickaxe.irgcBoats.telegramLinks.map((l) => (
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
            <ul className="theater-samples">
              {data.khargPickaxe.irgcBoats.items.slice(0, 4).map((i) => (
                <li key={i.title + i.source}>
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => void openExternal(i.link || "")}
                  >
                    [{i.source}] {i.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="theater-card">
            <p className="eyebrow">9d · VLCC Cape diversion</p>
            <span className="pill">
              auto {data.khargPickaxe.vlccCape.regime.replace(/_/g, " ")}
            </span>
            <p className="theater-read">{data.khargPickaxe.vlccCape.read}</p>
            <div className="theater-actions">
              {(
                [
                  ["unknown", "Not set"],
                  ["diverting", "Cape diverting"],
                  ["normal", "Normal transit"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  className={capeStatus === v ? "ghost active" : "ghost"}
                  onClick={() => setCapeStatus(v)}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              className="theater-input"
              value={capeNote}
              onChange={(e) => setCapeNote(e.target.value)}
              placeholder="Cape / Bab el-Mandeb VLCC note"
            />
            <div className="theater-actions">
              {data.khargPickaxe.vlccCape.links.map((l) => (
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
          </div>

          {data.eastAfricaCape ? (
          <div
            className={
              data.eastAfricaCape.regime === "hot"
                ? "theater-card emphasize"
                : "theater-card"
            }
          >
            <p className="eyebrow">9d2 · East Africa / Somali basin</p>
            <span className="pill">
              {data.eastAfricaCape.regime.replace(/_/g, " ")}
            </span>
            <p className="theater-read">{data.eastAfricaCape.read}</p>
            <p className="muted tiny">{data.eastAfricaCape.thesis}</p>
            <ul className="theater-samples">
              {data.eastAfricaCape.signals.map((s) => (
                <li key={s.id}>
                  <strong>
                    {s.id.replace(/_/g, " ")}
                    {s.lit ? ` · ${s.status}` : " · quiet"}
                  </strong>
                  {s.lit ? ` — ${s.read}` : ""}
                  {s.evidence.slice(0, 2).map((e) => (
                    <p key={e} className="muted tiny">
                      {e}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
            <ul className="theater-samples">
              {data.eastAfricaCape.items.slice(0, 4).map((i) => (
                <li key={i.title + i.pubDate}>
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => void openExternal(i.link || "")}
                  >
                    {i.title}
                  </button>
                </li>
              ))}
            </ul>
            <div className="theater-actions">
              {data.eastAfricaCape.links.map((l) => (
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
          </div>
          ) : null}

          <div className="theater-card emphasize">
            <p className="eyebrow">9e · Bataan ghost (pre-AIS footprints)</p>
            <p className="theater-big">
              {data.bataanGhost.formationRegime.replace(/_/g, " ")}
              <span className="muted tiny">
                {" "}
                · {data.bataanGhost.formationScore}/
                {data.bataanGhost.formationMax}
              </span>
            </p>
            <span className="pill">
              {data.bataanGhost.formationRegime.replace(/_/g, " ")}
            </span>
            <p className="theater-read">{data.bataanGhost.read}</p>
            <p className="muted tiny">{data.bataanGhost.oneLiner}</p>
            <ul className="theater-list">
              {data.bataanGhost.signs.map((s) => (
                <li key={s.id}>
                  <strong>{s.status.toUpperCase()}</strong> · {s.label}
                  <br />
                  <span className="muted tiny">{s.read}</span>
                  <div className="theater-actions">
                    {s.links.slice(0, 2).map((l) => (
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
          </div>

          <div className="theater-card emphasize">
            <p className="eyebrow">10a · Bibi Spoiler · Rome calendar (Sept)</p>
            <p className="muted tiny">{data.bibiSpoiler.thesis}</p>
            <p className="theater-read">{data.bibiSpoiler.scenarios.romeTrap}</p>
            <p className="theater-read">
              {data.bibiSpoiler.scenarios.nuclearBreakout}
            </p>
            <p className="theater-read">{data.bibiSpoiler.tradeImplication}</p>
            {data.politicsCalendar?.headline && (
              <p
                className={`pill politics-calendar-chip${
                  data.politicsCalendar.upcoming[0]?.urgency === "today" ||
                  data.politicsCalendar.upcoming[0]?.urgency === "soon"
                    ? " soon"
                    : ""
                }`}
                title={data.politicsCalendar.upcoming[0]?.note}
              >
                Politics · {data.politicsCalendar.headline}
              </p>
            )}
            <span className="pill">
              auto {data.bibiSpoiler.romeTalks.regime.replace(/_/g, " ")}
            </span>
            <p className="theater-read">{data.bibiSpoiler.romeTalks.read}</p>
            <p className="muted tiny">
              Live walkout / “spoiler path live” / “delegation returning” classifier is
              off. Manual buttons are archive notes only — next round September.
            </p>
            <div className="theater-actions">
              {(
                [
                  ["sept_next", "Sept next round"],
                  ["concluded", "Talks ended"],
                  ["ongoing", "Background chatter"],
                  ["disarmament_demand", "Disarmament (bg)"],
                  ["unknown", "Not set"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  className={romeStatus === v ? "ghost active" : "ghost"}
                  onClick={() => setRomeStatus(v)}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              className="theater-input"
              value={romeNote}
              onChange={(e) => setRomeNote(e.target.value)}
              placeholder="Manual note — e.g. 'Next Rome round September; walkout watch off'"
            />
            <div className="theater-actions">
              {data.bibiSpoiler.romeTalks.links.map((l) => (
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
            <ul className="theater-samples">
              {data.bibiSpoiler.romeTalks.items.slice(0, 4).map((i) => (
                <li key={i.title + i.source}>
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => void openExternal(i.link || "")}
                  >
                    [{i.source}] {i.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="theater-card">
            <p className="eyebrow">10b · Shekel (USD/ILS)</p>
            <p className="theater-big">
              {data.bibiSpoiler.shekel.price != null
                ? data.bibiSpoiler.shekel.price.toFixed(4)
                : "—"}
              <span className="muted tiny">
                {" "}
                vs ~{data.bibiSpoiler.shekel.threshold.toFixed(2)}
              </span>
            </p>
            <p className="muted tiny">
              {pct(data.bibiSpoiler.shekel.changePct)} ·{" "}
              {data.bibiSpoiler.shekel.symbol}
            </p>
            <span className="pill">
              {data.bibiSpoiler.shekel.regime.replace(/_/g, " ")}
            </span>
            <p className="theater-read">{data.bibiSpoiler.shekel.read}</p>
            {data.bibiSpoiler.shekel.error && (
              <p className="muted tiny">{data.bibiSpoiler.shekel.error}</p>
            )}
          </div>

          <div className="theater-card">
            <p className="eyebrow">10c · IDF ground / Lebanon border</p>
            <span className="pill">
              {data.bibiSpoiler.idfGround.regime.replace(/_/g, " ")}
            </span>
            <p className="muted tiny">
              IRONSIGHT{" "}
              {data.bibiSpoiler.idfGround.ironsightOnline
                ? "online"
                : "offline · news RSS fallback"}
            </p>
            <p className="theater-read">{data.bibiSpoiler.idfGround.read}</p>
            <div className="theater-actions">
              {data.bibiSpoiler.idfGround.links.map((l) => (
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
            <ul className="theater-samples">
              {data.bibiSpoiler.idfGround.items.slice(0, 4).map((i) => (
                <li key={i.title + i.source}>
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => void openExternal(i.link || "")}
                  >
                    [{i.source}] {i.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="theater-card">
            <p className="eyebrow">Bonus · Brent / aerial / $46c / Form 4</p>
            <p className="muted tiny">
              Brent Sep−Dec ${data.brentCurve.spread?.toFixed(2) ?? "—"} · Gulf
              tankers {data.aerial.tankerCount}
              {data.aerial.widerTheater
                ? ` · wider ${data.aerial.widerTheater.tankerCount}t (plot)`
                : ""}{" "}
              · $46c bid ${fmtMoney(data.focus46c.bid)} vol{" "}
              {data.focus46c.volume ?? "—"}
            </p>
            <p className="theater-read">{data.focus46c.read}</p>
            <p className="theater-read">{data.insiders.read}</p>
            <button
              type="button"
              className="ghost"
              onClick={() => void openExternal(data.insiders.sourceUrl)}
            >
              OpenInsider FRO
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
