/**
 * Confirmed-kinetic rewind for the whole Middle East.
 *
 * Classifies news for Israel/US/Iran strikes on NAMED bases, then queries
 * osint-theater.db for tankers/mil/AWACS within ~400 km of the pin in ±6h
 * (or last 24h if time unknown). Jordan-east corridor (lon>36, lat 30–33,
 * westbound into Israel) is a SOFT tell — never Israel High-go / AER-01.
 *
 * Confirmed strike ≠ ADS-B over target. Support = tankers/corridor in archive.
 */
import {
  JORDAN_EAST_CORRIDOR,
  findTargetById,
  listMideastTargets,
  matchNamedTargets,
  type MideastTarget,
} from "./mideastTargets";
import { queryAssetRange, type OsintArchiveSample } from "../osintArchive";
import {
  addKineticStamp,
  getKineticStamps,
  maybePersistAutoStamp,
  type KineticStamp,
} from "../kineticStamp";

export const KINETIC_HONESTY =
  "Confirmed strike ≠ ADS-B over target. Support = tankers/corridor in archive.";

export const REWIND_RADIUS_KM = 400;
export const REWIND_WINDOW_MS = 6 * 3600_000;
export const REWIND_UNKNOWN_MS = 24 * 3600_000;
export const REWIND_KINDS = ["tanker", "awacs", "mil", "e6b"] as const;

/** Completed-strike language on a named base (wires), not planning chatter. */
export const KINETIC_CONFIRMED_RE =
  /\b(struck|strikes?|airstrikes?|air[- ]strikes?|bombed|bombing|hit|hits|hitting|attacked|attacks|missile\s+strikes?|launched\s+(a\s+)?(strike|attack)|raided|raid\s+on|targeted|pounded)\b/i;

export const KINETIC_ACTOR_RE =
  /\b(Israel|Israeli|IDF|IAF|US|U\.S\.|United\s+States|American|CENTCOM|Iran|Iranian|IRGC)\b/i;

/** Planning / rumor — never auto-confirm. "reportedly struck" is attribution, not this. */
export const KINETIC_CONJECTURE_RE =
  /\b(considering|may\s+(strike|hit|attack)|poised\s+to|could\s+(hit|strike|attack)|preparing\s+to\s+(strike|hit|attack)|threatens?\s+to|rumou?red|reportedly\s+consider|plans?\s+to\s+(strike|hit|attack)|might\s+(strike|hit|attack)|warning\s+of(\s+a)?(\s+possible)?\s+strike|expected\s+to\s+strike)\b/i;

export type KineticNewsItem = {
  title: string;
  pubDate?: string | null;
  link?: string | null;
  source?: string | null;
};

export type KineticActor = "israel" | "us" | "iran" | "unknown";

export type KineticClassification = {
  title: string;
  pubDate: string | null;
  link: string | null;
  confirmed: boolean;
  conjecture: boolean;
  targets: MideastTarget[];
  actor: KineticActor | null;
};

export type KineticRewindHit = {
  assetKey: string;
  kind: string;
  label: string | null;
  lat: number;
  lon: number;
  ts: string;
  distKm: number;
  trackDeg: number | null;
  gsKt: number | null;
  altFt: number | null;
  corridorTell: boolean;
  source: string | null;
};

export type KineticRewindEvent = {
  target: MideastTarget;
  eventAt: string | null;
  timeKnown: boolean;
  headline: string | null;
  link: string | null;
  actor: KineticActor | null;
  source: "news" | "manual" | "query";
  confirmedByNews: boolean;
};

export type KineticRewindReport = {
  asOf: string;
  honesty: string;
  notHighGo: true;
  aer01Untouched: true;
  event: KineticRewindEvent | null;
  window: { from: string; to: string };
  hits: KineticRewindHit[];
  corridorTells: KineticRewindHit[];
  archiveOk: boolean;
  classified: KineticClassification[];
  stamps: KineticStamp[];
  targets: MideastTarget[];
  read: string;
};

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

function actorOf(title: string): KineticActor | null {
  if (/\b(Israel|Israeli|IDF|IAF)\b/i.test(title)) return "israel";
  if (/\b(US|U\.S\.|United\s+States|American|CENTCOM)\b/i.test(title)) return "us";
  if (/\b(Iran|Iranian|IRGC)\b/i.test(title)) return "iran";
  if (KINETIC_ACTOR_RE.test(title)) return "unknown";
  return null;
}

