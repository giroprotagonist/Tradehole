import { getStockQuote, type StockQuote } from "./market";
import { preferCmeThenYahoo } from "./cmeQuotes";
import { singleFlight } from "./singleFlight";
import { readLastGood, writeLastGood } from "./lastGoodStore";

export type BrentPhysical = {
  /** Europe Brent Spot FOB (EIA) — closest free official series; NOT Platts Dated Brent */
  eiaEuropeBrentSpot: {
    price: number | null;
    asOf: string | null;
    source: string;
    note: string;
  };
  /** ICE Brent front-month futures via Yahoo */
  brentFutures: StockQuote | null;
  /** Spot minus futures (positive = spot premium / backwardation signal on this proxy) */
  spotMinusFutures: number | null;
  wtiFutures: StockQuote | null;
};

export type VlccRelatedRoute = {
  code: string;
  label: string;
  worldscale: number | null;
  tceUsdPerDay: number | null;
  excerpt: string | null;
};

export type VlccPeriodCharter = {
  oneYearUsdPerDay: number | null;
  threeYearUsdPerDay: number | null;
  excerpt: string | null;
  note: string;
};

export type FreightDeepLink = { label: string; href: string; note?: string };

export type VlccTd3c = {
  worldscale: number | null;
  tceUsdPerDay: number | null;
  asOfLabel: string | null;
  /** ISO date (YYYY-MM-DD) when parseable from reprint */
  asOfIso: string | null;
  lagHours: number | null;
  lagDays: number | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  excerpt: string | null;
  route: string;
  note: string;
  relatedRoutes: VlccRelatedRoute[];
  periodCharter: VlccPeriodCharter | null;
  deepLinks: FreightDeepLink[];
  discoveryMethod: string | null;
  candidatesTried: number;
  honestyGaps: string[];
};

export type PhysicalMarkets = {
  brent: BrentPhysical;
  vlccTd3c: VlccTd3c;
  fetchedAt: string;
  caveats: string[];
  /** True when serving last-good after a timed-out / failed refresh. */
  fromCache?: boolean;
  stale?: boolean;
  error?: string | null;
};

/** Last successful physical snapshot — survives scrape timeouts so the panel never blanks forever. */
let lastGoodPhysical: PhysicalMarkets | null = null;
let lastGoodPhysicalAt = 0;
let physicalHydrated = false;

function hydratePhysicalLastGood(): void {
  if (physicalHydrated) return;
  physicalHydrated = true;
  if (lastGoodPhysical) return;
  const disk = readLastGood<PhysicalMarkets>("physical");
  if (!disk) return;
  lastGoodPhysical = disk.value;
  lastGoodPhysicalAt = disk.at;
}

export function getLastGoodPhysicalMarkets(): PhysicalMarkets | null {
  hydratePhysicalLastGood();
  return lastGoodPhysical;
}

/** Overall budget for a live refresh (snapshot settle is ~14s; stay under that). */
const PHYSICAL_OVERALL_MS = 11_000;
const PHYSICAL_FRESH_TTL_MS = 45_000;
const FETCH_SEED_MS = 6_000;
const FETCH_PROBE_MS = 2_500;

const EIA_BRENT_CSV =
  "https://raw.githubusercontent.com/datasets/oil-prices/main/data/brent-daily.csv";
const FRED_BRENT_CSV =
  "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILBRENTEU";

function parseFredLastPrice(csv: string): { price: number; asOf: string } | null {
  const lines = csv
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (/^observation_date|^DATE/i.test(line)) continue;
    const [date, priceRaw] = line.split(",");
    if (!date || !priceRaw || priceRaw === "." || priceRaw === "") continue;
    const price = Number(priceRaw);
    if (date && Number.isFinite(price)) return { price, asOf: date };
  }
  return null;
}

/** Seed Edge Malaysia Baltic weekly reprints (newest first). Discovery also probes forward. */
const EDGE_BALTIC_SEEDS = [
  "https://theedgemalaysia.com/node/816221", // Aug 28, 2026 — TD3C WS623 · ~$647k/d
  "https://theedgemalaysia.com/node/813986", // Aug 7, 2026 — TD3C WS475.56
  "https://theedgemalaysia.com/node/812893", // July 31, 2026 — TD3C WS424.33
];

/**
 * Forward probe start — keep at latest known Baltic Edge node with TD3C.
 * Edge node IDs advance ~100/day site-wide; weekly Baltic reprints jump ~700–1200 ids.
 * Dense +48 alone misses multi-week gaps (e.g. 813986 → 816221).
 */
const EDGE_LATEST_SEED_NODE = 816221;

/** Hellenic reprints / broker weeklies that often carry TD3C before Edge seeds rotate. */
const HELLENIC_TD3C_SEEDS = [
  // Sep 6, 2026 pub — Thursday WS677.22 / ~$704k (fresher than Aug 28 Edge).
  "https://www.hellenicshippingnews.com/tankers-vlcc-market-trending-higher/",
  "https://www.hellenicshippingnews.com/tanker-shipping-vlccs-keep-returning-major-profits/",
  "https://www.hellenicshippingnews.com/tankers-vlccs-moving-higher/", // ~Aug 10, 2026 · WS475.56
];

