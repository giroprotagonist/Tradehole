/**
 * Frontline / major tanker operator first-hand assessment — free Google News + IR deep links.
 * Not a substitute for reading 6-K / earnings PDFs; aggregates public headlines.
 */

export type ShippingHeadline = {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  company: string;
};

export type ShippingIndustryReport = {
  asOf: string;
  frontline: ShippingHeadline[];
  peers: ShippingHeadline[];
  irLinks: Array<{ label: string; href: string; note: string }>;
  read: string;
  note: string;
};

const IR_LINKS: ShippingIndustryReport["irLinks"] = [
  {
    label: "Frontline IR / investor",
    href: "https://www.frontline.bm/",
    note: "Earnings, fleet TCE guidance, 6-K equivalents — paste figures manually",
  },
  {
    label: "Frontline SEC EDGAR",
    href: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000913294&type=&dateb=&owner=include&count=40",
    note: "Foreign private issuer — mostly 6-K / 20-F",
  },
  {
    label: "DHT IR",
    href: "https://www.dhtankers.com/",
    note: "Peer VLCC operator commentary",
  },
  {
    label: "International Seaways IR",
    href: "https://www.intlseas.com/",
    note: "Peer tanker IR",
  },
  {
    label: "Teekay Tankers IR",
    href: "https://www.teekay.com/investors/",
    note: "Peer tanker IR",
  },
];

function parseRss(xml: string, company: string): ShippingHeadline[] {
  const items: ShippingHeadline[] = [];
  const blocks = xml.split(/<item>/i).slice(1);
  for (const block of blocks.slice(0, 12)) {
    const title =
      block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i)?.[1] ??
      block.match(/<title>(.*?)<\/title>/i)?.[1] ??
      "";
    const link =
      block.match(/<link>(.*?)<\/link>/i)?.[1]?.trim() ??
      block.match(/<link[^>]*href="([^"]+)"/i)?.[1] ??
      "";
    const pubDate =
      block.match(/<pubDate>(.*?)<\/pubDate>/i)?.[1]?.trim() ?? "";
    const source =
      block.match(/<source[^>]*>(.*?)<\/source>/i)?.[1]?.trim() ??
      company;
    const clean = title
      .replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;/g, "'")
      .trim();
    if (!clean) continue;
    items.push({
      title: clean,
      link: link.replace(/&amp;/g, "&"),
      pubDate,
      source,
      company,
    });
  }
  return items;
}

async function fetchNews(
  query: string,
  company: string,
): Promise<ShippingHeadline[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Tradehole/0.2 (personal research)",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];
    return parseRss(await res.text(), company);
  } catch {
    return [];
  }
}

export async function fetchShippingIndustry(): Promise<ShippingIndustryReport> {
  const [frontline, dht, tnk, insw] = await Promise.all([
    fetchNews(
      'Frontline plc OR "Frontline Ltd" OR FRO tanker (Hormuz OR TCE OR earnings OR VLCC OR "war risk")',
      "Frontline",
    ),
    fetchNews(
      "DHT Holdings OR DHT tanker (Hormuz OR TCE OR VLCC OR earnings)",
      "DHT",
    ),
    fetchNews(
      'Teekay Tankers OR TNK tanker (Hormuz OR TCE OR VLCC OR earnings)',
      "TNK",
    ),
    fetchNews(
      'International Seaways OR INSW tanker (Hormuz OR TCE OR VLCC OR earnings)',
      "INSW",
    ),
  ]);

  const peers = [...dht, ...tnk, ...insw]
    .sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate) || 0)
    .slice(0, 12);

  const froFresh = frontline.filter((h) => {
    const t = Date.parse(h.pubDate);
    if (!Number.isFinite(t)) return true;
    return Date.now() - t < 45 * 86_400_000;
  });

  let read =
    "Scan Frontline + peer IR headlines for first-hand tanker-market / Hormuz assessment. Prefer company releases over aggregators.";
  if (froFresh.length) {
    read = `Frontline-related headlines in ~45d: ${froFresh.length}. Top: “${froFresh[0].title}”. Open IR links for TCE / guidance — not auto-parsed from PDFs.`;
  } else if (frontline.length) {
    read = `Frontline headlines present but may be stale. Latest: “${frontline[0].title}”. Check frontline.bm IR directly.`;
  }

  return {
    asOf: new Date().toISOString(),
    frontline: frontline.slice(0, 10),
    peers,
    irLinks: IR_LINKS,
    read,
    note: "Free Google News RSS + IR deep links. Fleet TCE figures are not scraped from PDFs — paste from IR filings manually.",
  };
}

export function shippingIndustryMarkdown(
  report: ShippingIndustryReport | null,
  error?: string | null,
): string {
  const lines: string[] = [
    "## Shipping company first-hand (Frontline + peers)",
  ];
  if (!report) {
    lines.push(`(unavailable${error ? `: ${error}` : ""})`);
    lines.push(
      "Open https://www.frontline.bm/ for earnings / fleet TCE and paste into the receiving LLM.",
    );
    return lines.join("\n");
  }
  lines.push(report.read);
  lines.push(report.note);
  lines.push("");
  lines.push("### Frontline headlines");
  if (!report.frontline.length) {
    lines.push("- (no Google News hits)");
  } else {
    for (const h of report.frontline) {
      lines.push(
        `- **${h.pubDate || "?"}** · ${h.title}${h.link ? ` · ${h.link}` : ""}`,
      );
    }
  }
  lines.push("");
  lines.push("### Peer tanker headlines (DHT / TNK / INSW)");
  if (!report.peers.length) {
    lines.push("- (no hits)");
  } else {
    for (const h of report.peers.slice(0, 8)) {
      lines.push(
        `- **[${h.company}]** ${h.pubDate || "?"} · ${h.title}${h.link ? ` · ${h.link}` : ""}`,
      );
    }
  }
  lines.push("");
  lines.push("### IR deep links");
  for (const l of report.irLinks) {
    lines.push(`- ${l.label}: ${l.href} — ${l.note}`);
  }
  return lines.join("\n");
}