export function classifyKineticHeadline(item: KineticNewsItem): KineticClassification {
  const title = item.title ?? "";
  const targets = matchNamedTargets(title);
  const conjecture = KINETIC_CONJECTURE_RE.test(title);
  const strikeVerb = KINETIC_CONFIRMED_RE.test(title);
  const actor = actorOf(title);
  const confirmed =
    targets.length > 0 &&
    strikeVerb &&
    !conjecture &&
    (actor != null || /airbase|air\s*base|airfield|airport/i.test(title));
  return {
    title,
    pubDate: item.pubDate?.trim() ? item.pubDate.trim() : null,
    link: item.link?.trim() ? item.link.trim() : null,
    confirmed,
    conjecture,
    targets,
    actor: actor ?? (confirmed ? "unknown" : null),
  };
}

export function classifyKineticHeadlines(
  items: KineticNewsItem[],
): KineticClassification[] {
  return items.map(classifyKineticHeadline);
}

export function isJordanEastCorridor(sample: {
  lat: number;
  lon: number;
  trackDeg?: number | null;
}): boolean {
  if (sample.lat < JORDAN_EAST_CORRIDOR.latMin || sample.lat > JORDAN_EAST_CORRIDOR.latMax) {
    return false;
  }
  if (!(sample.lon > JORDAN_EAST_CORRIDOR.lonMin)) return false;
  if (sample.trackDeg == null || !Number.isFinite(sample.trackDeg)) return false;
  const h = ((sample.trackDeg % 360) + 360) % 360;
  // Westbound into Israel (SW–NW).
  return h >= 225 && h <= 315;
}

export function rewindWindow(
  eventAt: string | null | undefined,
  nowMs = Date.now(),
): { from: string; to: string; timeKnown: boolean } {
  const eventMs = eventAt ? Date.parse(eventAt) : NaN;
  if (Number.isFinite(eventMs)) {
    return {
      from: new Date(eventMs - REWIND_WINDOW_MS).toISOString(),
      to: new Date(eventMs + REWIND_WINDOW_MS).toISOString(),
      timeKnown: true,
    };
  }
  return {
    from: new Date(nowMs - REWIND_UNKNOWN_MS).toISOString(),
    to: new Date(nowMs).toISOString(),
    timeKnown: false,
  };
}

function kindOk(kind: string): boolean {
  const k = kind.toLowerCase();
  return (
    k === "tanker" ||
    k === "awacs" ||
    k === "mil" ||
    k === "e6b" ||
    k.includes("tanker") ||
    k.includes("awacs") ||
    k === "k35r" ||
    k === "kc135"
  );
}

/** ~radiusKm bounding box so rewind does not drown in Gulf mil samples (LIMIT 12k). */
export function rewindBbox(
  target: { lat: number; lon: number },
  radiusKm = REWIND_RADIUS_KM,
): { latMin: number; latMax: number; lonMin: number; lonMax: number } {
  const dLat = radiusKm / 111;
  const cos = Math.max(0.2, Math.cos((target.lat * Math.PI) / 180));
  const dLon = radiusKm / (111 * cos);
  return {
    latMin: target.lat - dLat,
    latMax: target.lat + dLat,
    lonMin: target.lon - dLon,
    lonMax: target.lon + dLon,
  };
}

/**
 * Filter archive samples to ≤ radiusKm of the pin, one closest row per hex,
 * sorted nearest-first. Corridor tell is annotated, never scored as High-go.
 */