/** Business Times Baltic Insights pages (numeric suffix). */
const BT_BALTIC_SEEDS = [
  "https://www.businesstimes.com.sg/international/baltic-exchange-shipping-insights84", // Aug 28
  "https://www.businesstimes.com.sg/international/baltic-exchange-shipping-insights83",
  "https://www.businesstimes.com.sg/international/baltic-exchange-shipping-insights81",
];

export const FREIGHT_DEEP_LINKS: FreightDeepLink[] = [
  {
    label: "Tankers International Fixture App (BASIC)",
    href: "https://app.tankersinternational.com/",
    note: "Live VLCC fixture board — deep link only; do NOT scrape (ToS).",
  },
  {
    label: "Fearnleys research",
    href: "https://fearnleys.com/research/",
    note: "Broker weekly tanker/dry reports — open manually.",
  },
  {
    label: "Fearnleys home",
    href: "https://fearnleys.com/",
  },
  {
    label: "Baltic Exchange (official)",
    href: "https://www.balticexchange.com/",
    note: "Paid Market Data / bot-gated weekly tanker pages — deep link only.",
  },
  {
    label: "The Edge Malaysia · Baltic shipping updates",
    href: "https://theedgemalaysia.com/node/816221",
    note: "Public weekly Baltic reprint (seed; discovery may find newer).",
  },
  {
    label: "Business Times · Baltic Exchange Shipping Insights",
    href: "https://www.businesstimes.com.sg/international/baltic-exchange-shipping-insights84",
  },
  {
    label: "Hellenic Shipping News · TD3C search",
    href: "https://www.hellenicshippingnews.com/?s=TD3C",
  },
  {
    label: "TradeWinds · Tankers",
    href: "https://www.tradewindsnews.com/tankers",
  },
  {
    label: "Lloyd's List · Tankers",
    href: "https://www.lloydslist.com/sector/tankers",
  },
  {
    label: "EIA Europe Brent Spot (RBRTE)",
    href: "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=RBRTE&f=D",
  },
  {
    label: "StockQ BDTI proxy",
    href: "https://en.stockq.org/index/BDTI.php",
  },
  {
    label: "Frontline plc IR",
    href: "https://www.frontline.bm/",
    note: "Fleet TCE / realized earnings — check latest filings; not auto-ingested.",
  },
  {
    label: "Google News · TD3C Baltic VLCC",
    href: "https://news.google.com/search?q=TD3C+Baltic+VLCC+WS&hl=en-US&gl=US&ceid=US:en",
  },
];

async function fetchText(
  url: string,
  timeoutMs: number = FETCH_SEED_MS,
): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Tradehole/0.1 (personal research dashboard; physical-market monitor)",
      Accept: "text/html,application/xhtml+xml,text/csv,application/rss+xml,*/*",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function parseLastCsvPrice(csv: string): { price: number; asOf: string } | null {
  const lines = csv
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (/^date,/i.test(line)) continue;
    const [date, priceRaw] = line.split(",");
    const price = Number(priceRaw);
    if (date && Number.isFinite(price)) return { price, asOf: date };
  }
  return null;
}

function extractNextDataText(html: string): string {
  const m = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!m?.[1]) return "";
  try {
    // Article body often lives only in Next.js JSON on Edge Malaysia.
    return m[1]
      .replace(/\\u003c/gi, "<")
      .replace(/\\u003e/gi, ">")
      .replace(/\\u0026/gi, "&")
      .replace(/\\n/g, " ")
      .replace(/\\"/g, '"');
  } catch {
    return m[1];
  }
}

