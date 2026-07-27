export type IronsightLinkItem = {
  title: string;
  link: string;
  source?: string;
  pubDate?: string;
  category?: string;
  panel: "news" | "telegram" | "strikes" | "regional-alerts";
};

type FetchResult = {
  panel: IronsightLinkItem["panel"];
  ok: boolean;
  error?: string;
  items: IronsightLinkItem[];
};

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  return [];
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

async function fetchJson(url: string, timeoutMs = 25_000): Promise<unknown> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

function fromNews(raw: unknown): IronsightLinkItem[] {
  const articles = Array.isArray(raw)
    ? raw
    : asArray((raw as { news?: unknown }).news);
  const out: IronsightLinkItem[] = [];
  for (const item of articles) {
    const row = item as Record<string, unknown>;
    const link = String(row.link ?? row.url ?? "").trim();
    const title = String(row.title ?? "").trim();
    if (!title || !isHttpUrl(link)) continue;
    out.push({
      title,
      link,
      source: row.source != null ? String(row.source) : undefined,
      pubDate: row.pubDate != null ? String(row.pubDate) : undefined,
      category: row.category != null ? String(row.category) : undefined,
      panel: "news",
    });
  }
  return out;
}

function fromTelegram(raw: unknown): IronsightLinkItem[] {
  const posts = asArray((raw as { posts?: unknown }).posts);
  const out: IronsightLinkItem[] = [];
  for (const item of posts) {
    const row = item as Record<string, unknown>;
    const link = String(row.url ?? "").trim();
    const text = String(row.text ?? "").trim();
    const channel = String(row.channelLabel ?? row.channel ?? "Telegram");
    const title = text
      ? text.replace(/\s+/g, " ").slice(0, 180)
      : `${channel} post ${row.postId ?? ""}`.trim();
    if (!isHttpUrl(link)) continue;
    out.push({
      title,
      link,
      source: channel,
      pubDate: row.date != null ? String(row.date) : undefined,
      category: "telegram",
      panel: "telegram",
    });
  }
  return out;
}

function fromStrikes(raw: unknown): IronsightLinkItem[] {
  const out: IronsightLinkItem[] = [];
  for (const item of asArray(raw)) {
    const row = item as Record<string, unknown>;
    const link = String(row.url ?? row.link ?? "").trim();
    const title = String(row.title ?? "").trim();
    if (!title || !isHttpUrl(link)) continue;
    out.push({
      title,
      link,
      source: row.source != null ? String(row.source) : undefined,
      pubDate: row.date != null ? String(row.date) : undefined,
      category: row.category != null ? String(row.category) : "strike",
      panel: "strikes",
    });
  }
  return out;
}

function fromRegional(raw: unknown): IronsightLinkItem[] {
  const countries = asArray(
    (raw as { alerts?: unknown; countries?: unknown }).alerts ??
      (raw as { countries?: unknown }).countries,
  );
  const items: IronsightLinkItem[] = [];
  for (const country of countries) {
    const c = country as Record<string, unknown>;
    const countryName = String(c.name ?? "Regional");
    for (const event of asArray(c.events)) {
      const row = event as Record<string, unknown>;
      const link = String(row.url ?? row.link ?? "").trim();
      const title = String(row.title ?? "").trim();
      if (!title || !isHttpUrl(link)) continue;
      items.push({
        title,
        link,
        source: row.source != null ? String(row.source) : countryName,
        pubDate: row.time != null ? String(row.time) : undefined,
        category: `${countryName}:${String(row.severity ?? "event")}`,
        panel: "regional-alerts",
      });
    }
  }
  return items;
}

async function safeFetch(
  panel: IronsightLinkItem["panel"],
  url: string,
  parse: (raw: unknown) => IronsightLinkItem[],
): Promise<FetchResult> {
  try {
    const raw = await fetchJson(url);
    return { panel, ok: true, items: parse(raw) };
  } catch (err) {
    return { panel, ok: false, error: String(err), items: [] };
  }
}

/**
 * Collect every clickable URL shown in IRONSIGHT panels that render links:
 * Live Intel (news), Telegram, Strikes, Regional Alerts.
 */
export async function collectIronsightLinks(
  ironsightUrl: string,
  conflict = "iran-israel",
): Promise<{
  generatedAt: string;
  conflict: string;
  sourceBase: string;
  count: number;
  links: string[];
  articles: IronsightLinkItem[];
  byPanel: Record<string, number>;
  panelStatus: Array<{ panel: string; ok: boolean; count: number; error?: string }>;
}> {
  const base = ironsightUrl.replace(/\/$/, "");
  const q = `conflict=${encodeURIComponent(conflict)}`;

  const results = await Promise.all([
    safeFetch("news", `${base}/api/news?${q}`, fromNews),
    safeFetch("telegram", `${base}/api/telegram?${q}`, fromTelegram),
    safeFetch("strikes", `${base}/api/strikes?${q}`, fromStrikes),
    safeFetch("regional-alerts", `${base}/api/regional-alerts?${q}`, fromRegional),
  ]);

  const seen = new Set<string>();
  const articles: IronsightLinkItem[] = [];
  for (const result of results) {
    for (const item of result.items) {
      if (seen.has(item.link)) continue;
      seen.add(item.link);
      articles.push(item);
    }
  }

  const byPanel: Record<string, number> = {};
  for (const item of articles) {
    byPanel[item.panel] = (byPanel[item.panel] ?? 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    conflict,
    sourceBase: base,
    count: articles.length,
    links: articles.map((a) => a.link),
    articles,
    byPanel,
    panelStatus: results.map((r) => ({
      panel: r.panel,
      ok: r.ok,
      count: r.items.length,
      error: r.error,
    })),
  };
}
