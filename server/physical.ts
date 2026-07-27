import { getStockQuote, type StockQuote } from "./market";

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

export type VlccTd3c = {
  worldscale: number | null;
  tceUsdPerDay: number | null;
  asOfLabel: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  excerpt: string | null;
  route: string;
  note: string;
};

export type PhysicalMarkets = {
  brent: BrentPhysical;
  vlccTd3c: VlccTd3c;
  fetchedAt: string;
  caveats: string[];
};

const EIA_BRENT_CSV =
  "https://raw.githubusercontent.com/datasets/oil-prices/main/data/brent-daily.csv";

const BALTIC_SOURCES = [
  "https://theedgemalaysia.com/node/811993",
  "https://www.businesstimes.com.sg/international/baltic-exchange-shipping-insights78",
];

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Tradehole/0.1 (personal research dashboard; physical-market monitor)",
      Accept: "text/html,application/xhtml+xml,text/csv,*/*",
    },
    signal: AbortSignal.timeout(12_000),
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

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function parseTd3c(text: string): {
  worldscale: number | null;
  tceUsdPerDay: number | null;
  excerpt: string | null;
} {
  // e.g. "TD3C route ... at WS386.78, which corresponds to a daily round-trip TCE at US$382,397"
  const patterns = [
    /TD3C[^.]{0,220}?WS\s*([0-9]+(?:\.[0-9]+)?)[^.]{0,160}?TCE[^US$]{0,40}US\$\s*([0-9,]+)/i,
    /TD3C[^.]{0,220}?WS\s*([0-9]+(?:\.[0-9]+)?)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const worldscale = Number(m[1]);
    const tceUsdPerDay = m[2] ? Number(m[2].replace(/,/g, "")) : null;
    return {
      worldscale: Number.isFinite(worldscale) ? worldscale : null,
      tceUsdPerDay: tceUsdPerDay != null && Number.isFinite(tceUsdPerDay) ? tceUsdPerDay : null,
      excerpt: m[0].slice(0, 280),
    };
  }
  return { worldscale: null, tceUsdPerDay: null, excerpt: null };
}

async function fetchVlccTd3c(): Promise<VlccTd3c> {
  const base: VlccTd3c = {
    worldscale: null,
    tceUsdPerDay: null,
    asOfLabel: null,
    sourceUrl: null,
    sourceTitle: null,
    excerpt: null,
    route: "TD3C — 270k mt Middle East Gulf → China (VLCC)",
    note:
      "Parsed from public Baltic Exchange weekly shipping reprints (not the paid Baltic Market Data API). Usually weekly lag vs true broker fixtures.",
  };

  for (const url of BALTIC_SOURCES) {
    try {
      const html = await fetchText(url);
      const text = stripHtml(html);
      const parsed = parseTd3c(text);
      if (parsed.worldscale == null) continue;

      const dateMatch =
        text.match(/July\s+\d{1,2},\s+2026/i) ||
        text.match(/\(July\s+\d{1,2},\s+2026\)/i) ||
        text.match(/as of\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}/i);

      return {
        ...base,
        worldscale: parsed.worldscale,
        tceUsdPerDay: parsed.tceUsdPerDay,
        asOfLabel: dateMatch?.[0] ?? "from latest public Baltic reprint",
        sourceUrl: url,
        sourceTitle: "Baltic Exchange shipping update (public reprint)",
        excerpt: parsed.excerpt,
      };
    } catch {
      /* try next */
    }
  }

  // Google News RSS fallback — titles only; still useful as crisis signal breadcrumbs
  try {
    const rss = await fetchText(
      "https://news.google.com/rss/search?q=TD3C+VLCC+Baltic+WS&hl=en-US&gl=US&ceid=US:en",
    );
    const item = rss.match(/<item>[\s\S]*?<\/item>/);
    const title = item?.[0]?.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]
      ?? item?.[0]?.match(/<title>(.*?)<\/title>/)?.[1]
      ?? null;
    return {
      ...base,
      sourceTitle: title,
      note:
        base.note +
        " Could not parse a numeric WS print from known reprint URLs; showing latest related headline instead.",
    };
  } catch {
    return base;
  }
}

async function fetchBrentPhysical(): Promise<BrentPhysical> {
  const [brentCsv, brentFutures, wtiFutures] = await Promise.all([
    fetchText(EIA_BRENT_CSV).catch(() => null),
    getStockQuote("BZ=F").catch(() => null),
    getStockQuote("CL=F").catch(() => null),
  ]);

  const spot = brentCsv ? parseLastCsvPrice(brentCsv) : null;
  const spotMinusFutures =
    spot?.price != null && brentFutures?.price != null
      ? spot.price - brentFutures.price
      : null;

  return {
    eiaEuropeBrentSpot: {
      price: spot?.price ?? null,
      asOf: spot?.asOf ?? null,
      source: "EIA via datasets/oil-prices (Europe Brent Spot FOB)",
      note:
        "This is EIA Europe Brent Spot FOB — the best free official spot series. It is NOT Platts Dated Brent (Dtd), which is a licensed assessment. Use futures (BZ=F) for intra-day; use this spot series for physical-vs-paper context.",
    },
    brentFutures,
    spotMinusFutures,
    wtiFutures,
  };
}

export async function getPhysicalMarkets(): Promise<PhysicalMarkets> {
  const [brent, vlccTd3c] = await Promise.all([
    fetchBrentPhysical(),
    fetchVlccTd3c(),
  ]);

  return {
    brent,
    vlccTd3c,
    fetchedAt: new Date().toISOString(),
    caveats: [
      "True Platts Dated Brent requires a Platts/ICE license — not available free.",
      "Official Baltic TD3C real-time assessments require Baltic Exchange Data Services — not available free.",
      "Tradehole uses EIA Europe Brent Spot + ICE Brent futures (Yahoo) + parsed public Baltic weekly reprints for TD3C.",
      "Physical VLCC fixtures and Dated Brent often lead paper markets; treat futures as the lagging indicator when physical prints diverge.",
    ],
  };
}