function stripHtml(html: string): string {
  // Preserve __NEXT_DATA__ before script strip — Edge SSR may omit visible body.
  const nextData = extractNextDataText(html);
  return `${html} ${nextData}`
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function toIsoDate(y: number, m: number, d: number): string | null {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function previousWeekdayIso(anchorIso: string, weekdayName: string): string | null {
  const want = WEEKDAYS[weekdayName.toLowerCase()];
  if (want == null) return null;
  const anchor = Date.parse(`${anchorIso.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(anchor)) return null;
  const d = new Date(anchor);
  const delta = (d.getUTCDay() - want + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() - delta);
  return toIsoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function parseAsOfFromText(
  text: string,
  titleHint?: string | null,
  pubDateIso?: string | null,
): { label: string; iso: string | null } {
  // Prefer the TD3C neighborhood (Thursday assessments often sit deep in long weeklies).
  const td3cAt = text.search(/TD3C/i);
  const td3cWindow =
    td3cAt >= 0 ? text.slice(Math.max(0, td3cAt - 80), td3cAt + 700) : "";
  const hay = `${titleHint ?? ""} ${td3cWindow} ${text}`.slice(0, 12_000);
  const patterns: RegExp[] = [
    /Baltic Exchange shipping updates:\s*([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/i,
    /A weekly round-up of tanker and dry bulk market\s*\(([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\)/i,
    /\(([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\)/,
    /as of\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/i,
    /([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/,
  ];
  for (const re of patterns) {
    const m = hay.match(re);
    if (!m) continue;
    const month = MONTHS[m[1]!.toLowerCase()];
    if (!month) continue;
    const day = Number(m[2]);
    const year = Number(m[3]);
    const iso = toIsoDate(year, month, day);
    return {
      label: `${m[1]} ${day}, ${year}`,
      iso,
    };
  }
  // Hellenic weeklies: "to WS … on Thursday" relative to RSS/article pub date.
  // Prefer this over bare ISO stamps elsewhere in the page (often the publish day).
  const weekdayM =
    td3cWindow.match(
      /\bon\s+(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/i,
    ) ??
    hay.match(
      /\bon\s+(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/i,
    );
  if (weekdayM && pubDateIso) {
    const iso = previousWeekdayIso(pubDateIso, weekdayM[1]!);
    if (iso) {
      return {
        label: `${weekdayM[1]} assessment · week of ${pubDateIso.slice(0, 10)}`,
        iso,
      };
    }
  }

  // Hellenic (and some mirrors) stamp ISO dates without month names.
  const isoM = hay.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoM) {
    const year = Number(isoM[1]);
    const month = Number(isoM[2]);
    const day = Number(isoM[3]);
    const iso = toIsoDate(year, month, day);
    if (iso) {
      return { label: iso, iso };
    }
  }

  if (pubDateIso && /^\d{4}-\d{2}-\d{2}/.test(pubDateIso)) {
    return {
      label: `article ${pubDateIso.slice(0, 10)}`,
      iso: pubDateIso.slice(0, 10),
    };
  }
  return { label: "from latest public Baltic reprint", iso: null };
}

function parseMoney(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Exported for unit tests — prefer latest "to WS X" assessment over prior Friday WS. */
export function parseTd3c(text: string): {
  worldscale: number | null;
  tceUsdPerDay: number | null;
  excerpt: string | null;
} {
  // Hellenic: "rising from WS631.67 last Friday to WS677.22 on Thursday"
  const toWs = text.match(
    /TD3C[\s\S]{0,420}?\bto\s+WS\s*([0-9]+(?:\.[0-9]+)?)/i,
  );
  const legacy = text.match(
    /TD3C[\s\S]{0,280}?WS\s*([0-9]+(?:\.[0-9]+)?)[\s\S]{0,220}?TCE[\s\S]{0,80}?(?:US)?\$\s*([0-9,]+)/i,
  );
  const wsOnly = text.match(/TD3C[\s\S]{0,280}?WS\s*([0-9]+(?:\.[0-9]+)?)/i);
  const tceM =
    text.match(
      /TD3C[\s\S]{0,520}?TCE[\s\S]{0,80}?(?:just under|about|over|nearly|of)?\s*(?:US)?\$\s*([0-9,]+)/i,
    ) ??
    text.match(
      /TD3C[\s\S]{0,520}?(?:just under|about|over|nearly)\s+(?:US)?\$\s*([0-9,]+)/i,
    );

  const worldscale = Number(toWs?.[1] ?? legacy?.[1] ?? wsOnly?.[1]);
  const tceUsdPerDay = parseMoney(tceM?.[1] ?? legacy?.[2]);
  if (!Number.isFinite(worldscale)) {
    return { worldscale: null, tceUsdPerDay: null, excerpt: null };
  }
  const excerpt = (toWs?.[0] ?? legacy?.[0] ?? wsOnly?.[0] ?? "")
    .replace(/\s+/g, " ")
    .slice(0, 320);
  return {
    worldscale,
    tceUsdPerDay,
    excerpt: excerpt || null,
  };
}

export function parseRelatedRoutes(text: string): VlccRelatedRoute[] {
  const defs: Array<{ code: string; label: string; re: RegExp }> = [
    {
      code: "TD34",
      label: "Gulf of Oman → China",
      re: /TD34[\s\S]{0,220}?(?:at\s+)?WS\s*([0-9]+(?:\.[0-9]+)?)[\s\S]{0,180}?(?:US)?\$\s*([0-9,]+)?/i,
    },
    {
      code: "TD15",
      label: "West Africa → China (260k mt)",
      re: /TD15[\s\S]{0,220}?(?:to\s+)?WS\s*([0-9]+(?:\.[0-9]+)?)[\s\S]{0,180}?(?:US)?\$\s*([0-9,]+)?/i,
    },
    {
      code: "TD22",
      label: "US Gulf → China",
      re: /TD22[\s\S]{0,220}?daily round trip TCE of over (?:US)?\$\s*([0-9,]+)|TD22[\s\S]{0,200}?WS\s*([0-9]+(?:\.[0-9]+)?)/i,
    },
  ];
  const out: VlccRelatedRoute[] = [];
  for (const d of defs) {
    const m = text.match(d.re);
    if (!m) continue;
    if (d.code === "TD22") {
      const tce = parseMoney(m[1]);
      const ws = m[2] ? Number(m[2]) : null;
      out.push({
        code: d.code,
        label: d.label,
        worldscale: ws != null && Number.isFinite(ws) ? ws : null,
        tceUsdPerDay: tce,
        excerpt: m[0].replace(/\s+/g, " ").slice(0, 220),
      });
      continue;
    }
    const ws = m[1] ? Number(m[1]) : null;
    const tce = parseMoney(m[2]);
    out.push({
      code: d.code,
      label: d.label,
      worldscale: ws != null && Number.isFinite(ws) ? ws : null,
      tceUsdPerDay: tce,
      excerpt: m[0].replace(/\s+/g, " ").slice(0, 220),
    });
  }
  return out;
}

function lagFromIso(iso: string | null): {
  lagHours: number | null;
  lagDays: number | null;
} {
  if (!iso) return { lagHours: null, lagDays: null };
  const t = Date.parse(`${iso}T12:00:00Z`);
  if (!Number.isFinite(t)) return { lagHours: null, lagDays: null };
  const ms = Date.now() - t;
  const lagHours = Math.max(0, Math.round(ms / 3_600_000));
  const lagDays = Math.max(0, Math.round(ms / 86_400_000));
  return { lagHours, lagDays };
}

function parsePeriodCharter(text: string): VlccPeriodCharter | null {
  const one =
    text.match(
      /one[- ]year(?:\s+term)?[^.]{0,80}?(?:US)?\$\s*([0-9,]+)\s*(?:\/\s*day|per day|\/day)/i,
    ) ??
    text.match(
      /(?:US)?\$\s*([0-9,]+)\s*(?:\/\s*day|per day).*?one[- ]year/i,
    );
  const three =
    text.match(
      /three[- ]year(?:\s+period)?[^.]{0,80}?(?:US)?\$\s*([0-9,]+)\s*(?:\/\s*day|per day|\/day)/i,
    ) ??
    text.match(
      /(?:US)?\$\s*([0-9,]+)\s*(?:\/\s*day|per day).*?three[- ]year/i,
    );

  // Prefer the VLCC-ish chunk near "one-year term … three-year period"
  const pair = text.match(
    /one-year term[^.]{0,40}(?:US)?\$\s*([0-9,]+)[^.]{0,120}?three-year period[^.]{0,40}(?:US)?\$\s*([0-9,]+)/i,
  );

  const oneYearUsdPerDay = pair
    ? parseMoney(pair[1])
    : one
      ? parseMoney(one[1])
      : null;
  const threeYearUsdPerDay = pair
    ? parseMoney(pair[2])
    : three
      ? parseMoney(three[1])
      : null;

  if (oneYearUsdPerDay == null && threeYearUsdPerDay == null) return null;

  const excerpt = (
    pair?.[0] ??
    [one?.[0], three?.[0]].filter(Boolean).join(" · ") ??
    ""
  ).slice(0, 280) || null;

  return {
    oneYearUsdPerDay,
    threeYearUsdPerDay,
    excerpt,
    note:
      "Baltic period assessments from the same weekly reprint — not Frontline realized fleet TCE.",
  };
}

type CandidateHit = {
  worldscale: number;
  tceUsdPerDay: number | null;
  asOfLabel: string;
  asOfIso: string | null;
  sourceUrl: string;
  sourceTitle: string;
  excerpt: string | null;
  relatedRoutes: VlccRelatedRoute[];
  periodCharter: VlccPeriodCharter | null;
  discoveryMethod: string;
};

function parseReprintHtml(
  html: string,
  url: string,
  method: string,
  titleHint?: string | null,
  pubDateIso?: string | null,
): CandidateHit | null {
  const text = stripHtml(html);
  const parsed = parseTd3c(text);
  if (parsed.worldscale == null) return null;
  const metaPub =
    html.match(
      /property=["']article:published_time["'][^>]*content=["']([^"']+)/i,
    )?.[1] ??
    html.match(
      /content=["']([^"']+)["'][^>]*property=["']article:published_time["']/i,
    )?.[1] ??
    html.match(/datetime=["'](\d{4}-\d{2}-\d{2})/i)?.[1] ??
    null;
  const resolvedPub =
    pubDateIso ??
    (metaPub && Number.isFinite(Date.parse(metaPub))
      ? new Date(Date.parse(metaPub)).toISOString().slice(0, 10)
      : null);
  const asOf = parseAsOfFromText(text, titleHint, resolvedPub);
  const titleMatch =
    html.match(/<title>([^<]+)/i)?.[1]?.replace(/\s+/g, " ").trim() ??
    titleHint ??
    "Baltic Exchange shipping update (public reprint)";
  return {
    worldscale: parsed.worldscale,
    tceUsdPerDay: parsed.tceUsdPerDay,
    asOfLabel: asOf.label,
    asOfIso: asOf.iso,
    sourceUrl: url,
    sourceTitle: titleMatch.slice(0, 180),
    excerpt: parsed.excerpt,
    relatedRoutes: parseRelatedRoutes(text),
    periodCharter: parsePeriodCharter(text),
    discoveryMethod: method,
  };
}

function rssItemLinks(
  rss: string,
): Array<{ title: string; link: string; pubDateIso: string | null }> {
  const items = rss.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  const out: Array<{ title: string; link: string; pubDateIso: string | null }> =
    [];
  for (const item of items.slice(0, 12)) {
    const title =
      item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i)?.[1] ??
      item.match(/<title>(.*?)<\/title>/i)?.[1] ??
      "";
    const link =
      item.match(/<link><!\[CDATA\[(.*?)\]\]><\/link>/i)?.[1] ??
      item.match(/<link>(.*?)<\/link>/i)?.[1] ??
      "";
    const pubRaw =
      item.match(/<pubDate>(.*?)<\/pubDate>/i)?.[1]?.trim() ?? "";
    let pubDateIso: string | null = null;
    if (pubRaw) {
      const t = Date.parse(pubRaw);
      if (Number.isFinite(t)) pubDateIso = new Date(t).toISOString().slice(0, 10);
    }
    const cleanLink = link.trim();
    if (!cleanLink || cleanLink.includes("news.google.com")) continue;
    out.push({
      title: title.replace(/<[^>]+>/g, "").trim(),
      link: cleanLink,
      pubDateIso,
    });
  }
  return out;
}

function edgeNodeFromUrl(url: string): number | null {
  const m = url.match(/theedgemalaysia\.com\/node\/(\d+)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

async function probeEdgeNodes(
  nodes: number[],
  deadlineMs: number,
  started: number,
): Promise<string[]> {
  const found: string[] = [];
  const batch = 10;
  for (let i = 0; i < nodes.length; i += batch) {
    if (Date.now() - started >= deadlineMs) break;
    const slice = nodes.slice(i, i + batch);
    const results = await Promise.all(
      slice.map(async (n) => {
        const url = `https://theedgemalaysia.com/node/${n}`;
        try {
          const html = await fetchText(url, FETCH_PROBE_MS);
          // Match title/NEXT_DATA even when body is client-rendered.
          if (/Baltic Exchange shipping/i.test(html) && /TD3C/i.test(html)) {
            return url;
          }
        } catch {
          /* skip */
        }
        return null;
      }),
    );
    for (const u of results) {
      if (u) found.push(u);
    }
  }
  return found;
}

