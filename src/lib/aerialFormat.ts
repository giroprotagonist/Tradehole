/** Transparent aerial asset lines for UI + paste (never hide ICAO type / hex). */

export type AerialAssetLike = {
  hex: string;
  callsign: string;
  kind: string;
  acType: string;
  lat: number;
  lon: number;
  trackDeg?: number | null;
  gsKt?: number | null;
  altFt?: number | null;
  bearingHint?: string | null;
  source?: string | null;
  desc?: string | null;
  stale?: boolean;
  ageSec?: number;
  lastSeenAt?: string;
  followed?: boolean;
  inBox?: boolean;
  followRegion?: string | null;
  displayState?: "live" | "dark" | "landed" | "followed";
  darkReason?: "descent_rtb" | "emcon_orbit" | "unknown";
  stateDetail?: string | null;
};

export function aerialDisplayState(t: AerialAssetLike): {
  state: "live" | "dark" | "landed" | "followed";
  label: string;
  className: string;
  title: string;
} {
  const state =
    t.displayState ??
    (t.stale ? "dark" : t.followed ? "followed" : "live");
  if (state === "landed") {
    return {
      state,
      label: "LANDED",
      className: "aerial-state-badge landed",
      title: t.stateDetail ?? "On ground / at base",
    };
  }
  if (state === "dark") {
    const reason =
      t.darkReason === "descent_rtb"
        ? "descent RTB"
        : t.darkReason === "emcon_orbit"
          ? "mid-orbit EMCON"
          : "no ping";
    const age =
      t.ageSec != null
        ? ` · dark ${t.ageSec >= 60 ? `${Math.round(t.ageSec / 60)}m` : `${t.ageSec}s`}`
        : "";
    return {
      state,
      label: "DARK",
      className: "aerial-state-badge dark",
      title: `${reason}${t.stateDetail ? ` · ${t.stateDetail}` : ""}${age}`,
    };
  }
  if (state === "followed") {
    return {
      state,
      label: "FOLLOWED",
      className: "aerial-state-badge followed",
      title: t.followRegion ?? "Enrolled — outside scoring box",
    };
  }
  return {
    state: "live",
    label: "LIVE",
    className: "aerial-state-badge live",
    title: t.stateDetail ?? "Transmitting",
  };
}

/** One-line desk / paste format — kind is our label; type is raw ICAO. */
export function formatAerialAssetLine(t: AerialAssetLike): string {
  const cs = t.callsign?.trim() || "—";
  const hex = (t.hex || "").replace(/^hex:/i, "") || "?";
  const type = t.acType?.trim() || "?";
  const descBit =
    t.desc && t.desc.trim() && t.desc.trim() !== type
      ? ` (${t.desc.trim().slice(0, 40)})`
      : "";
  const badge = aerialDisplayState(t);
  const live = badge.label;
  const detail =
    t.stateDetail && (badge.state === "dark" || badge.state === "landed")
      ? ` · ${t.stateDetail}`
      : "";
  const hdg =
    t.trackDeg != null && Number.isFinite(t.trackDeg)
      ? ` hdg ${Math.round(t.trackDeg)}°`
      : "";
  const gs =
    t.gsKt != null && Number.isFinite(t.gsKt)
      ? ` ${Math.round(t.gsKt)}kt`
      : "";
  const alt =
    t.altFt != null && Number.isFinite(t.altFt)
      ? ` FL${Math.round(t.altFt / 100)}`
      : "";
  const age =
    badge.state === "dark" && t.ageSec != null
      ? ` · dark ${t.ageSec >= 60 ? `${Math.round(t.ageSec / 60)}m` : `${t.ageSec}s`}`
      : t.stale && t.ageSec != null
        ? ` age ${t.ageSec}s`
        : "";
  const src = t.source ? ` · ${t.source}` : "";
  const hint = t.bearingHint ? ` · ${t.bearingHint}` : "";
  const region =
    t.followed && t.followRegion ? ` · ${t.followRegion}` : "";
  const scored =
    t.followed && !t.stale ? " · not scored" : "";
  return `${live} ${cs} · hex ${hex} · type ${type}${descBit} · class ${t.kind} · ${t.lat.toFixed(3)},${t.lon.toFixed(3)}${hdg}${gs}${alt}${detail}${age}${hint}${region}${scored}${src}`;
}

export function formatAerialAssetShort(t: AerialAssetLike): string {
  const cs = t.callsign?.trim() || "—";
  const hex = (t.hex || "").slice(0, 8) || "?";
  const type = t.acType?.trim() || "?";
  const live = aerialDisplayState(t).label;
  return `${live} ${cs} · ${type} · hex ${hex} · ${t.kind}`;
}
