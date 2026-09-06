import type { IsraelStrikeTells } from "../types";
import { aerialDisplayState } from "../lib/aerialFormat";

type AerialTrack = NonNullable<
  IsraelStrikeTells["inputs"]["aerialTracks"]
>[number];

type AerialLastGood = NonNullable<
  IsraelStrikeTells["inputs"]["aerialLastGoodTracks"]
>[number];

type MapOverlays = NonNullable<IsraelStrikeTells["inputs"]["mapOverlays"]>;
type MapZone = MapOverlays["zones"][number];
type MapPoint = MapOverlays["points"][number];

/** Levant / E-Med box for AER tanker viz (Egypt–Cyprus–Israel). */
const LON_MIN = 28.5;
const LON_MAX = 37.2;
const LAT_MIN = 29.2;
const LAT_MAX = 36.0;

const W = 640;
const H = 420;
const PAD = 12;

type Props = {
  tracks: AerialTrack[];
  lastGoodTracks?: AerialLastGood[];
  overlays?: MapOverlays | null;
  ageLabel?: string;
  feedOk?: boolean;
  onOpenFullMap?: () => void;
};

function project(lon: number, lat: number): { x: number; y: number } {
  const x =
    PAD + ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * (W - PAD * 2);
  const y =
    PAD + ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * (H - PAD * 2);
  return { x, y };
}

function inBox(lon: number, lat: number): boolean {
  return lon >= LON_MIN && lon <= LON_MAX && lat >= LAT_MIN && lat <= LAT_MAX;
}

function clampToFrame(
  lat: number,
  lon: number,
): { lat: number; lon: number; off: boolean } {
  const clat = Math.min(LAT_MAX - 0.18, Math.max(LAT_MIN + 0.18, lat));
  const clon = Math.min(LON_MAX - 0.18, Math.max(LON_MIN + 0.18, lon));
  return {
    lat: clat,
    lon: clon,
    off: Math.abs(clat - lat) > 0.01 || Math.abs(clon - lon) > 0.01,
  };
}