async function discoverEdgeNodeUrls(deadlineMs: number): Promise<string[]> {
  const urls = new Set<string>(EDGE_BALTIC_SEEDS);
  const started = Date.now();
  // Near-term dense window for same/next week.
  const dense: number[] = [];
  for (let n = EDGE_LATEST_SEED_NODE + 1; n <= EDGE_LATEST_SEED_NODE + 36; n += 1) {
    dense.push(n);
  }
  // Coarse ladder covers multi-week seed lag (~700–1200 node ids / week).
  const coarseOffsets = [80, 160, 320, 640, 1000, 1500, 2000, 2600, 3200];
  const coarse = coarseOffsets.map((o) => EDGE_LATEST_SEED_NODE + o);

  const nearHits = await probeEdgeNodes(dense, deadlineMs, started);
  for (const u of nearHits) urls.add(u);

  let bestHit = EDGE_LATEST_SEED_NODE;
  for (const u of nearHits) {
    const n = edgeNodeFromUrl(u);
    if (n != null && n > bestHit) bestHit = n;
  }

  if (Date.now() - started < deadlineMs && nearHits.length === 0) {
    const farHits = await probeEdgeNodes(coarse, deadlineMs, started);
    for (const u of farHits) {
      urls.add(u);
      const n = edgeNodeFromUrl(u);
      if (n != null && n > bestHit) bestHit = n;
    }
    // Refine around the farthest Baltic hit so we don't stop on an old reprint.
    if (bestHit > EDGE_LATEST_SEED_NODE && Date.now() - started < deadlineMs) {
      const refine: number[] = [];
      for (let n = bestHit + 1; n <= bestHit + 48; n += 1) refine.push(n);
      for (let n = bestHit - 24; n < bestHit; n += 1) {
        if (n > EDGE_LATEST_SEED_NODE) refine.push(n);
      }
      const refined = await probeEdgeNodes(refine, deadlineMs, started);
      for (const u of refined) urls.add(u);
    }
  }

  return [...urls];
}

