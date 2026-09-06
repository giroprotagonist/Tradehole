/**
 * NASA FIRMS VIIRS 24h regional CSVs — no MAP_KEY required.
 * Used when IRONSIGHT /api/fires has counts but no lat/lon.
 * Cache ~12 min; never blocks the desk on a cold miss.
 */

export type NasaFirmsPoint = {
  id: string;
  lat: number;
  lon: number;
  box: "hormuz" | "bab" | "israel" | "gaza" | "golan" | "other";
  frp: number | null;
  acqDate: string | null;
  label: string;
};

const CACHE_MS = 12 * 60 * 1000;
const FETCH_TIMEOUT_MS = 14_000;
const MAX_POINTS = 48;

const REGIONS = [
  "Europe",
  "South_Asia",
  "Russia_Asia",
  "Northern_and_Central_Africa",
] as const;

const BASE =
  "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv";

type Cache = { at: number; points: NasaFirmsPoint[]; note: string };
let cache: Cache | null = null;
let inflight: Promise<Cache> | null = null;

function classifyBox(
  lat: number,
  lon: number,
): NasaFirmsPoint["box"] {
  if (lat >= 24 && lat <= 28.5 && lon >= 55 && lon <= 58.5) return "hormuz";
  if (lat >= 11 && lat <= 15 && lon >= 41 && lon <= 45) return "bab";
  // Gaza Strip (tighter than Israel box — check first)
  if (lat >= 31.2 && lat <= 31.65 && lon >= 34.2 && lon <= 34.58) return "gaza";
  // Golan Heights
  if (lat >= 32.7 && lat <= 33.45 && lon >= 35.55 && lon <= 35.98) return "golan";
  if (lat >= 29.5 && lat <= 34.5 && lon >= 34 && lon <= 36.5) return "israel";
  return "other";
}

function inTheater(lat: number, lon: number): boolean {
  return lat >= -5 && lat <= 45 && lon >= 10 && lon <= 80;
}

function parseCsv(text: string, region: string): NasaFirmsPoint[] {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = (lines[0] ?? "").split(",").map((h) => h.trim().toLowerCase());
  const latI = header.findIndex((h) => h === "latitude" || h === "lat");
  const lonI = header.findIndex((h) => h === "longitude" || h === "lon");
  const frpI = header.findIndex((h) => h === "frp");
  const dateI = header.findIndex((h) => h === "acq_date");
  if (latI < 0 || lonI < 0) return [];
  const out: NasaFirmsPoint[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split(",");
    const lat = Number(cols[latI]);
    const lon = Number(cols[lonI]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!inTheater(lat, lon)) continue;
    const box = classifyBox(lat, lon);
    const frpRaw = frpI >= 0 ? Number(cols[frpI]) : NaN;
    const acqDate = dateI >= 0 ? (cols[dateI] ?? "").trim() || null : null;
    out.push({
      id: `nasa-${region}-${lat.toFixed(3)}-${lon.toFixed(3)}`,
      lat,
      lon,
      box,
      frp: Number.isFinite(frpRaw) ? frpRaw : null,
      acqDate,
      label: `FIRMS ${box}${Number.isFinite(frpRaw) ? ` · FRP ${frpRaw.toFixed(1)}` : ""}`,
    });
  }
  return out;
}

async function fetchRegion(region: string): Promise<NasaFirmsPoint[]> {
  const url = `${BASE}/J1_VIIRS_C2_${region}_24h.csv`;
  const res = await fetch(url, {
    headers: { Accept: "text/csv,text/plain,*/*", "User-Agent": "Tradehole/0.2 (firms)" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return [];
  const text = await res.text();
  return parseCsv(text, region);
}

function pickPoints(all: NasaFirmsPoint[]): NasaFirmsPoint[] {
  const hot = all.filter((p) => p.box !== "other");
  const other = all.filter((p) => p.box === "other");
  return [...hot, ...other].slice(0, MAX_POINTS);
}

async function loadNasa(): Promise<Cache> {
  const batches = await Promise.all(
    REGIONS.map((r) => fetchRegion(r).catch(() => [] as NasaFirmsPoint[])),
  );
  const seen = new Set<string>();
  const merged: NasaFirmsPoint[] = [];
  for (const list of batches) {
    for (const p of list) {
      const key = `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(p);
    }
  }
  const points = pickPoints(merged);
  const hormuz = merged.filter((p) => p.box === "hormuz").length;
  const bab = merged.filter((p) => p.box === "bab").length;
  const israel = merged.filter((p) => p.box === "israel").length;
  const gaza = merged.filter((p) => p.box === "gaza").length;
  const golan = merged.filter((p) => p.box === "golan").length;
  const note =
    merged.length === 0
      ? "FIRMS NASA: no theater detections"
      : `FIRMS NASA VIIRS 24h: ${points.length} mapped · Hormuz ${hormuz} · Bab ${bab} · Israel ${israel} · Gaza ${gaza} · Golan ${golan}`;
  return { at: Date.now(), points, note };
}

/** Cached NASA FIRMS points in the Med–Gulf–Horn theater. */
export async function fetchNasaFirmsTheater(): Promise<{
  points: NasaFirmsPoint[];
  note: string;
}> {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return { points: cache.points, note: cache.note };
  }
  if (!inflight) {
    inflight = loadNasa()
      .then((next) => {
        cache = next;
        inflight = null;
        return next;
      })
      .catch((err) => {
        inflight = null;
        if (cache) return cache;
        return {
          at: Date.now(),
          points: [] as NasaFirmsPoint[],
          note: `FIRMS NASA: fetch failed (${String(err).slice(0, 80)})`,
        };
      });
  }
  const snap = await inflight;
  return { points: snap.points, note: snap.note };
}