function headingArrow(
  x: number,
  y: number,
  trackDeg: number | null,
  len = 22,
): string | null {
  if (trackDeg == null || !Number.isFinite(trackDeg)) return null;
  const rad = ((trackDeg - 90) * Math.PI) / 180;
  const x2 = x + Math.cos(rad) * len;
  const y2 = y + Math.sin(rad) * len;
  return `M ${x.toFixed(1)} ${y.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

function zoneRect(z: MapZone): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const tl = project(z.lonMin, z.latMax);
  const br = project(z.lonMax, z.latMin);
  return {
    x: tl.x,
    y: tl.y,
    w: Math.max(4, br.x - tl.x),
    h: Math.max(4, br.y - tl.y),
  };
}

const LANDMARKS: Array<{ label: string; lon: number; lat: number }> = [
  { label: "Cyprus", lon: 33.0, lat: 35.0 },
  { label: "LLBG", lon: 34.89, lat: 32.01 },
  { label: "Hatzerim", lon: 34.66, lat: 31.23 },
  { label: "Haifa", lon: 35.0, lat: 32.82 },
  { label: "Cairo", lon: 31.24, lat: 30.04 },
  { label: "Beirut", lon: 35.5, lat: 33.9 },
];

function badgeLabel(t: {
  stale?: boolean;
  followed?: boolean;
  displayState?: string;
  darkReason?: string;
  stateDetail?: string;
  ageSec?: number;
}): { text: string; cls: string; title: string } {
  const b = aerialDisplayState({
    hex: "",
    callsign: "",
    kind: "",
    acType: "",
    lat: 0,
    lon: 0,
    stale: t.stale,
    followed: t.followed,
    displayState: t.displayState as
      | "live"
      | "dark"
      | "landed"
      | "followed"
      | undefined,
    darkReason: t.darkReason as
      | "descent_rtb"
      | "emcon_orbit"
      | "unknown"
      | undefined,
    stateDetail: t.stateDetail,
    ageSec: t.ageSec,
  });
  return { text: b.label, cls: b.className, title: b.title };
}

function kindClass(kind: string): string {
  if (kind === "awacs") return "awacs";
  if (kind === "tanker") return "tanker";
  return "mil";
}

function zoneClass(z: MapZone): string {
  return `ist-map-zone ${z.kind} ${z.status}`;
}

function aisClass(cat: string): string {
  if (cat === "military" || cat === "interest") return "navy";
  if (cat === "tanker") return "ship-tanker";
  return "ship";
}

/**
 * Lightweight Levant OSINT map — no Leaflet/Mapbox.
 * ADS-B tracks + NOTAM FIR approximations + Cyprus AIS + DIP/NAV boxes.
 */
export function LevantAerialMap({
  tracks,
  lastGoodTracks = [],
  overlays,
  ageLabel,
  feedOk,
  onOpenFullMap,
}: Props) {
  const visible = tracks.filter((t) => inBox(t.lon, t.lat) && !t.followed);
  const followed = tracks.filter((t) => t.followed);
  const dark = lastGoodTracks.filter(
    (t) => Number.isFinite(t.lat) && Number.isFinite(t.lon),
  );
  const westbound = visible.filter((t) => t.bearingHint === "westbound").length;
  const zones = overlays?.zones ?? [];
  const points = (overlays?.points ?? []).filter((p) => inBox(p.lon, p.lat));
  const notamZones = zones.filter((z) => z.kind === "notam");
  const adsbZones = zones.filter((z) => z.kind === "adsb_box");
  const otherZones = zones.filter(
    (z) => z.kind !== "notam" && z.kind !== "adsb_box",
  );
  const notamLit = overlays?.notamStatus !== "quiet" && notamZones.length > 0;

  return (
    <div className="ist-aerial-map">
      <div className="ist-aerial-map-head">
        <p className="eyebrow">Levant map · ADS-B · NOTAM · AIS</p>
        <p className="muted tiny">
          {visible.length} ac
          {followed.length > 0 ? ` · ${followed.length} followed outbound` : ""}
          {dark.length > 0 ? ` · ${dark.length} DARK/last-known` : ""}
          {westbound > 0 ? ` · ${westbound} westbound` : ""}
          {points.length > 0 ? ` · ${points.length} AIS` : ""}
          {(() => {
            const aisZ = zones.find((z) => z.kind === "cyprus_ais");
            if (!aisZ) return "";
            if (/KEY UNSET/i.test(aisZ.label)) return " · AIS KEY UNSET";
            if (/LIVE/i.test(aisZ.label)) return ` · ${aisZ.label.replace("Cyprus AIS · ", "AIS ")}`;
            return ` · AIS ${aisZ.status}`;
          })()}
          {notamLit
            ? ` · NOTAM ${overlays?.notamStatus?.toUpperCase()} (${notamZones.length} zone${notamZones.length === 1 ? "" : "s"})`
            : " · NOTAM quiet"}
          {ageLabel ? ` · ${ageLabel}` : ""}
          {feedOk === false ? " · last-good / degraded" : ""}
          {" · "}approx FIR boxes from RSS — not official NOTAM geometry
          {onOpenFullMap ? (
            <>
              {" · "}
              <button
                type="button"
                className="linkish"
                onClick={onOpenFullMap}
              >
                Open Map tab (OSM)
              </button>
            </>
          ) : null}
        </p>
      </div>

      <svg
        className="ist-aerial-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Levant OSINT map"
      >
        <rect
          className="ist-aerial-sea"
          x={0}
          y={0}
          width={W}
          height={H}
          rx={6}
        />

        <ellipse
          className="ist-aerial-land"
          cx={project(31.2, 30.5).x}
          cy={project(31.2, 30.5).y}
          rx={95}
          ry={70}
        />
        <ellipse
          className="ist-aerial-land"
          cx={project(35.0, 31.8).x}
          cy={project(35.0, 31.8).y}
          rx={55}
          ry={85}
        />
        <ellipse
          className="ist-aerial-land"
          cx={project(33.0, 35.0).x}
          cy={project(33.0, 35.0).y}
          rx={38}
          ry={22}
        />
        <ellipse
          className="ist-aerial-land soft"
          cx={project(36.2, 34.5).x}
          cy={project(36.2, 34.5).y}
          rx={40}
          ry={55}
        />

        <path
          className="ist-aerial-coast"
          d={`M ${project(29.5, 31.2).x} ${project(29.5, 31.2).y}
              Q ${project(32.5, 31.5).x} ${project(32.5, 31.5).y}
                ${project(34.5, 32.9).x} ${project(34.5, 32.9).y}
              T ${project(35.2, 34.5).x} ${project(35.2, 34.5).y}`}
          fill="none"
        />

        {/* ADS-B sample boxes (subtle) */}
        {adsbZones.map((z) => {
          const r = zoneRect(z);
          return (
            <g key={z.id} className={zoneClass(z)}>
              <rect
                x={r.x}
                y={r.y}
                width={r.w}
                height={r.h}
                rx={2}
                className="ist-map-zone-fill"
              />
            </g>
          );
        })}

        {/* NOTAM / DIP / NAV / Cyprus AIS zones */}
        {[...otherZones, ...notamZones].map((z) => {
          const r = zoneRect(z);
          return (
            <g key={z.id} className={zoneClass(z)}>
              <rect
                x={r.x}
                y={r.y}
                width={r.w}
                height={r.h}
                rx={3}
                className="ist-map-zone-fill"
              />
              <text
                className="ist-map-zone-label"
                x={r.x + 4}
                y={r.y + 12}
              >
                {z.kind === "notam" ? "NOTAM" : z.kind === "dip_border" ? "DIP-01" : z.kind === "nav_watch" ? "NAV-01" : z.kind === "cyprus_ais" ? "AIS" : z.label}
              </text>
            </g>
          );
        })}

        {LANDMARKS.map((lm) => {
          const p = project(lm.lon, lm.lat);
          return (
            <g key={lm.label}>
              <circle className="ist-aerial-lm-dot" cx={p.x} cy={p.y} r={2.5} />
              <text className="ist-aerial-lm" x={p.x + 5} y={p.y + 3}>
                {lm.label}
              </text>
            </g>
          );
        })}

        <text className="ist-aerial-sea-label" x={120} y={90}>
          Mediterranean
        </text>

        {/* Cyprus AIS vessels */}
        {points.map((p: MapPoint) => {
          const pos = project(p.lon, p.lat);
          const arrow = headingArrow(pos.x, pos.y, p.cog, 14);
          return (
            <g key={p.id} className={`ist-map-ais ${aisClass(p.category)}`}>
              {arrow ? (
                <path className="ist-map-ais-hdg" d={arrow} fill="none" />
              ) : null}
              <rect
                className="ist-map-ais-dot"
                x={pos.x - 3.5}
                y={pos.y - 3.5}
                width={7}
                height={7}
                transform={`rotate(45 ${pos.x} ${pos.y})`}
              />
              <text className="ist-map-ais-label" x={pos.x + 7} y={pos.y - 4}>
                {p.label.slice(0, 14)}
              </text>
            </g>
          );
        })}

        {/* ADS-B aircraft */}
        {visible.map((t) => {
          const trailPts = t.trail
            .filter((p) => inBox(p.lon, p.lat))
            .map((p) => project(p.lon, p.lat));
          const pos = project(t.lon, t.lat);
          const arrow = headingArrow(pos.x, pos.y, t.trackDeg);
          const badge = badgeLabel(t);
          const trailPath =
            trailPts.length >= 2
              ? trailPts
                  .map(
                    (p, i) =>
                      `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`,
                  )
                  .join(" ")
              : null;
          return (
            <g key={t.hex} className={`ist-aerial-ac ${kindClass(t.kind)}`}>
              {trailPath ? (
                <path className="ist-aerial-trail" d={trailPath} fill="none" />
              ) : null}
              {arrow ? (
                <path className="ist-aerial-hdg" d={arrow} fill="none" />
              ) : null}
              <circle className="ist-aerial-dot" cx={pos.x} cy={pos.y} r={5} />
              <text className="ist-aerial-call" x={pos.x + 8} y={pos.y - 6}>
                {t.callsign} · {badge.text}
              </text>
              <title>{badge.title}</title>
              <text className="ist-aerial-meta" x={pos.x + 8} y={pos.y + 8}>
                {t.trackDeg != null ? `${Math.round(t.trackDeg)}°` : "—"}
                {t.gsKt != null ? ` · ${Math.round(t.gsKt)}kt` : ""}
                {t.bearingHint !== "orbit/unknown" ? ` · ${t.bearingHint}` : ""}
              </text>
            </g>
          );
        })}

        {followed.map((t) => {
          const clamped = clampToFrame(t.lat, t.lon);
          const pos = project(clamped.lon, clamped.lat);
          const badge = badgeLabel({ ...t, followed: true });
          const label = `${t.callsign || t.hex} · ${badge.text}`;
          return (
            <g
              key={`fol-${t.hex}`}
              className={`ist-aerial-ac followed ${kindClass(t.kind)}`}
            >
              <polygon
                className="ist-aerial-dot"
                points={`${pos.x},${pos.y - 7} ${pos.x + 6},${pos.y + 5} ${pos.x - 6},${pos.y + 5}`}
              />
              <text className="ist-aerial-call" x={pos.x + 8} y={pos.y - 6}>
                {label}
              </text>
              <text className="ist-aerial-meta" x={pos.x + 8} y={pos.y + 8}>
                {t.followRegion ?? `${t.lat.toFixed(1)},${t.lon.toFixed(1)}`}
                {t.gsKt != null ? ` · ${Math.round(t.gsKt)}kt` : ""}
              </text>
            </g>
          );
        })}

        {dark.map((t) => {
          const clamped = clampToFrame(t.lat, t.lon);
          const pos = project(clamped.lon, clamped.lat);
          const arrow = headingArrow(pos.x, pos.y, t.trackDeg);
          const badge = badgeLabel({ ...t, stale: true });
          const age =
            t.ageSec != null
              ? t.ageSec >= 60
                ? `${Math.round(t.ageSec / 60)}m`
                : `${t.ageSec}s`
              : "";
          return (
            <g
              key={`dark-${t.hex}`}
              className={`ist-aerial-ac stale ${kindClass(t.kind)}`}
            >
              {arrow ? (
                <path className="ist-aerial-hdg" d={arrow} fill="none" />
              ) : null}
              <circle className="ist-aerial-dot" cx={pos.x} cy={pos.y} r={5} />
              <text className="ist-aerial-call" x={pos.x + 8} y={pos.y - 6}>
                {t.callsign || t.hex} · {badge.text}
                {age ? ` ${age}` : ""}
              </text>
              <title>{badge.title}</title>
              <text className="ist-aerial-meta" x={pos.x + 8} y={pos.y + 8}>
                {t.trackDeg != null ? `${Math.round(t.trackDeg)}°` : "—"}
                {t.stateDetail ? ` · ${t.stateDetail.slice(0, 36)}` : ""}
                {clamped.off ? " · last-known" : ""}
              </text>
            </g>
          );
        })}

        {visible.length === 0 &&
          followed.length === 0 &&
          dark.length === 0 &&
          points.length === 0 &&
          !notamLit && (
          <text
            className="ist-aerial-empty"
            x={W / 2}
            y={H / 2}
            textAnchor="middle"
          >
            No live tracks in box — boxes still show watch areas
          </text>
        )}
      </svg>

      <ul className="ist-aerial-legend">
        {visible.map((t) => {
          const badge = badgeLabel(t);
          return (
          <li key={t.hex}>
            <span className={badge.cls} title={badge.title}>
              {badge.text}
            </span>{" "}
            <strong className={kindClass(t.kind)}>{t.callsign}</strong>
            <span className="muted">
              {" "}
              hex {t.hex} · type {t.acType}
              {t.desc ? ` (${t.desc.slice(0, 28)})` : ""} · class {t.kind} ·{" "}
              {t.lat.toFixed(2)},{t.lon.toFixed(2)}
              {t.trackDeg != null ? ` · hdg ${Math.round(t.trackDeg)}°` : ""}
              {t.gsKt != null ? ` · ${Math.round(t.gsKt)}kt` : ""}
              {t.altFt != null ? ` · FL${Math.round(t.altFt / 100)}` : ""}
              {` · ${t.bearingHint}`}
            </span>
          </li>
          );
        })}
        {followed.map((t) => {
          const badge = badgeLabel({ ...t, followed: true });
          return (
          <li key={`fol-${t.hex}`}>
            <span className={badge.cls} title={badge.title}>
              {badge.text}
            </span>{" "}
            <strong className={kindClass(t.kind)}>{t.callsign}</strong>
            <span className="muted">
              {" "}
              FOLLOWED · hex {t.hex} · type {t.acType} · class {t.kind} ·{" "}
              {t.followRegion ?? `${t.lat.toFixed(2)},${t.lon.toFixed(2)}`}
              {t.gsKt != null ? ` · ${Math.round(t.gsKt)}kt` : ""} · not scored
            </span>
          </li>
          );
        })}
        {dark.map((t) => {
          const badge = badgeLabel({ ...t, stale: true });
          return (
          <li key={`dark-${t.hex}`}>
            <span className={badge.cls} title={badge.title}>
              {badge.text}
              {t.ageSec != null
                ? ` ${t.ageSec >= 60 ? `${Math.round(t.ageSec / 60)}m` : `${t.ageSec}s`}`
                : ""}
            </span>{" "}
            <strong className={`${kindClass(t.kind)} stale`}>{t.callsign}</strong>
            <span className="muted">
              {" "}
              DARK · hex {t.hex} · type {t.acType} · class {t.kind} ·{" "}
              {t.lat.toFixed(2)},{t.lon.toFixed(2)}
              {t.trackDeg != null ? ` · hdg ${Math.round(t.trackDeg)}°` : ""}
              {t.stateDetail ? ` · ${t.stateDetail}` : ""}
              {t.ageSec != null ? ` · age ${t.ageSec}s` : ""} · not scored
            </span>
          </li>
          );
        })}
        {points.map((p) => (
          <li key={p.id}>
            <strong className={aisClass(p.category)}>{p.label}</strong>
            <span className="muted">
              {" "}
              AIS {p.category} · {p.lat.toFixed(2)},{p.lon.toFixed(2)}
              {p.sog != null ? ` · ${p.sog.toFixed(1)}kt` : ""}
              {p.cog != null ? ` · cog ${Math.round(p.cog)}°` : ""}
            </span>
          </li>
        ))}
        {notamZones.map((z) => (
          <li key={z.id}>
            <strong className="notam">{z.label}</strong>
            <span className="muted">
              {" "}
              {z.status.toUpperCase()}
              {z.titles?.[0] ? ` · ${z.titles[0].slice(0, 90)}` : ""}
            </span>
          </li>
        ))}
        {otherZones
          .filter((z) => z.kind === "dip_border" || z.status === "hot" || z.status === "warm")
          .map((z) => (
            <li key={z.id}>
              <strong className={z.kind}>{z.label}</strong>
              <span className="muted">
                {" "}
                {z.status.toUpperCase()}
                {z.titles?.[0] ? ` · ${z.titles[0].slice(0, 80)}` : ""}
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}