async function discoverHellenicUrls(): Promise<
  Array<{ url: string; title: string; pubDateIso: string | null }>
> {
  try {
    const rss = await fetchText(
      "https://www.hellenicshippingnews.com/search/TD3C/feed/rss2/",
    );
    return rssItemLinks(rss).map((x) => ({
      url: x.link,
      title: x.title,
      pubDateIso: x.pubDateIso,
    }));
  } catch {
    return [];
  }
}

function pickFreshest(hits: CandidateHit[]): CandidateHit | null {
  if (!hits.length) return null;
  const scored = hits.map((h) => ({
    h,
    score: h.asOfIso ? Date.parse(`${h.asOfIso}T12:00:00Z`) : 0,
  }));
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.h.worldscale - a.h.worldscale ||
      // Prefer Hellenic/broker weeklies over older Edge seeds when dates tie/missing.
      Number(b.h.discoveryMethod.includes("hellenic")) -
        Number(a.h.discoveryMethod.includes("hellenic")),
  );
  return scored[0]!.h;
}

async function tryUrls(
  queue: Array<{
    url: string;
    method: string;
    title?: string;
    pubDateIso?: string | null;
  }>,
  opts?: { timeoutMs?: number; stopWhenFreshDays?: number },
): Promise<{ hits: CandidateHit[]; candidatesTried: number }> {
  const hits: CandidateHit[] = [];
  let candidatesTried = 0;
  const seen = new Set<string>();
  const timeoutMs = opts?.timeoutMs ?? FETCH_SEED_MS;
  const stopWhenFreshDays = opts?.stopWhenFreshDays ?? 8;
  for (const q of queue) {
    if (seen.has(q.url)) continue;
    seen.add(q.url);
    candidatesTried += 1;
    try {
      const html = await fetchText(q.url, timeoutMs);
      const hit = parseReprintHtml(
        html,
        q.url,
        q.method,
        q.title,
        q.pubDateIso ?? null,
      );
      if (hit) {
        hits.push(hit);
        const lag = lagFromIso(hit.asOfIso);
        if (lag.lagDays != null && lag.lagDays < stopWhenFreshDays) {
          break;
        }
      }
    } catch {
      /* try next */
    }
  }
  return { hits, candidatesTried };
}

