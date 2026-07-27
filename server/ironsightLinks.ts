export type IronsightConflictKey = "iran-israel" | "russia-ukraine";

/** Both theaters IRONSIGHT supports today. */
export const IRONSIGHT_CONFLICTS: IronsightConflictKey[] = [
  "iran-israel",
  "russia-ukraine",
];

export type IronsightLinkItem = {
  title: string;
  link: string;
  source?: string;
  pubDate?: string;
  category?: string;
  panel: "news" | "telegram" | "strikes" | "regional-alerts";
  conflict: IronsightConflictKey;
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

function fromNews(raw: unknown, conflict: IronsightConflictKey): IronsightLinkItem[] {
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
      conflict,
    });
  }
  return out;
}

function fromTelegram(
  raw: unknown,
  conflict: IronsightConflictKey,
): IronsightLinkItem[] {
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
      conflict,
    });
  }
  return out;
}

function fromStrikes(
  raw: unknown,
  conflict: IronsightConflictKey,
): IronsightLinkItem[] {
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
      conflict,
    });
  }
  return out;
}

function fromRegional(
  raw: unknown,
  conflict: IronsightConflictKey,
): IronsightLinkItem[] {
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
        conflict,
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

export type IronsightLinksPayload = {
  generatedAt: string;
  conflict: string;
  conflicts: IronsightConflictKey[];
  sourceBase: string;
  count: number;
  links: string[];
  articles: IronsightLinkItem[];
  byPanel: Record<string, number>;
  byConflict: Record<string, number>;
  panelStatus: Array<{
    conflict: string;
    panel: string;
    ok: boolean;
    count: number;
    error?: string;
  }>;
};

/**
 * Collect every clickable URL for one IRONSIGHT theater.
 */
export async function collectIronsightLinks(
  ironsightUrl: string,
  conflict: IronsightConflictKey = "iran-israel",
): Promise<IronsightLinksPayload> {
  const base = ironsightUrl.replace(/\/$/, "");
  const q = `conflict=${encodeURIComponent(conflict)}`;

  const results = await Promise.all([
    safeFetch("news", `${base}/api/news?${q}`, (raw) => fromNews(raw, conflict)),
    safeFetch("telegram", `${base}/api/telegram?${q}`, (raw) =>
      fromTelegram(raw, conflict),
    ),
    safeFetch("strikes", `${base}/api/strikes?${q}`, (raw) =>
      fromStrikes(raw, conflict),
    ),
    safeFetch("regional-alerts", `${base}/api/regional-alerts?${q}`, (raw) =>
      fromRegional(raw, conflict),
    ),
  ]);

  const seen = new Set<string>();
  const articles: IronsightLinkItem[] = [];
  for (const result of results) {
    for (const item of result.items) {
      const key = `${item.conflict}|${item.link}`;
      if (seen.has(key)) continue;
      seen.add(key);
      articles.push(item);
    }
  }

  const byPanel: Record<string, number> = {};
  const byConflict: Record<string, number> = {};
  for (const item of articles) {
    byPanel[item.panel] = (byPanel[item.panel] ?? 0) + 1;
    byConflict[item.conflict] = (byConflict[item.conflict] ?? 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    conflict,
    conflicts: [conflict],
    sourceBase: base,
    count: articles.length,
    links: articles.map((a) => a.link),
    articles,
    byPanel,
    byConflict,
    panelStatus: results.map((r) => ({
      conflict,
      panel: r.panel,
      ok: r.ok,
      count: r.items.length,
      error: r.error,
    })),
  };
}

/**
 * Collect links for every IRONSIGHT theater (iran-israel + russia-ukraine).
 */
export async function collectAllIronsightLinks(
  ironsightUrl: string,
  conflicts: IronsightConflictKey[] = IRONSIGHT_CONFLICTS,
): Promise<IronsightLinksPayload> {
  const parts = await Promise.all(
    conflicts.map((c) => collectIronsightLinks(ironsightUrl, c)),
  );

  const seen = new Set<string>();
  const articles: IronsightLinkItem[] = [];
  const panelStatus: IronsightLinksPayload["panelStatus"] = [];
  for (const part of parts) {
    panelStatus.push(...part.panelStatus);
    for (const item of part.articles) {
      const key = `${item.conflict}|${item.link}`;
      if (seen.has(key)) continue;
      seen.add(key);
      articles.push(item);
    }
  }

  const byPanel: Record<string, number> = {};
  const byConflict: Record<string, number> = {};
  for (const item of articles) {
    byPanel[item.panel] = (byPanel[item.panel] ?? 0) + 1;
    byConflict[item.conflict] = (byConflict[item.conflict] ?? 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    conflict: "all",
    conflicts,
    sourceBase: ironsightUrl.replace(/\/$/, ""),
    count: articles.length,
    links: [...new Set(articles.map((a) => a.link))],
    articles,
    byPanel,
    byConflict,
    panelStatus,
  };
}

export function resolveIronsightConflicts(
  raw: string | undefined,
): IronsightConflictKey[] | "all" {
  const v = (raw ?? "all").trim().toLowerCase();
  if (!v || v === "all" || v === "both") return "all";
  if (v === "iran-israel" || v === "russia-ukraine") {
    return [v];
  }
  throw new Error(
    `Unknown conflict "${raw}". Use all | iran-israel | russia-ukraine`,
  );
}