export function rewindHitsNearTarget(
  samples: Array<
    Pick<
      OsintArchiveSample,
      "assetKey" | "kind" | "lat" | "lon" | "ts" | "trackDeg" | "gsKt" | "altFt" | "label" | "source"
    >
  >,
  target: { lat: number; lon: number },
  opts?: { radiusKm?: number },
): KineticRewindHit[] {
  const radius = opts?.radiusKm ?? REWIND_RADIUS_KM;
  const best = new Map<string, KineticRewindHit>();
  for (const s of samples) {
    if (!kindOk(s.kind)) continue;
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    const distKm = haversineKm(target.lat, target.lon, s.lat, s.lon);
    if (distKm > radius) continue;
    const hit: KineticRewindHit = {
      assetKey: s.assetKey,
      kind: s.kind,
      label: s.label,
      lat: s.lat,
      lon: s.lon,
      ts: s.ts,
      distKm: Math.round(distKm * 10) / 10,
      trackDeg: s.trackDeg,
      gsKt: s.gsKt,
      altFt: s.altFt,
      corridorTell: isJordanEastCorridor({
        lat: s.lat,
        lon: s.lon,
        trackDeg: s.trackDeg,
      }),
      source: s.source,
    };
    const prev = best.get(s.assetKey);
    if (!prev || hit.distKm < prev.distKm) best.set(s.assetKey, hit);
  }
  return [...best.values()].sort((a, b) => a.distKm - b.distKm || a.ts.localeCompare(b.ts));
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function fetchGoogleNewsRss(
  query: string,
  limit = 8,
): Promise<KineticNewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { "User-Agent": "Tradehole/0.2" },
  });
  if (!res.ok) throw new Error(`RSS HTTP ${res.status}`);
  const xml = await res.text();
  const items: KineticNewsItem[] = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  for (const block of blocks.slice(0, limit)) {
    const title =
      block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ??
      block.match(/<title>(.*?)<\/title>/)?.[1] ??
      "";
    const link =
      block.match(/<link>(.*?)<\/link>/)?.[1]?.trim() ??
      block.match(/<link><!\[CDATA\[(.*?)\]\]><\/link>/)?.[1]?.trim() ??
      "";
    const pubDate =
      block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() ?? "";
    if (title) items.push({ title: decodeXml(title), link, pubDate, source: "google-news" });
  }
  return items;
}

const NEWS_QUERIES = [
  '(Israel OR IDF OR IAF) (strike OR struck OR airstrike OR hit OR bombed) (airbase OR airfield OR Syria OR Tiyas OR "Abu al-Duhur" OR "Abu Duhur" OR Shayrat OR Idlib)',
  '("Abu al-Duhur" OR "Abu Duhur" OR "Abu Dhuhur" OR "Idlib air") (Israel OR Israeli OR IDF OR IAF OR strike OR airstrike OR hit)',
  '(US OR CENTCOM) (airstrike OR struck OR strike) (Iraq OR Syria OR Yemen OR "Ain al-Asad" OR Balad)',
  '(Iran OR IRGC) (missile OR strike OR attack) (Israel OR airbase OR Udeid OR Dhafra OR Natanz)',
];

let newsCache: { atMs: number; items: KineticNewsItem[] } | null = null;
const NEWS_TTL_MS = 90_000;

async function fetchKineticNews(force = false): Promise<KineticNewsItem[]> {
  if (!force && newsCache && Date.now() - newsCache.atMs < NEWS_TTL_MS) {
    return newsCache.items;
  }
  const bags = await Promise.allSettled(
    NEWS_QUERIES.map((q) => fetchGoogleNewsRss(q, 8)),
  );
  const seen = new Set<string>();
  const items: KineticNewsItem[] = [];
  for (const bag of bags) {
    if (bag.status !== "fulfilled") continue;
    for (const it of bag.value) {
      const key = it.title.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      items.push(it);
    }
  }
  items.sort((a, b) => {
    const ta = a.pubDate ? Date.parse(a.pubDate) : 0;
    const tb = b.pubDate ? Date.parse(b.pubDate) : 0;
    return tb - ta;
  });
  newsCache = { atMs: Date.now(), items };
  return items;
}

function newestConfirmed(
  classified: KineticClassification[],
): KineticClassification | null {
  const hits = classified.filter((c) => c.confirmed && c.targets.length > 0);
  if (!hits.length) return null;
  hits.sort((a, b) => {
    const ta = a.pubDate ? Date.parse(a.pubDate) : 0;
    const tb = b.pubDate ? Date.parse(b.pubDate) : 0;
    return tb - ta;
  });
  return hits[0] ?? null;
}

function buildRead(args: {
  event: KineticRewindEvent | null;
  hits: KineticRewindHit[];
  corridor: KineticRewindHit[];
  timeKnown: boolean;
}): string {
  if (!args.event) {
    return "No confirmed named-base strike in wires or stamps. Quiet rewind — not High-go.";
  }
  const closest = args.hits[0];
  const closestBit = closest
    ? `closest ${closest.kind} ${closest.assetKey.replace(/^hex:/, "").slice(0, 8)} at ${closest.distKm} km`
    : "no archive hexes within 400 km";
  const corridorBit = args.corridor.length
    ? ` · ${args.corridor.length} Jordan-east corridor SOFT tell(s)`
    : "";
  const timeBit = args.timeKnown ? "" : " · event time unknown (last 24h archive)";
  const pinBit = args.event.confirmedByNews
    ? `Confirmed ${args.event.target.label}`
    : `Rewind pin ${args.event.target.label} (no wire confirm)`;
  return `${pinBit} · ${closestBit}${corridorBit}${timeBit}. Not AER-01 High-go.`;
}