async function fetchVlccTd3c(): Promise<VlccTd3c> {
  const honestyGaps = [
    "Official Baltic TD3C real-time assessments require Baltic Exchange Data Services — not free.",
    "Tankers International Fixture App is deep-linked only — scraping violates ToS; paste fixtures manually if needed.",
    "Frontline realized fleet TCE is not auto-ingested — check Frontline IR / filings; Baltic standard VLCC TCE ≠ FRO earnings.",
    "Period charter prints (1y/3y) are Baltic assessments from the weekly reprint when present — not fixture boards.",
  ];

  const base: VlccTd3c = {
    worldscale: null,
    tceUsdPerDay: null,
    asOfLabel: null,
    asOfIso: null,
    lagHours: null,
    lagDays: null,
    sourceUrl: null,
    sourceTitle: null,
    excerpt: null,
    route: "TD3C — 270k mt Middle East Gulf → China (VLCC)",
    note:
      "Parsed from public Baltic Exchange weekly shipping reprints (Edge Malaysia / Hellenic / BT) — not the paid Baltic Market Data API. Usually multi-day lag vs broker fixtures.",
    relatedRoutes: [],
    periodCharter: null,
    deepLinks: FREIGHT_DEEP_LINKS,
    discoveryMethod: null,
    candidatesTried: 0,
    honestyGaps,
  };

  const hellenic = await discoverHellenicUrls();
  // Prefer Hellenic RSS / seeds first — Edge Aug 28 reprints can win pickFreshest
  // when Hellenic as-of was null (relative "Thursday" with no calendar date).
  const primaryQueue: Array<{
    url: string;
    method: string;
    title?: string;
    pubDateIso?: string | null;
  }> = [
    ...hellenic.map((h) => ({
      url: h.url,
      method: "hellenic-rss",
      title: h.title,
      pubDateIso: h.pubDateIso,
    })),
    ...HELLENIC_TD3C_SEEDS.map((url) => ({
      url,
      method: "hellenic-seed",
      pubDateIso: null as string | null,
    })),
    ...BT_BALTIC_SEEDS.map((url) => ({ url, method: "business-times" })),
    ...EDGE_BALTIC_SEEDS.map((url) => ({ url, method: "edge-malaysia-seed" })),
  ];

  let { hits, candidatesTried } = await tryUrls(primaryQueue, {
    timeoutMs: FETCH_SEED_MS,
    stopWhenFreshDays: 5,
  });
  let best = pickFreshest(hits);
  const lagProbe = lagFromIso(best?.asOfIso ?? null);
  const needsProbe =
    !best || lagProbe.lagDays == null || lagProbe.lagDays >= 8;

  if (needsProbe) {
    // Keep Edge probe inside remaining budget so snapshot settle never hangs forever.
    const edgeUrls = await discoverEdgeNodeUrls(4_500).catch(() => []);
    const extra = edgeUrls
      .filter((u) => !EDGE_BALTIC_SEEDS.includes(u))
      .map((url) => ({ url, method: "edge-malaysia-probe" }));
    if (extra.length) {
      const probed = await tryUrls(extra, {
        timeoutMs: FETCH_PROBE_MS,
        stopWhenFreshDays: 8,
      });
      hits = [...hits, ...probed.hits];
      candidatesTried += probed.candidatesTried;
      best = pickFreshest(hits);
    }
  }

  if (best) {
    const lag = lagFromIso(best.asOfIso);
    const deepLinks = FREIGHT_DEEP_LINKS.map((l) =>
      l.label.startsWith("The Edge Malaysia") &&
      best.sourceUrl.includes("theedgemalaysia")
        ? { ...l, href: best.sourceUrl }
        : l,
    );
    return {
      ...base,
      worldscale: best.worldscale,
      tceUsdPerDay: best.tceUsdPerDay,
      asOfLabel: best.asOfLabel,
      asOfIso: best.asOfIso,
      lagHours: lag.lagHours,
      lagDays: lag.lagDays,
      sourceUrl: best.sourceUrl,
      sourceTitle: best.sourceTitle,
      excerpt: best.excerpt,
      relatedRoutes: best.relatedRoutes,
      periodCharter: best.periodCharter,
      deepLinks,
      discoveryMethod: best.discoveryMethod,
      candidatesTried,
      note:
        base.note +
        (lag.lagDays != null
          ? ` Reprint as-of lag ≈ ${lag.lagDays}d (~${lag.lagHours}h).`
          : ""),
    };
  }

  // Google News RSS fallback — titles only
  try {
    const rss = await fetchText(
      "https://news.google.com/rss/search?q=TD3C+VLCC+Baltic+WS&hl=en-US&gl=US&ceid=US:en",
    );
    const item = rss.match(/<item>[\s\S]*?<\/item>/);
    const title =
      item?.[0]?.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ??
      item?.[0]?.match(/<title>(.*?)<\/title>/)?.[1] ??
      null;
    return {
      ...base,
      sourceTitle: title,
      candidatesTried,
      note:
        base.note +
        " Could not parse a numeric WS print from known reprint URLs; showing latest related headline instead.",
    };
  } catch {
    return { ...base, candidatesTried };
  }
}

