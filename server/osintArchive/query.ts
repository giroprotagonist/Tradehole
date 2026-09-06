import { getOsintArchiveDb, OSINT_THEATER_BBOX } from "./db";

export type OsintArchiveSample = {
  ts: string;
  assetKey: string;
  kind: string;
  lat: number;
  lon: number;
  altFt: number | null;
  gsKt: number | null;
  trackDeg: number | null;
  label: string | null;
  source: string | null;
  region: string | null;
  stale: boolean;
  payload: unknown | null;
};

export type OsintArchiveZone = {
  ts: string;
  zoneId: string;
  kind: string;
  label: string | null;
  status: string;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  payload: unknown | null;
};

export type OsintArchivePeak = {
  ts: string;
  tankers: number;
  awacs: number;
  otherMil: number;
  feedStatus: string | null;
  source: string | null;
};

function parsePayload(raw: string | null): unknown | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Samples in [from, to] inclusive. Optionally filter kinds (comma / array). */
export function queryAssetRange(opts: {
  from: string;
  to: string;
  kinds?: string[];
  limit?: number;
  bbox?: {
    latMin: number;
    latMax: number;
    lonMin: number;
    lonMax: number;
  };
}): OsintArchiveSample[] {
  const database = getOsintArchiveDb();
  if (!database) return [];

  const limit = Math.min(Math.max(opts.limit ?? 8_000, 1), 25_000);
  const kinds = (opts.kinds ?? []).map((k) => k.trim()).filter(Boolean);

  let sql = `
    SELECT ts, asset_key, kind, lat, lon, alt_ft, gs_kt, track_deg,
           label, source, region, stale, payload_json
    FROM asset_samples
    WHERE ts >= ? AND ts <= ?
  `;
  const params: Array<string | number> = [opts.from, opts.to];
  if (kinds.length > 0) {
    sql += ` AND kind IN (${kinds.map(() => "?").join(",")})`;
    params.push(...kinds);
  }
  if (opts.bbox) {
    sql += ` AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`;
    params.push(
      opts.bbox.latMin,
      opts.bbox.latMax,
      opts.bbox.lonMin,
      opts.bbox.lonMax,
    );
  }
  sql += ` ORDER BY ts ASC LIMIT ?`;
  params.push(limit);

  try {
    const rows = database.prepare(sql).all(...params) as Array<{
      ts: string;
      asset_key: string;
      kind: string;
      lat: number;
      lon: number;
      alt_ft: number | null;
      gs_kt: number | null;
      track_deg: number | null;
      label: string | null;
      source: string | null;
      region: string | null;
      stale: number;
      payload_json: string | null;
    }>;
    return rows.map((r) => ({
      ts: r.ts,
      assetKey: r.asset_key,
      kind: r.kind,
      lat: r.lat,
      lon: r.lon,
      altFt: r.alt_ft,
      gsKt: r.gs_kt,
      trackDeg: r.track_deg,
      label: r.label,
      source: r.source,
      region: r.region,
      stale: r.stale === 1,
      payload: parsePayload(r.payload_json),
    }));
  } catch (err) {
    console.warn("[tradehole] osint archive range query failed:", err);
    return [];
  }
}

/**
 * Latest sample per asset_key within the window — for map playback frames.
 * Prefer the row closest to `at` (default: window end).
 */
export function queryPlaybackFrame(opts: {
  at: string;
  windowMs?: number;
  kinds?: string[];
  limit?: number;
}): {
  at: string;
  from: string;
  to: string;
  samples: OsintArchiveSample[];
  zones: OsintArchiveZone[];
} {
  const atMs = Date.parse(opts.at) || Date.now();
  const windowMs = opts.windowMs ?? 5 * 60_000;
  const from = new Date(atMs - windowMs).toISOString();
  const to = new Date(atMs + Math.min(windowMs, 60_000)).toISOString();
  const atIso = new Date(atMs).toISOString();

  const all = queryAssetRange({
    from,
    to,
    kinds: opts.kinds,
    limit: opts.limit ?? 12_000,
  });

  // Keep sample closest to `at` per asset_key.
  const best = new Map<string, OsintArchiveSample>();
  for (const s of all) {
    const prev = best.get(s.assetKey);
    if (!prev) {
      best.set(s.assetKey, s);
      continue;
    }
    const dPrev = Math.abs(Date.parse(prev.ts) - atMs);
    const dCur = Math.abs(Date.parse(s.ts) - atMs);
    if (dCur <= dPrev) best.set(s.assetKey, s);
  }

  const zones = queryZoneFrame({ at: atIso, windowMs });
  return {
    at: atIso,
    from,
    to,
    samples: [...best.values()],
    zones,
  };
}

