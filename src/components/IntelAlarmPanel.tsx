import { useCallback, useEffect, useRef, useState } from "react";
import {
  resumeAlarmAudio,
  startOrderAlarm,
  stopOrderAlarm,
} from "../lib/orderAlarmSound";
import {
  fetchIntelAlarm,
  postIntelAlarmManual,
  type IntelAlarmState,
} from "../services/api";

const POLL_MS = 30_000;
const LS = {
  sog: "tradehole.intel.bataanSog",
  course: "tradehole.intel.bataanCourse",
  lat: "tradehole.intel.bataanLat",
  lon: "tradehole.intel.bataanLon",
  boxerSog: "tradehole.intel.boxerSog",
  boxerCourse: "tradehole.intel.boxerCourse",
  boxerLat: "tradehole.intel.boxerLat",
  boxerLon: "tradehole.intel.boxerLon",
  newYorkSog: "tradehole.intel.newYorkSog",
  newYorkCourse: "tradehole.intel.newYorkCourse",
  newYorkLat: "tradehole.intel.newYorkLat",
  newYorkLon: "tradehole.intel.newYorkLon",
  vlcc: "tradehole.intel.vlccDivertCount",
  navwarn: "tradehole.intel.navwarnForce",
  irgc: "tradehole.intel.irgcForce",
  cape: "tradehole.intel.capeForce",
  note: "tradehole.intel.note",
} as const;

