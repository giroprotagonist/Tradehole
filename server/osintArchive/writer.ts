import {
  getOsintArchiveDb,
  inOsintTheater,
  markArchiveWrite,
  pruneOsintArchive,
} from "./db";

const DEDUPE_WINDOW_MS = 60_000;
const ZONE_FORCE_MS = 5 * 60_000;

type DedupeEntry = { latR: number; lonR: number; atMs: number };
const lastAssetWrite = new Map<string, DedupeEntry>();
const lastZoneWrite = new Map<string, { status: string; atMs: number }>();

export type ArchiveAssetInput = {
  assetKey: string;
  kind: string;
  lat: number;
  lon: number;
  altFt?: number | null;
  gsKt?: number | null;
  trackDeg?: number | null;
  label?: string | null;
  source?: string | null;
  region?: string | null;
  stale?: boolean;
  payload?: unknown;
};

export type ArchiveZoneInput = {
  zoneId: string;
  kind: string;
  label?: string | null;
  status: string;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  payload?: unknown;
};

export type ArchiveAerialPeakInput = {
  tankers: number;
  awacs: number;
  otherMil: number;
  feedStatus?: string | null;
  source?: string | null;
};

function roundCoord(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function shouldWriteAsset(
  key: string,
  lat: number,
  lon: number,
  nowMs: number,
): boolean {
  const latR = roundCoord(lat);
  const lonR = roundCoord(lon);
  const prev = lastAssetWrite.get(key);
  if (
    prev &&
    nowMs - prev.atMs < DEDUPE_WINDOW_MS &&
    prev.latR === latR &&
    prev.lonR === lonR
  ) {
    return false;
  }
  lastAssetWrite.set(key, { latR, lonR, atMs: nowMs });
  return true;
}

function shouldWriteZone(
  zoneId: string,
  status: string,
  nowMs: number,
): boolean {
  const prev = lastZoneWrite.get(zoneId);
  if (!prev) {
    lastZoneWrite.set(zoneId, { status, atMs: nowMs });
    return true;
  }
  if (prev.status !== status || nowMs - prev.atMs >= ZONE_FORCE_MS) {
    lastZoneWrite.set(zoneId, { status, atMs: nowMs });
    return true;
  }
  return false;
}

export function recordAssetSamples(
  samples: ArchiveAssetInput[],
  opts?: { ts?: string; reason?: string },
): number {
  const database = getOsintArchiveDb();
  if (!database || samples.length === 0) return 0;

  const ts = opts?.ts ?? new Date().toISOString();
  const nowMs = Date.parse(ts) || Date.now();
  const insert = database.prepare(`
    INSERT INTO asset_samples(
      ts, asset_key, kind, lat, lon, alt_ft, gs_kt, track_deg,
      label, source, region, stale, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let written = 0;
  try {
    database.exec("BEGIN");
    for (const s of samples) {
      if (!inOsintTheater(s.lat, s.lon)) continue;
      if (!s.assetKey) continue;
      if (!shouldWriteAsset(s.assetKey, s.lat, s.lon, nowMs)) continue;
      insert.run(
        ts,
        s.assetKey,
        s.kind,
        s.lat,
        s.lon,
        s.altFt ?? null,
        s.gsKt ?? null,
        s.trackDeg ?? null,
        s.label ?? null,
        s.source ?? null,
        s.region ?? null,
        s.stale ? 1 : 0,
        s.payload != null ? JSON.stringify(s.payload) : null,
      );
      written += 1;
    }
    database.exec("COMMIT");
  } catch (err) {
    try {
      database.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    console.warn("[tradehole] osint archive asset write failed:", err);
    return 0;
  }

  if (written > 0) {
    markArchiveWrite(nowMs, opts?.reason ?? `assets_${written}`);
    pruneOsintArchive(new Date(nowMs));
  }
  return written;
}

export function recordZoneSamples(
  zones: ArchiveZoneInput[],
  opts?: { ts?: string; reason?: string },
): number {
  const database = getOsintArchiveDb();
  if (!database || zones.length === 0) return 0;

  const ts = opts?.ts ?? new Date().toISOString();
  const nowMs = Date.parse(ts) || Date.now();
  const insert = database.prepare(`
    INSERT INTO zone_samples(
      ts, zone_id, kind, label, status,
      lat_min, lat_max, lon_min, lon_max, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let written = 0;
  try {
    database.exec("BEGIN");
    for (const z of zones) {
      if (!shouldWriteZone(z.zoneId, z.status, nowMs)) continue;
      insert.run(
        ts,
        z.zoneId,
        z.kind,
        z.label ?? null,
        z.status,
        z.latMin,
        z.latMax,
        z.lonMin,
        z.lonMax,
        z.payload != null ? JSON.stringify(z.payload) : null,
      );
      written += 1;
    }
    database.exec("COMMIT");
  } catch (err) {
    try {
      database.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    console.warn("[tradehole] osint archive zone write failed:", err);
    return 0;
  }

  if (written > 0) {
    markArchiveWrite(nowMs, opts?.reason ?? `zones_${written}`);
    pruneOsintArchive(new Date(nowMs));
  }
  return written;
}

export function recordAerialPeak(
  peak: ArchiveAerialPeakInput,
  opts?: { ts?: string },
): boolean {
  const database = getOsintArchiveDb();
  if (!database) return false;
  // Always record counts (including 0) so the time series shows quiet stretches.
  const ts = opts?.ts ?? new Date().toISOString();
  const nowMs = Date.parse(ts) || Date.now();
  try {
    database
      .prepare(
        `INSERT INTO aerial_peaks(ts, tankers, awacs, other_mil, feed_status, source)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ts,
        peak.tankers,
        peak.awacs,
        peak.otherMil,
        peak.feedStatus ?? null,
        peak.source ?? null,
      );
    markArchiveWrite(nowMs, `peak_${peak.tankers}t_${peak.awacs}a`);
    pruneOsintArchive(new Date(nowMs));
    return true;
  } catch (err) {
    console.warn("[tradehole] osint archive peak write failed:", err);
    return false;
  }
}

/** Levant aerial tracks + last-good + peak row. */
export function archiveLevantAerial(args: {
  ts: string;
  tankers: number;
  awacs: number;
  otherMil: number;
  feedStatus: string;
  adsbSource?: string | null;
  tracks: Array<{
    hex: string;
    callsign: string;
    kind: string;
    acType: string;
    desc?: string;
    lat: number;
    lon: number;
    trackDeg: number | null;
    gsKt: number | null;
    altFt: number | null;
    source?: string;
    followed?: boolean;
    followRegion?: string;
  }>;
  lastGoodTracks?: Array<{
    hex: string;
    callsign: string;
    kind: string;
    acType: string;
    desc?: string;
    lat: number;
    lon: number;
    trackDeg: number | null;
    gsKt: number | null;
    altFt: number | null;
    source?: string;
    lastSeenAt?: string;
  }>;
}): void {
  const liveKeys = new Set(args.tracks.map((t) => t.hex).filter(Boolean));
  const assets: ArchiveAssetInput[] = [];

  for (const t of args.tracks) {
    if (!t.hex) continue;
    assets.push({
      assetKey: `hex:${t.hex}`,
      kind: t.kind,
      lat: t.lat,
      lon: t.lon,
      altFt: t.altFt,
      gsKt: t.gsKt,
      trackDeg: t.trackDeg,
      label: t.callsign || t.acType,
      source: t.source ?? args.adsbSource ?? "adsb",
      region: t.followed
        ? t.followRegion ?? "wider"
        : "levant",
      stale: false,
      payload: {
        acType: t.acType,
        desc: t.desc ?? null,
        theater: t.followed ? "follow" : "levant",
        followed: t.followed === true,
      },
    });
  }

  for (const t of args.lastGoodTracks ?? []) {
    if (!t.hex || liveKeys.has(t.hex)) continue;
    assets.push({
      assetKey: `hex:${t.hex}`,
      kind: t.kind,
      lat: t.lat,
      lon: t.lon,
      altFt: t.altFt,
      gsKt: t.gsKt,
      trackDeg: t.trackDeg,
      label: t.callsign || t.acType,
      source: t.source ?? args.adsbSource ?? "adsb",
      region: "levant",
      stale: true,
      payload: {
        acType: t.acType,
        desc: (t as { desc?: string }).desc ?? null,
        theater: "levant",
        lastSeenAt: t.lastSeenAt,
      },
    });
  }

  recordAssetSamples(assets, { ts: args.ts, reason: "levant_aerial" });
  recordAerialPeak(
    {
      tankers: args.tankers,
      awacs: args.awacs,
      otherMil: args.otherMil,
      feedStatus: args.feedStatus,
      source: args.adsbSource ?? "levant",
    },
    { ts: args.ts },
  );
}

/** Theater ADS-B samples (Gulf + wider). */
export function archiveTheaterAerial(args: {
  ts: string;
  samples: Array<{
    callsign: string;
    type: string;
    aircraftType: string;
    lat: number;
    lon: number;
    altitude: number;
    hex?: string;
    boxId?: string;
    region?: string;
    stale?: boolean;
  }>;
}): void {
  const assets: ArchiveAssetInput[] = [];
  for (const s of args.samples) {
    const hex = s.hex?.replace("~", "") || "";
    const key = hex
      ? `hex:${hex}`
      : `theater:${s.callsign}:${s.lat.toFixed(3)}:${s.lon.toFixed(3)}`;
    assets.push({
      assetKey: key,
      kind: s.type || "mil",
      lat: s.lat,
      lon: s.lon,
      altFt: s.altitude,
      label: s.callsign || s.aircraftType,
      source: "theater-adsb",
      region: s.region ?? null,
      stale: s.stale === true,
      payload: { acType: s.aircraftType, boxId: s.boxId },
    });
  }
  recordAssetSamples(assets, { ts: args.ts, reason: "theater_aerial" });
}

export function archiveE6bSamples(args: {
  ts: string;
  samples: Array<{
    callsign?: string;
    lat: number;
    lon: number;
    altitude?: number | null;
    hex?: string;
    stale?: boolean;
  }>;
}): void {
  const assets: ArchiveAssetInput[] = args.samples.map((s, i) => {
    const hex = s.hex?.replace("~", "") || "";
    return {
      assetKey: hex ? `hex:${hex}` : `e6b:${i}:${s.lat.toFixed(3)}:${s.lon.toFixed(3)}`,
      kind: "e6b",
      lat: s.lat,
      lon: s.lon,
      altFt: s.altitude ?? null,
      label: s.callsign || "E-6B",
      source: "e6b",
      region: "gulf",
      stale: s.stale === true,
    };
  });
  recordAssetSamples(assets, { ts: args.ts, reason: "e6b" });
}

export function archiveAisVessels(args: {
  ts: string;
  vessels: Array<{
    mmsi?: string | number | null;
    name?: string | null;
    lat: number;
    lon: number;
    sog?: number | null;
    cog?: number | null;
  }>;
}): void {
  const assets: ArchiveAssetInput[] = [];
  for (const v of args.vessels) {
    const mmsi = v.mmsi != null ? String(v.mmsi) : "";
    const key = mmsi
      ? `mmsi:${mmsi}`
      : `ais:${(v.name ?? "?").slice(0, 24)}:${v.lat.toFixed(3)}:${v.lon.toFixed(3)}`;
    assets.push({
      assetKey: key,
      kind: "ais",
      lat: v.lat,
      lon: v.lon,
      gsKt: v.sog ?? null,
      trackDeg: v.cog ?? null,
      label: v.name || mmsi || "AIS",
      source: "cyprus-ais",
      region: "levant",
      stale: false,
    });
  }
  recordAssetSamples(assets, { ts: args.ts, reason: "cyprus_ais" });
}

export function archiveFirmsPoints(args: {
  ts: string;
  points: Array<{
    id: string;
    lat: number;
    lon: number;
    box?: string;
    frp?: number | null;
    label?: string;
  }>;
}): void {
  const assets: ArchiveAssetInput[] = args.points.map((p) => ({
    assetKey: `firms:${p.id}`,
    kind: "firms",
    lat: p.lat,
    lon: p.lon,
    label: p.label || p.id,
    source: "firms",
    region: p.box ?? null,
    stale: false,
    payload: { frp: p.frp ?? null, box: p.box },
  }));
  recordAssetSamples(assets, { ts: args.ts, reason: "firms" });
}

export function archiveNavalStamps(args: {
  ts: string;
  stamps: Array<{
    id: string;
    kind: string;
    label: string;
    lat: number;
    lon: number;
    status?: string;
    region?: string;
    sogKt?: number | null;
    courseDeg?: number | null;
    stale?: boolean;
    meta?: string;
  }>;
}): void {
  const assets: ArchiveAssetInput[] = args.stamps.map((s) => ({
    assetKey: `stamp:${s.id}`,
    kind: s.kind,
    lat: s.lat,
    lon: s.lon,
    gsKt: s.sogKt ?? null,
    trackDeg: s.courseDeg ?? null,
    label: s.label,
    source: "ironsight",
    region: s.region ?? null,
    stale: s.stale === true,
    payload: { status: s.status, meta: s.meta },
  }));
  recordAssetSamples(assets, { ts: args.ts, reason: "naval_stamps" });
}

export function archiveMapZones(args: {
  ts: string;
  zones: ArchiveZoneInput[];
}): void {
  recordZoneSamples(args.zones, { ts: args.ts, reason: "map_zones" });
}