async function fetchBrentPhysical(): Promise<BrentPhysical> {
  const [brentCsv, fredCsv, brentFutures, wtiFutures] = await Promise.all([
    fetchText(EIA_BRENT_CSV).catch(() => null),
    fetchText(FRED_BRENT_CSV, FETCH_SEED_MS).catch(() => null),
    getStockQuote("BZ=F").catch(() => null),
    preferCmeThenYahoo("CL", "CL=F", () => getStockQuote("CL=F")).catch(
      () => null,
    ),
  ]);

  const fromDatasets = brentCsv ? parseLastCsvPrice(brentCsv) : null;
  const fromFred = fredCsv ? parseFredLastPrice(fredCsv) : null;
  const spot =
    fromDatasets && fromFred
      ? fromDatasets.asOf >= fromFred.asOf
        ? fromDatasets
        : fromFred
      : (fromDatasets ?? fromFred);

  const spotMinusFutures =
    spot?.price != null && brentFutures?.price != null
      ? spot.price - brentFutures.price
      : null;

  const spotSource =
    spot && fromFred && spot.asOf === fromFred.asOf && fromDatasets?.asOf !== spot.asOf
      ? "EIA Europe Brent Spot via FRED DCOILBRENTEU"
      : "EIA via datasets/oil-prices (Europe Brent Spot FOB)";

  return {
    eiaEuropeBrentSpot: {
      price: spot?.price ?? null,
      asOf: spot?.asOf ?? null,
      source: spotSource,
      note:
        "Official daily Europe Brent Spot FOB (EIA). Not Platts Dated Brent. Series often lags 3–5 calendar days after weekends/holidays — that lag is inherent, not a Tradehole cache bug. Use BZ=F for intra-day paper.",
    },
    brentFutures,
    spotMinusFutures,
    wtiFutures,
  };
}

function storeLastGoodPhysical(value: PhysicalMarkets): PhysicalMarkets {
  const live: PhysicalMarkets = {
    ...value,
    fromCache: false,
    stale: false,
    error: null,
  };
  lastGoodPhysical = live;
  lastGoodPhysicalAt = Date.now();
  writeLastGood("physical", live, lastGoodPhysicalAt);
  return live;
}