function loadNum(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function loadTri(key: string): "" | "true" | "false" {
  try {
    const v = localStorage.getItem(key);
    if (v === "true" || v === "false") return v;
    return "";
  } catch {
    return "";
  }
}

function openExternal(href: string): void {
  if (window.tradehole?.openExternal) {
    void window.tradehole.openExternal(href);
  } else {
    window.open(href, "_blank", "noopener,noreferrer");
  }
}

function parseOptNum(s: string): number | null {
  if (!s.trim()) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseTri(s: "" | "true" | "false"): boolean | null {
  if (s === "true") return true;
  if (s === "false") return false;
  return null;
}

export function IntelAlarmPanel() {
  const [data, setData] = useState<IntelAlarmState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sog, setSog] = useState(() => loadNum(LS.sog));
  const [course, setCourse] = useState(() => loadNum(LS.course));
  const [lat, setLat] = useState(() => loadNum(LS.lat));
  const [lon, setLon] = useState(() => loadNum(LS.lon));
  const [boxerSog, setBoxerSog] = useState(() => loadNum(LS.boxerSog));
  const [boxerCourse, setBoxerCourse] = useState(() =>
    loadNum(LS.boxerCourse),
  );
  const [boxerLat, setBoxerLat] = useState(() => loadNum(LS.boxerLat));
  const [boxerLon, setBoxerLon] = useState(() => loadNum(LS.boxerLon));
  const [newYorkSog, setNewYorkSog] = useState(() => loadNum(LS.newYorkSog));
  const [newYorkCourse, setNewYorkCourse] = useState(() =>
    loadNum(LS.newYorkCourse),
  );
  const [newYorkLat, setNewYorkLat] = useState(() => loadNum(LS.newYorkLat));
  const [newYorkLon, setNewYorkLon] = useState(() => loadNum(LS.newYorkLon));
  const [vlcc, setVlcc] = useState(() => loadNum(LS.vlcc));
  const [navwarn, setNavwarn] = useState<"" | "true" | "false">(() =>
    loadTri(LS.navwarn),
  );
  const [irgc, setIrgc] = useState<"" | "true" | "false">(() =>
    loadTri(LS.irgc),
  );
  const [cape, setCape] = useState<"" | "true" | "false">(() =>
    loadTri(LS.cape),
  );
  const [note, setNote] = useState(() => loadNum(LS.note));
  const [alarming, setAlarming] = useState(false);
  const [alarmKind, setAlarmKind] = useState<"red" | "yellow" | null>(null);
  const primedRef = useRef(false);
  const lastLevelRef = useRef<string | null>(null);
  const titleRef = useRef(document.title);
  const flashRef = useRef<number | null>(null);

  const dismissAlarm = useCallback(() => {
    setAlarming(false);
    setAlarmKind(null);
    stopOrderAlarm();
    if (flashRef.current != null) {
      window.clearInterval(flashRef.current);
      flashRef.current = null;
    }
    document.title = titleRef.current;
  }, []);

  const fireRed = useCallback((state: IntelAlarmState) => {
    setAlarming(true);
    setAlarmKind("red");
    void startOrderAlarm();
    void window.tradehole?.alertOrderFill?.(true);
    const reason =
      state.redReason === "five_lock"
        ? "full 5-lock"
        : state.redReason === "three_lock_stack"
          ? "critical three-lock stack"
          : state.redReason === "bibi_plus_locks"
            ? "Bibi + locks"
            : "stacked footprint";
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification("5-LOCK RED ALARM", {
          body: `${state.lockCount}/5 — ${reason}${state.bibiTrigger ? " · Bibi" : ""}`,
          requireInteraction: true,
          silent: true,
        });
      } else if (
        typeof Notification !== "undefined" &&
        Notification.permission === "default"
      ) {
        void Notification.requestPermission();
      }
    } catch {
      /* ignore */
    }
    titleRef.current = document.title;
    let on = false;
    if (flashRef.current != null) window.clearInterval(flashRef.current);
    flashRef.current = window.setInterval(() => {
      on = !on;
      document.title = on ? "🔴 5-LOCK RED" : titleRef.current;
    }, 700);
  }, []);

  const fireYellow = useCallback((state: IntelAlarmState) => {
    setAlarming(true);
    setAlarmKind("yellow");
    // Softer loop + informational dock bounce — still wakes; RED upgrades if stacked.
    void startOrderAlarm({ soft: true });
    void window.tradehole?.alertOrderFill?.(false);
    try {
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        new Notification("5-LOCK YELLOW", {
          body: `${state.lockCount}/5 locks armed${state.bibiTrigger ? " · Bibi" : ""}`,
          requireInteraction: true,
          silent: true,
        });
      } else if (
        typeof Notification !== "undefined" &&
        Notification.permission === "default"
      ) {
        void Notification.requestPermission();
      }
    } catch {
      /* ignore */
    }
    titleRef.current = document.title;
    let on = false;
    if (flashRef.current != null) window.clearInterval(flashRef.current);
    flashRef.current = window.setInterval(() => {
      on = !on;
      document.title = on ? "🟡 5-LOCK YELLOW" : titleRef.current;
    }, 700);
  }, []);
  const syncManual = useCallback(async () => {
    const payload = {
      bataanSog: parseOptNum(sog),
      bataanCourse: parseOptNum(course),
      bataanLat: parseOptNum(lat),
      bataanLon: parseOptNum(lon),
      boxerSog: parseOptNum(boxerSog),
      boxerCourse: parseOptNum(boxerCourse),
      boxerLat: parseOptNum(boxerLat),
      boxerLon: parseOptNum(boxerLon),
      newYorkSog: parseOptNum(newYorkSog),
      newYorkCourse: parseOptNum(newYorkCourse),
      newYorkLat: parseOptNum(newYorkLat),
      newYorkLon: parseOptNum(newYorkLon),
      vlccDivertCount: parseOptNum(vlcc),
      navwarnForce: parseTri(navwarn),
      irgcForce: parseTri(irgc),
      capeForce: parseTri(cape),
      note: note.trim() || null,
    };
    const next = await postIntelAlarmManual(payload);
    setData(next);
    setError(null);
    return next;
  }, [
    sog,
    course,
    lat,
    lon,
    boxerSog,
    boxerCourse,
    boxerLat,
    boxerLon,
    newYorkSog,
    newYorkCourse,
    newYorkLat,
    newYorkLon,
    vlcc,
    navwarn,
    irgc,
    cape,
    note,
  ]);

  const refresh = useCallback(async () => {
    try {
      // Push local manual fields so server eval matches UI
      const next = await syncManual();
      if (!primedRef.current) {
        primedRef.current = true;
        lastLevelRef.current = next.level;
        return;
      }
      if (
        next.level === "red" &&
        lastLevelRef.current !== "red"
      ) {
        fireRed(next);
      } else if (
        next.level === "yellow" &&
        lastLevelRef.current === "green"
      ) {
        fireYellow(next);
      }
      lastLevelRef.current = next.level;
    } catch (err) {
      try {
        const next = await fetchIntelAlarm(true);
        setData(next);
        setError(null);
      } catch (err2) {
        setError(String(err2 ?? err));
      }
    }
  }, [syncManual, fireRed, fireYellow]);

  useEffect(() => {
    try {
      localStorage.setItem(LS.sog, sog);
      localStorage.setItem(LS.course, course);
      localStorage.setItem(LS.lat, lat);
      localStorage.setItem(LS.lon, lon);
      localStorage.setItem(LS.boxerSog, boxerSog);
      localStorage.setItem(LS.boxerCourse, boxerCourse);
      localStorage.setItem(LS.boxerLat, boxerLat);
      localStorage.setItem(LS.boxerLon, boxerLon);
      localStorage.setItem(LS.newYorkSog, newYorkSog);
      localStorage.setItem(LS.newYorkCourse, newYorkCourse);
      localStorage.setItem(LS.newYorkLat, newYorkLat);
      localStorage.setItem(LS.newYorkLon, newYorkLon);
      localStorage.setItem(LS.vlcc, vlcc);
      localStorage.setItem(LS.navwarn, navwarn);
      localStorage.setItem(LS.irgc, irgc);
      localStorage.setItem(LS.cape, cape);
      localStorage.setItem(LS.note, note);
    } catch {
      /* ignore */
    }
  }, [
    sog,
    course,
    lat,
    lon,
    boxerSog,
    boxerCourse,
    boxerLat,
    boxerLon,
    newYorkSog,
    newYorkCourse,
    newYorkLat,
    newYorkLon,
    vlcc,
    navwarn,
    irgc,
    cape,
    note,
  ]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      window.clearInterval(id);
      stopOrderAlarm();
      if (flashRef.current != null) window.clearInterval(flashRef.current);
      document.title = titleRef.current;
    };
  }, [refresh]);

  const level = data?.level ?? "green";
  const levelClass =
    level === "red" ? "intel-level red" : level === "yellow" ? "intel-level yellow" : "intel-level green";

  const redReasonLabel =
    data?.redReason === "five_lock"
      ? "full 5-lock"
      : data?.redReason === "three_lock_stack"
        ? "critical three-lock stack"
        : data?.redReason === "bibi_plus_locks"
          ? "Bibi + ≥2 locks"
          : null;

  return (
    <section className="panel intel-alarm-panel">
      <header className="panel-header">
        <h2>Ultimate 5-Lock Intel Alarm</h2>
        <span className={levelClass}>
          {level.toUpperCase()} · {data?.lockCount ?? "—"}/5
          {redReasonLabel ? ` · ${redReasonLabel}` : ""}
        </span>
      </header>
      <p className="muted intel-rule">
        RED: L1+L2+L3 three-lock stack, or all 5, or Bibi+≥2 locks — critical
        siren + dock. YELLOW: 3–4 without three-lock, or Bibi alone — soft
        looping siren + informational dock. ≤2 = posturing. Sirens need the app
        open (Electron renderer). Mechanics first; Bibi = Shekel ~4.00 (lagging
        market-panic arm) or fresh corroborated Natanz/Fordow strike news (≤48h,
        ≥2 same-day; recycled reprints excluded).
      </p>
      {error && <p className="banner error">{error}</p>}
      {data && (
        <>
          <p className="muted" style={{ fontSize: "0.72rem" }}>
            Eval {data.evaluatedAt}
            {data.transitioned ? " · transitioned" : ""}
            {data.threeLockStack ? " · three-lock armed" : ""}
          </p>
          <div className="theater-actions" style={{ marginBottom: "0.5rem" }}>
            <span className={`pill ${data.bibiTrigger ? "live" : ""}`}>
              Bibi {data.bibiTrigger ? "TRUE" : "false"}
            </span>
            <span
              className={`pill ${
                data.bibi.shekel.spiked
                  ? "live"
                  : data.bibi.shekel.regime === "firm"
                    ? "warn"
                    : ""
              }`}
            >
              Shekel {data.bibi.shekel.price?.toFixed(3) ?? "—"}
              {data.bibi.shekel.spiked
                ? " SPIKED"
                : ` · ${data.bibi.shekel.regime ?? "—"}`}
            </span>
            {data.bibi.nuclearStrikeNews.hit && (
              <span className="pill warn">Natanz/Fordow news</span>
            )}
            {!data.bibi.nuclearStrikeNews.hit &&
              data.bibi.nuclearStrikeNews.rejectedStale.length > 0 && (
                <span className="pill">
                  Natanz RSS filtered ({data.bibi.nuclearStrikeNews.rejectedStale.length})
                </span>
              )}
            {redReasonLabel && level === "red" && (
              <span className="pill live">{redReasonLabel}</span>
            )}
          </div>
          {(data.bibiTrigger ||
            data.bibi.nuclearStrikeNews.rejectedStale.length > 0 ||
            data.bibi.nuclearStrikeNews.titles.length > 0) && (
            <p className="theater-read" style={{ marginBottom: "0.5rem" }}>
              {data.bibi.read}
            </p>
          )}
          <div className="intel-locks">
            {data.locks.map((lock) => (
              <div
                key={lock.id}
                className={`theater-card intel-lock ${lock.triggered ? "fired" : ""}`}
              >
                <div className="intel-lock-head">
                  <span className={`pill ${lock.triggered ? "live" : ""}`}>
                    L{lock.id} {lock.triggered ? "TRUE" : "false"}
                  </span>
                  <strong>{lock.short}</strong>
                  <span className="muted">{lock.source}</span>
                </div>
                <p className="theater-read">{lock.read}</p>
                <div className="theater-actions">
                  {lock.links.slice(0, 3).map((l) => (
                    <button
                      key={l.href}
                      type="button"
                      className="ghost"
                      onClick={() => openExternal(l.href)}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
                <p className="muted" style={{ fontSize: "0.65rem", marginTop: "0.25rem" }}>
                  {lock.limit}
                </p>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="theater-card emphasize intel-manual">
        <strong>Manual AIS / overrides</strong>
        <p className="muted" style={{ fontSize: "0.72rem" }}>
          Bataan SOG / course / lat / lon: IRONSIGHT kinematics auto-fill when
          the ships API includes them; otherwise mark from CruisingEarth (free) or
          VesselFinder. Lat+lon plots a manual ARG pin on Map. Boxer / New York
          optional (map only; Lock 1 stays Bataan). VLCC divert count from
          TankerMap south of Yemen / Cape.
        </p>
        <div className="intel-manual-grid">
          <label>
            Bataan SOG (kts)
            <input
              className="theater-input"
              value={sog}
              onChange={(e) => setSog(e.target.value)}
              inputMode="decimal"
              placeholder="e.g. 16"
            />
          </label>
          <label>
            Course (°)
            <input
              className="theater-input"
              value={course}
              onChange={(e) => setCourse(e.target.value)}
              inputMode="decimal"
              placeholder="e.g. 320"
            />
          </label>
          <label>
            Lat (°N)
            <input
              className="theater-input"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              inputMode="decimal"
              placeholder="e.g. 26.8"
            />
          </label>
          <label>
            Lon (°E)
            <input
              className="theater-input"
              value={lon}
              onChange={(e) => setLon(e.target.value)}
              inputMode="decimal"
              placeholder="e.g. 51.5"
            />
          </label>
          <label>
            Boxer SOG
            <input
              className="theater-input"
              value={boxerSog}
              onChange={(e) => setBoxerSog(e.target.value)}
              inputMode="decimal"
              placeholder="optional"
            />
          </label>
          <label>
            Boxer course
            <input
              className="theater-input"
              value={boxerCourse}
              onChange={(e) => setBoxerCourse(e.target.value)}
              inputMode="decimal"
              placeholder="optional"
            />
          </label>
          <label>
            Boxer lat
            <input
              className="theater-input"
              value={boxerLat}
              onChange={(e) => setBoxerLat(e.target.value)}
              inputMode="decimal"
              placeholder="need lon to plot"
            />
          </label>
          <label>
            Boxer lon
            <input
              className="theater-input"
              value={boxerLon}
              onChange={(e) => setBoxerLon(e.target.value)}
              inputMode="decimal"
              placeholder="need lat to plot"
            />
          </label>
          <label>
            New York SOG
            <input
              className="theater-input"
              value={newYorkSog}
              onChange={(e) => setNewYorkSog(e.target.value)}
              inputMode="decimal"
              placeholder="optional"
            />
          </label>
          <label>
            New York course
            <input
              className="theater-input"
              value={newYorkCourse}
              onChange={(e) => setNewYorkCourse(e.target.value)}
              inputMode="decimal"
              placeholder="optional"
            />
          </label>
          <label>
            New York lat
            <input
              className="theater-input"
              value={newYorkLat}
              onChange={(e) => setNewYorkLat(e.target.value)}
              inputMode="decimal"
              placeholder="need lon to plot"
            />
          </label>
          <label>
            New York lon
            <input
              className="theater-input"
              value={newYorkLon}
              onChange={(e) => setNewYorkLon(e.target.value)}
              inputMode="decimal"
              placeholder="need lat to plot"
            />
          </label>
          <label>
            VLCC divert count
            <input
              className="theater-input"
              value={vlcc}
              onChange={(e) => setVlcc(e.target.value)}
              inputMode="numeric"
              placeholder="≥3 fires Lock 5"
            />
          </label>
          <label>
            NAVWARN force
            <select
              className="theater-input"
              value={navwarn}
              onChange={(e) =>
                setNavwarn(e.target.value as "" | "true" | "false")
              }
            >
              <option value="">auto</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </label>
          <label>
            IRGC force
            <select
              className="theater-input"
              value={irgc}
              onChange={(e) =>
                setIrgc(e.target.value as "" | "true" | "false")
              }
            >
              <option value="">auto</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </label>
          <label>
            Cape force
            <select
              className="theater-input"
              value={cape}
              onChange={(e) =>
                setCape(e.target.value as "" | "true" | "false")
              }
            >
              <option value="">auto</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </label>
        </div>
        <input
          className="theater-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="One-line note (persists to Export ALL)"
        />
        <div className="theater-actions">
          <button type="button" className="ghost active" onClick={() => void refresh()}>
            Push &amp; re-eval
          </button>
        </div>
      </div>

      {alarming && (
        <div
          className={`fill-alarm-overlay ${
            alarmKind === "yellow" ? "intel-yellow" : "filled"
          }`}
          role="alertdialog"
          onClick={() => {
            void resumeAlarmAudio().then(() =>
              void startOrderAlarm({ soft: alarmKind === "yellow" }),
            );
          }}
        >
          <div className="fill-alarm-card">
            <p className="fill-alarm-eyebrow">ULTIMATE INTEL ALARM</p>
            <h2>
              {alarmKind === "yellow" ? "5-LOCK YELLOW" : "5-LOCK RED"}
            </h2>
            <p className="fill-alarm-order">
              {alarmKind === "yellow"
                ? `${data?.lockCount ?? "—"}/5 locks armed${
                    data?.bibiTrigger ? " · Bibi" : ""
                  }`
                : data?.redReason === "three_lock_stack"
                  ? "Critical three-lock stack — Kharg / Hormuz"
                  : data?.redReason === "bibi_plus_locks"
                    ? "Bibi secondary + locks — spoiler path"
                    : `${data?.lockCount ?? 5}/5 stacked footprint — Kharg / Hormuz`}
            </p>
            <p className="fill-alarm-detail">
              {alarmKind === "yellow"
                ? data?.reads[0] ??
                  "Yellow arm — elevated locks / Bibi; not full RED stack."
                : data?.reads[0] ?? "All five locks triggered."}
            </p>
            <button
              type="button"
              className="fill-alarm-dismiss"
              onClick={(e) => {
                e.stopPropagation();
                void resumeAlarmAudio();
                dismissAlarm();
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