export function queryZoneFrame(opts: {
  at: string;
  windowMs?: number;
}): OsintArchiveZone[] {
  const database = getOsintArchiveDb();
  if (!database) return [];

  const atMs = Date.parse(opts.at) || Date.now();
  const windowMs = opts.windowMs ?? 30 * 60_000;
  const from = new Date(atMs - windowMs).toISOString();
  const to = new Date(atMs).toISOString();

  try {
    const rows = database
      .prepare(
        `
      SELECT ts, zone_id, kind, label, status,
             lat_min, lat_max, lon_min, lon_max, payload_json
      FROM zone_samples
      WHERE ts >= ? AND ts <= ?
      ORDER BY ts ASC
      LIMIT 4000
    `,
      )
      .all(from, to) as Array<{
      ts: string;
      zone_id: string;
      kind: string;
      label: string | null;
      status: string;
      lat_min: number;
      lat_max: number;
      lon_min: number;
      lon_max: number;
      payload_json: string | null;
    }>;

    const best = new Map<string, OsintArchiveZone>();
    for (const r of rows) {
      best.set(r.zone_id, {
        ts: r.ts,
        zoneId: r.zone_id,
        kind: r.kind,
        label: r.label,
        status: r.status,
        latMin: r.lat_min,
        latMax: r.lat_max,
        lonMin: r.lon_min,
        lonMax: r.lon_max,
        payload: parsePayload(r.payload_json),
      });
    }
    return [...best.values()];
  } catch {
    return [];
  }
}

export function queryAerialPeaks(opts: {
  from: string;
  to: string;
  limit?: number;
}): OsintArchivePeak[] {
  const database = getOsintArchiveDb();
  if (!database) return [];
  const limit = Math.min(Math.max(opts.limit ?? 2_000, 1), 10_000);
  try {
    const rows = database
      .prepare(
        `
      SELECT ts, tankers, awacs, other_mil, feed_status, source
      FROM aerial_peaks
      WHERE ts >= ? AND ts <= ?
      ORDER BY ts ASC
      LIMIT ?
    `,
      )
      .all(opts.from, opts.to, limit) as Array<{
      ts: string;
      tankers: number;
      awacs: number;
      other_mil: number;
      feed_status: string | null;
      source: string | null;
    }>;
    return rows.map((r) => ({
      ts: r.ts,
      tankers: r.tankers,
      awacs: r.awacs,
      otherMil: r.other_mil,
      feedStatus: r.feed_status,
      source: r.source,
    }));
  } catch (err) {
    console.warn("[tradehole] osint archive peaks query failed:", err);
    return [];
  }
}

/** Max tanker/awacs peak for a calendar day (UTC) or since process — for UI hydrate. */
export function queryDayAerialPeak(dayIso?: string): {
  tankers: number;
  awacs: number;
  at: string;
} | null {
  const database = getOsintArchiveDb();
  if (!database) return null;
  const day =
    dayIso ??
    new Date().toISOString().slice(0, 10);
  const from = `${day}T00:00:00.000Z`;
  const to = `${day}T23:59:59.999Z`;
  try {
    const row = database
      .prepare(
        `
      SELECT ts, tankers, awacs
      FROM aerial_peaks
      WHERE ts >= ? AND ts <= ?
        AND (tankers > 0 OR awacs > 0)
      ORDER BY tankers DESC, awacs DESC, ts DESC
      LIMIT 1
    `,
      )
      .get(from, to) as
      | { ts: string; tankers: number; awacs: number }
      | undefined;
    if (!row) return null;
    return { tankers: row.tankers, awacs: row.awacs, at: row.ts };
  } catch {
    return null;
  }
}

/** Trail polyline for one asset over a window. */
export function queryAssetTrail(opts: {
  assetKey: string;
  from: string;
  to: string;
  limit?: number;
}): Array<{ lat: number; lon: number; at: string }> {
  const database = getOsintArchiveDb();
  if (!database) return [];
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1_000);
  try {
    const rows = database
      .prepare(
        `
      SELECT ts, lat, lon
      FROM asset_samples
      WHERE asset_key = ? AND ts >= ? AND ts <= ?
      ORDER BY ts ASC
      LIMIT ?
    `,
      )
      .all(opts.assetKey, opts.from, opts.to, limit) as Array<{
      ts: string;
      lat: number;
      lon: number;
    }>;
    return rows.map((r) => ({ lat: r.lat, lon: r.lon, at: r.ts }));
  } catch {
    return [];
  }
}

export function archiveBounds() {
  return { ...OSINT_THEATER_BBOX };
}
