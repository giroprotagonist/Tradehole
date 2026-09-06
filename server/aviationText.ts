/**
 * Free aviation / NOTAM-adjacent text for AER-02 + Gulf radio_hole.
 *
 * Sources (ToS-clean, no scrape bypass):
 * - Google News RSS keyword queries (existing pattern)
 * - EUROCONTROL public RSS (https://www.eurocontrol.int/rss.xml)
 * - aviationweather.gov international SIGMETs (JSON) — weather/airspace
 *   advisories, NOT official NOTAM polygons; honesty label required
 *
 * FIR map boxes stay heuristic approximations from titles.
 */

export type AviationNewsItem = {
  title: string;
  link: string;
  pubDate: string;
  source?: string;
};

const UA = "Tradehole/0.2 (aviation-text)";
const EUROCONTROL_RSS = "https://www.eurocontrol.int/rss.xml";
const AWC_ISIGMET = "https://aviationweather.gov/api/data/isigmet?format=json";

const EUROCONTROL_KEEP_RE =
  /NOTAM|TFR|airspace|restriction|reroute|holding|closed|Nicosia|Cyprus|Israel|Tel\s*Aviv|LLBG|FIR|network\s+disruption|crisis|conflict|Middle\s+East|Eastern\s+Med|Mediterranean|ATC|capacity/i;

/** Soft ME / Levant / Gulf FIR / geo filter for AWC international SIGMETs. */
const AWC_ME_RE =
  /\b(LLBB|LCCC|ORBB|OEJD|OIIX|OBBB|OKAC|OJAC|HECC|LGGG|LTBB|OMAE|OMSR|OLBB|OSDI|ORMM|ORER|OBBI|OTBD|OERK|OEJN|OOMS|Iran|Iraq|Israel|Cyprus|Nicosia|Bahrain|Hormuz|Persian|Baghdad|Jordan|Lebanon|Egypt|Saudi|Qatar|Oman|Kuwait|Turkey|Istanbul|Tel\s*Aviv|Eastern\s+Med)\b/i;

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRssItems(xml: string, limit: number): AviationNewsItem[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  const out: AviationNewsItem[] = [];
  for (const chunk of blocks.slice(0, limit * 2)) {
    if (out.length >= limit) break;
    const titleM = chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const linkM = chunk.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const dateM =
      chunk.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) ||
      chunk.match(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i);
    const title = decodeXml(titleM?.[1] ?? "");
    if (!title) continue;
    out.push({
      title,
      link: decodeXml(linkM?.[1] ?? "").trim(),
      pubDate: decodeXml(dateM?.[1] ?? "").trim(),
    });
  }
  return out;
}

/** EUROCONTROL public news RSS — filter to airspace/network crisis language. */
export async function fetchEurocontrolAviationRss(
  limit = 10,
): Promise<AviationNewsItem[]> {
  try {
    const res = await fetch(EUROCONTROL_RSS, {
      headers: { Accept: "application/rss+xml, application/xml, text/xml", "User-Agent": UA },
      signal: AbortSignal.timeout(14_000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRssItems(xml, 40)
      .filter((i) => EUROCONTROL_KEEP_RE.test(i.title))
      .slice(0, limit)
      .map((i) => ({ ...i, source: "eurocontrol-rss" }));
  } catch {
    return [];
  }
}

type AwcIsigmet = {
  icaoId?: string;
  firId?: string;
  firName?: string;
  hazard?: string;
  rawSigmet?: string;
  receiptTime?: string;
  validTimeFrom?: number;
  coords?: Array<{ lat?: number; lon?: number }>;
};

/**
 * AWC international SIGMETs overlapping ME/Levant/Gulf keywords.
 * Soft aviation text only — not NOTAM geometry; UI must say approximate.
 */
export async function fetchAwcMeSigmetItems(
  limit = 12,
): Promise<AviationNewsItem[]> {
  try {
    const res = await fetch(AWC_ISIGMET, {
      headers: { Accept: "application/json", "User-Agent": UA },
      signal: AbortSignal.timeout(14_000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as AwcIsigmet[];
    if (!Array.isArray(json)) return [];
    const out: AviationNewsItem[] = [];
    for (const row of json) {
      const fir = `${row.firId ?? ""} ${row.firName ?? ""}`;
      const raw = String(row.rawSigmet ?? "").slice(0, 280);
      const hazard = String(row.hazard ?? "").trim();
      const blob = `${fir} ${raw} ${row.icaoId ?? ""} ${hazard}`;
      if (!AWC_ME_RE.test(blob)) continue;
      const title = [
        "SIGMET",
        row.firId || row.icaoId || "ME",
        hazard || undefined,
        raw || fir.trim(),
      ]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 220);
      const pub =
        row.receiptTime ||
        (row.validTimeFrom != null
          ? new Date(row.validTimeFrom * 1000).toISOString()
          : new Date().toISOString());
      out.push({
        title,
        link: "https://aviationweather.gov/data/isigmet/",
        pubDate: pub,
        source: "awc-isigmet",
      });
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** Extra free Google News queries beyond the core Med/Gulf NOTAM set. */
export const EXTRA_NOTAM_RSS_QUERIES_LEVANT = [
  'SIGMET OR "airspace warning" OR "closed airspace" (Cyprus OR Israel OR "Eastern Med" OR Nicosia OR LLBG)',
  '("notice to airmen" OR "temp flight restriction" OR "prohibited area") (Israel OR Cyprus OR Lebanon OR Syria)',
] as const;

export const EXTRA_NOTAM_RSS_QUERIES_GULF = [
  'SIGMET OR "closed airspace" OR "flight prohibition" (Bahrain OR "Persian Gulf" OR Hormuz OR Iraq OR Baghdad OR ORBB)',
  '("notice to airmen" OR "airspace restriction") (Qatar OR "Fifth Fleet" OR "Arabian Gulf" OR Kuwait)',
] as const;

/** Extra free NAVWARN / NAVCEN-adjacent keyword RSS (no authenticated scrape). */
export const EXTRA_NAVWARN_RSS_QUERIES = [
  'UKMTO OR HYDROPAC OR HYDROLANT OR "NAVAREA IX" OR "NAVAREA 9" (Hormuz OR "Persian Gulf" OR Arabia OR Bahrain)',
  '("dangerous operations" OR "gunfire" OR "live fire" OR "missile exercise") (NAVWARN OR NAVAREA OR advisory) (Gulf OR Hormuz OR Kharg)',
  '"maritime security" OR "navigation restricted" OR "exclusion zone" (CENTCOM OR "Fifth Fleet" OR "Northern Gulf" OR Bandar)',
] as const;

export function mergeAviationNews(
  batches: AviationNewsItem[][],
  limit: number,
): AviationNewsItem[] {
  const seen = new Set<string>();
  const out: AviationNewsItem[] = [];
  for (const batch of batches) {
    for (const i of batch) {
      const k = i.title.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(i);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