async function scrapePhysicalLive(): Promise<PhysicalMarkets> {
  const [brent, vlccTd3c] = await Promise.all([
    fetchBrentPhysical(),
    fetchVlccTd3c(),
  ]);
  return storeLastGoodPhysical({
    brent,
    vlccTd3c,
    fetchedAt: new Date().toISOString(),
    caveats: [
      "True Platts Dated Brent requires a Platts/ICE license — not available free.",
      "Official Baltic TD3C real-time assessments require Baltic Exchange Data Services — not available free.",
      "Tradehole uses EIA Europe Brent Spot + ICE Brent futures (Yahoo) + parsed public Baltic weekly reprints for TD3C.",
      "Physical VLCC fixtures and Dated Brent often lead paper markets; treat futures as the lagging indicator when physical prints diverge.",
      "TI Fixture App / Fearnleys / TradeWinds are deep links for bleeding-edge fixtures — not scraped.",
    ],
    fromCache: false,
    stale: false,
    error: null,
  });
}

function serveStalePhysical(rebuilding: boolean): PhysicalMarkets {
  const cached = lastGoodPhysical!;
  const ageMs = Date.now() - lastGoodPhysicalAt;
  return {
    ...cached,
    fromCache: true,
    stale: true,
    error: rebuilding
      ? `Serving last-good physical while live refresh runs (last live ${cached.fetchedAt}).`
      : `Live physical refresh timed out after ${PHYSICAL_OVERALL_MS}ms — showing last-good.`,
    caveats: [
      ...cached.caveats,
      `Stale cache served (${Math.round(ageMs / 1000)}s old; last live ${cached.fetchedAt}).`,
    ],
  };
}

export async function getPhysicalMarkets(opts?: {
  force?: boolean;
}): Promise<PhysicalMarkets> {
  hydratePhysicalLastGood();
  const force = opts?.force === true;
  const ageMs = lastGoodPhysical ? Date.now() - lastGoodPhysicalAt : 0;
  const fresh =
    Boolean(lastGoodPhysical) && ageMs <= PHYSICAL_FRESH_TTL_MS && !force;
  // Don't treat a just-fetched Aug 28 weekly as "fresh" when lag ≥5d — await live.
  const cachedLagDays = lastGoodPhysical?.vlccTd3c?.lagDays ?? null;
  const cachedPrintStale =
    Boolean(lastGoodPhysical?.vlccTd3c?.worldscale) &&
    (cachedLagDays == null || cachedLagDays >= 5);

  if (fresh && lastGoodPhysical && !cachedPrintStale) {
    return {
      ...lastGoodPhysical,
      fromCache: false,
      stale: false,
      error: null,
    };
  }

  if (!force && lastGoodPhysical && !cachedPrintStale) {
    void singleFlight("physical-live", scrapePhysicalLive).catch(() => undefined);
    return serveStalePhysical(true);
  }

  const work = singleFlight("physical-live", scrapePhysicalLive);
  void work.catch(() => undefined);

  const awaitLive = force || cachedPrintStale || !lastGoodPhysical;
  if (!awaitLive) {
    return emptyPhysicalShell(
      "Rebuilding physical — no last-good yet (first paint after launch).",
    );
  }

  type Race =
    | { kind: "ok"; value: PhysicalMarkets }
    | { kind: "timeout" };

  const raced: Race = await Promise.race([
    work.then((value) => ({ kind: "ok" as const, value })),
    new Promise<Race>((resolve) => {
      setTimeout(() => resolve({ kind: "timeout" }), PHYSICAL_OVERALL_MS);
    }),
  ]);

  if (raced.kind === "ok") {
    return {
      ...raced.value,
      fromCache: false,
      stale: false,
      error: null,
    };
  }

  if (lastGoodPhysical) return serveStalePhysical(true);

  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(`physical timed out after ${PHYSICAL_OVERALL_MS}ms`),
            ),
          1_500,
        );
      }),
    ]);
  } catch (err) {
    return emptyPhysicalShell(String(err));
  }
}

function emptyPhysicalShell(error: string): PhysicalMarkets {
  return {
    brent: {
      eiaEuropeBrentSpot: {
        price: null,
        asOf: null,
        source: "EIA via datasets/oil-prices (Europe Brent Spot FOB)",
        note: "Unavailable this cycle.",
      },
      brentFutures: null,
      spotMinusFutures: null,
      wtiFutures: null,
    },
    vlccTd3c: {
      worldscale: null,
      tceUsdPerDay: null,
      asOfLabel: null,
      asOfIso: null,
      lagHours: null,
      lagDays: null,
      sourceUrl: null,
      sourceTitle: null,
      excerpt: null,
      route: "TD3C — 270k mt Middle East Gulf → China (VLCC)",
      note: "Physical scrape timed out before a Baltic reprint could be parsed.",
      relatedRoutes: [],
      periodCharter: null,
      deepLinks: FREIGHT_DEEP_LINKS,
      discoveryMethod: null,
      candidatesTried: 0,
      honestyGaps: [
        "Official Baltic TD3C real-time assessments require Baltic Exchange Data Services — not free.",
      ],
    },
    fetchedAt: new Date().toISOString(),
    caveats: [
      "Physical refresh timed out — empty shell so the UI can clear Loading. Retry shortly.",
    ],
    fromCache: true,
    stale: true,
    error,
  };
}