export async function buildKineticRewind(opts?: {
  target?: string;
  eventAt?: string;
  force?: boolean;
}): Promise<KineticRewindReport> {
  const asOf = new Date().toISOString();
  let news: KineticNewsItem[] = [];
  try {
    news = await fetchKineticNews(opts?.force === true);
  } catch (err) {
    console.warn("[tradehole] kinetic rewind news failed:", err);
  }
  const classified = classifyKineticHeadlines(news);
  const auto = newestConfirmed(classified);

  if (auto?.targets[0] && auto.confirmed) {
    const eventMs = auto.pubDate ? Date.parse(auto.pubDate) : Date.now();
    const eventAt = Number.isFinite(eventMs)
      ? new Date(eventMs).toISOString()
      : asOf;
    try {
      maybePersistAutoStamp({
        targetId: auto.targets[0].id,
        eventAt,
        headline: auto.title,
        link: auto.link,
      });
    } catch (err) {
      console.warn("[tradehole] kinetic auto-stamp failed:", err);
    }
  }

  const stamps = getKineticStamps().stamps;
  const queryTarget = findTargetById(opts?.target ?? null);
  const stampForQuery = queryTarget
    ? stamps.find((s) => s.targetId === queryTarget.id)
    : stamps[0];
  const target =
    queryTarget ??
    auto?.targets[0] ??
    findTargetById(stampForQuery?.targetId ?? null);

  let event: KineticRewindEvent | null = null;
  if (target) {
    const fromNews = auto?.targets.some((t) => t.id === target.id) ? auto : null;
    const fromStamp = stamps.find((s) => s.targetId === target.id) ?? null;
    const eventAtRaw =
      opts?.eventAt ??
      fromNews?.pubDate ??
      fromStamp?.eventAt ??
      null;
    const eventMs = eventAtRaw ? Date.parse(eventAtRaw) : NaN;
    const eventAt = Number.isFinite(eventMs)
      ? new Date(eventMs).toISOString()
      : null;
    const source: KineticRewindEvent["source"] = opts?.target
      ? "query"
      : fromNews
        ? "news"
        : "manual";
    event = {
      target,
      eventAt,
      timeKnown: eventAt != null,
      headline: fromNews?.title ?? fromStamp?.headline ?? null,
      link: fromNews?.link ?? fromStamp?.link ?? null,
      actor: fromNews?.actor ?? null,
      source,
      confirmedByNews: Boolean(fromNews || fromStamp?.confirmedByNews),
    };
  }

  const win = rewindWindow(event?.eventAt, Date.parse(asOf));
  let archiveOk = true;
  let hits: KineticRewindHit[] = [];
  if (event) {
    try {
      const bbox = rewindBbox(event.target, REWIND_RADIUS_KM);
      const tankers = queryAssetRange({
        from: win.from,
        to: win.to,
        kinds: ["tanker", "awacs", "e6b"],
        limit: 8_000,
        bbox,
      });
      const mil = queryAssetRange({
        from: win.from,
        to: win.to,
        kinds: ["mil"],
        limit: 4_000,
        bbox,
      });
      hits = rewindHitsNearTarget([...tankers, ...mil], event.target).slice(0, 24);
    } catch (err) {
      archiveOk = false;
      console.warn("[tradehole] kinetic rewind archive failed:", err);
    }
  }

  const corridorTells = hits.filter((h) => h.corridorTell);
  const read = buildRead({
    event,
    hits,
    corridor: corridorTells,
    timeKnown: win.timeKnown,
  });

  return {
    asOf,
    honesty: KINETIC_HONESTY,
    notHighGo: true,
    aer01Untouched: true,
    event,
    window: { from: win.from, to: win.to },
    hits,
    corridorTells,
    archiveOk,
    classified: classified.slice(0, 16),
    stamps,
    targets: listMideastTargets(),
    read,
  };
}

export function stampKineticRewind(input: {
  targetId: string;
  eventAt: string;
  headline?: string;
  note?: string;
  link?: string | null;
}): KineticStamp {
  const store = addKineticStamp({
    ...input,
    source: "manual",
    note: input.note?.trim() ? input.note : "confirmed by news",
  });
  return store.stamps[0]!;
}
