/**
 * Standalone IRONSIGHT news pack — titles + RSS bodies + best-effort article fetch.
 * Separate from AI_BRIEF / OSINT / EVERYTHING packs.
 *
 * Telegram default is ROBUST: full-toolkit channel dump (30d/500/40 pages) + broad ME
 * dump + light RU spillover — same depth caps as OSINT, wider channel set in news pack.
 */

import {
  IRONSIGHT_CONFLICTS,
  type IronsightConflictKey,
} from "./ironsightLinks";
import {
  TELEGRAM_BROAD_DUMP_QUERY,
  TELEGRAM_BROAD_TIMEOUT_MS,
  TELEGRAM_DEEP_DUMP_QUERY,
  TELEGRAM_DEEP_TIMEOUT_MS,
  TELEGRAM_ROBUST_DUMP_QUERY,
  TELEGRAM_ROBUST_TIMEOUT_MS,
  TELEGRAM_RU_LIGHT_DUMP_QUERY,
  TELEGRAM_RU_TIMEOUT_MS,
} from "./hormuzTelegramChannels";
import { zipStore } from "./history/exportPack";

const DEFAULT_FETCH_LIMIT = 100;
const MAX_FETCH_LIMIT = 150;
const DEFAULT_CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 10_000;
const USER_AGENT =
  "TradeholeNewsPack/1.0 (+local research; respects robots best-effort)";

/** robust = full toolkit max dump + broad + RU; deep = priority channels; sample = thin panel. */
export type NewsPackTelegramMode = "robust" | "deep" | "sample";

export type NewsPackOpts = {
  conflicts?: IronsightConflictKey[];
  /** Max newest news URLs to HTML-fetch for full text (default 100, max 150). */
  fetchLimit?: number;
  concurrency?: number;
  /** Include telegram posts section (default true). */
  includeTelegram?: boolean;
  /** Default robust — deepest public scrape for the news pack ZIP. */
  telegramMode?: NewsPackTelegramMode;
};

export type NewsPackArticle = {
  id: string;
  title: string;
  link: string;
  source?: string;
  pubDate?: string;
  category?: string;
  conflict: IronsightConflictKey;
  panel: "news" | "telegram";
  /** Raw RSS description / content / summary (HTML or text). */
  rssBody?: string;
  /** Best available plain-text body. */
  body?: string;
  bodySource: "rss" | "fetch" | "telegram" | "none";
  bodyFetched: boolean;
  fetchError?: string;
};

export type NewsPackResult = {
  generatedAt: string;
  sourceBase: string;
  conflicts: IronsightConflictKey[];
  articleCount: number;
  telegramCount: number;
  telegramMode: NewsPackTelegramMode;
  telegramCapability?: string;
  bodyFetchedOk: number;
  bodyFetchedFail: number;
  bodySkipped: number;
  fetchLimit: number;
  note: string;
  files: Array<{ name: string; content: string; mediaType: string }>;
  zip: Buffer;
};

type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

async function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await p };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function tgLinkKey(link: string, text: string): string {
  const norm = link.toLowerCase().replace(/\/$/, "");
  if (norm.includes("t.me/")) return norm;
  return `${norm}|${text.slice(0, 80).toLowerCase()}`;
}

function postsFromDump(
  raw: unknown,
  conflict: IronsightConflictKey,
): NewsPackArticle[] {
  const posts = asArray((raw as { posts?: unknown })?.posts);
  const out: NewsPackArticle[] = [];
  for (const item of posts) {
    const row = item as Record<string, unknown>;
    const link = String(row.url ?? row.link ?? "").trim();
    const text = String(row.text ?? row.message ?? "").trim();
    const channel = String(
      row.channelLabel ?? row.channel ?? row.username ?? "Telegram",
    );
    const title = text
      ? text.replace(/\s+/g, " ").slice(0, 180)
      : `${channel} post ${row.postId ?? ""}`.trim();
    if (!isHttpUrl(link) && !text) continue;
    const idLink = isHttpUrl(link)
      ? link
      : `text:${channel}:${text.slice(0, 64)}`;
    out.push({
      id: `tg:${conflict}:${idLink}`,
      title,
      link: isHttpUrl(link) ? link : `https://t.me/${channel}`,
      source: channel,
      pubDate:
        row.date != null
          ? String(row.date)
          : row.pubDate != null
            ? String(row.pubDate)
            : undefined,
      category: "telegram",
      conflict,
      panel: "telegram",
      rssBody: text || undefined,
      body: text || undefined,
      bodySource: text ? "telegram" : "none",
      bodyFetched: false,
    });
  }
  return out;
}

function dumpMeta(raw: unknown): {
  mode?: string;
  postCount?: number;
  channelCount?: number;
  days?: number;
  capability?: string;
} {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  return {
    mode: r.mode != null ? String(r.mode) : undefined,
    postCount:
      typeof r.postCount === "number"
        ? r.postCount
        : Array.isArray(r.posts)
          ? r.posts.length
          : undefined,
    channelCount:
      typeof r.channelCount === "number" ? r.channelCount : undefined,
    days: typeof r.days === "number" ? r.days : undefined,
    capability: r.capability != null ? String(r.capability) : undefined,
  };
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function pickRssBody(row: Record<string, unknown>): string | undefined {
  const candidates = [
    row.content,
    row["content:encoded"],
    row.contentEncoded,
    row.description,
    row.summary,
    row.contentSnippet,
  ];
  for (const c of candidates) {
    if (c == null) continue;
    const s = String(c).trim();
    if (s) return s;
  }
  return undefined;
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

function extractMainHtml(html: string): string {
  const article = html.match(
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
  )?.[1];
  if (article && article.length > 200) return article;

  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  if (main && main.length > 200) return main;

  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1];
  if (body) return body;

  return html;
}

async function fetchArticleText(
  url: string,
): Promise<{ text?: string; error?: string }> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) {
      return { error: `HTTP ${res.status}` };
    }
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (
      ct &&
      !ct.includes("text/html") &&
      !ct.includes("application/xhtml") &&
      !ct.includes("text/plain")
    ) {
      return { error: `skip content-type ${ct.split(";")[0]}` };
    }
    const html = await res.text();
    if (
      html.trimStart().startsWith("{") ||
      /paywall|subscribe to continue|sign in to read/i.test(
        html.slice(0, 4000),
      )
    ) {
      // Still try extract — many sites only soft-paywall; honesty note covers rest.
    }
    const chunk = extractMainHtml(html);
    const text = stripHtml(chunk);
    if (text.length < 80) {
      return { error: "extracted text too short (likely paywall/JS shell)" };
    }
    // Cap runaway pages
    return { text: text.slice(0, 40_000) };
  } catch (err) {
    return { error: String(err) };
  }
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

function pubMs(pubDate?: string): number {
  if (!pubDate) return 0;
  const t = Date.parse(pubDate);
  return Number.isFinite(t) ? t : 0;
}

async function collectNews(
  base: string,
  conflict: IronsightConflictKey,
): Promise<NewsPackArticle[]> {
  const raw = await fetchJson(
    `${base}/api/news?conflict=${encodeURIComponent(conflict)}`,
  );
  const articles = Array.isArray(raw)
    ? raw
    : asArray((raw as { news?: unknown }).news);
  const out: NewsPackArticle[] = [];
  for (const item of articles) {
    const row = item as Record<string, unknown>;
    const link = String(row.link ?? row.url ?? "").trim();
    const title = String(row.title ?? "").trim();
    if (!title || !isHttpUrl(link)) continue;
    const rssBody = pickRssBody(row);
    const rssText = rssBody ? stripHtml(rssBody) : "";
    out.push({
      id: `news:${conflict}:${link}`,
      title,
      link,
      source: row.source != null ? String(row.source) : undefined,
      pubDate: row.pubDate != null ? String(row.pubDate) : undefined,
      category: row.category != null ? String(row.category) : undefined,
      conflict,
      panel: "news",
      rssBody,
      body: rssText || undefined,
      bodySource: rssText ? "rss" : "none",
      bodyFetched: false,
    });
  }
  return out;
}

async function collectTelegramSample(
  base: string,
  conflict: IronsightConflictKey,
): Promise<NewsPackArticle[]> {
  try {
    const raw = await fetchJson(
      `${base}/api/telegram?conflict=${encodeURIComponent(conflict)}`,
    );
    return postsFromDump(raw, conflict);
  } catch {
    return [];
  }
}

type TelegramCollection = {
  posts: NewsPackArticle[];
  mode: NewsPackTelegramMode;
  capability: string;
  dumps: Array<{ name: string; raw: unknown }>;
};

/**
 * ROBUST (default): full-toolkit maxed dump + broad ME + RU light spillover.
 * Falls back to thin panel samples if all dumps fail.
 */
async function collectTelegramRobust(base: string): Promise<TelegramCollection> {
  const [robustS, broadS, ruS] = await Promise.all([
    settle(
      fetchJson(
        `${base}/api/telegram?${TELEGRAM_ROBUST_DUMP_QUERY}`,
        TELEGRAM_ROBUST_TIMEOUT_MS,
      ),
    ),
    settle(
      fetchJson(
        `${base}/api/telegram?${TELEGRAM_BROAD_DUMP_QUERY}`,
        TELEGRAM_BROAD_TIMEOUT_MS,
      ),
    ),
    settle(
      fetchJson(
        `${base}/api/telegram?${TELEGRAM_RU_LIGHT_DUMP_QUERY}`,
        TELEGRAM_RU_TIMEOUT_MS,
      ),
    ),
  ]);

  const dumps: Array<{ name: string; raw: unknown }> = [];
  const parts: NewsPackArticle[] = [];

  if (robustS.ok) {
    dumps.push({ name: "telegram_robust_dump.json", raw: robustS.value });
    parts.push(...postsFromDump(robustS.value, "iran-israel"));
  }
  if (broadS.ok) {
    dumps.push({ name: "telegram_broad_dump.json", raw: broadS.value });
    parts.push(...postsFromDump(broadS.value, "iran-israel"));
  }
  if (ruS.ok) {
    dumps.push({ name: "telegram_ru_light_dump.json", raw: ruS.value });
    parts.push(...postsFromDump(ruS.value, "russia-ukraine"));
  }

  const seen = new Set<string>();
  const posts: NewsPackArticle[] = [];
  for (const a of parts) {
    const key = tgLinkKey(a.link, a.body ?? a.title);
    if (seen.has(key)) continue;
    seen.add(key);
    posts.push(a);
  }
  posts.sort((a, b) => pubMs(b.pubDate) - pubMs(a.pubDate));

  const rMeta = robustS.ok ? dumpMeta(robustS.value) : {};
  const bMeta = broadS.ok ? dumpMeta(broadS.value) : {};
  const uMeta = ruS.ok ? dumpMeta(ruS.value) : {};
  const capability = [
    robustS.ok
      ? `robust toolkit ${rMeta.postCount ?? postsFromDump(robustS.value, "iran-israel").length} posts / ${rMeta.days ?? 30}d / maxPages=40`
      : `robust failed: ${robustS.error}`,
    broadS.ok
      ? `broad ME ${bMeta.postCount ?? "?"} posts / ${bMeta.days ?? 14}d`
      : `broad failed: ${broadS.error}`,
    ruS.ok
      ? `RU light ${uMeta.postCount ?? "?"} posts`
      : `RU light failed: ${ruS.error}`,
  ].join(" · ");

  if (posts.length === 0) {
    const sampleParts = await Promise.all(
      IRONSIGHT_CONFLICTS.map((c) => collectTelegramSample(base, c)),
    );
    const fallback = sampleParts.flat();
    return {
      posts: fallback,
      mode: "sample",
      capability: `all dumps failed — panel sample fallback (${fallback.length} posts). ${capability}`,
      dumps: [],
    };
  }

  return { posts, mode: "robust", capability, dumps };
}

/** Deep priority channels + broad + RU (OSINT-parity channel set, not full toolkit). */
async function collectTelegramDeep(base: string): Promise<TelegramCollection> {
  const [deepS, broadS, ruS] = await Promise.all([
    settle(
      fetchJson(
        `${base}/api/telegram?${TELEGRAM_DEEP_DUMP_QUERY}`,
        TELEGRAM_DEEP_TIMEOUT_MS,
      ),
    ),
    settle(
      fetchJson(
        `${base}/api/telegram?${TELEGRAM_BROAD_DUMP_QUERY}`,
        TELEGRAM_BROAD_TIMEOUT_MS,
      ),
    ),
    settle(
      fetchJson(
        `${base}/api/telegram?${TELEGRAM_RU_LIGHT_DUMP_QUERY}`,
        TELEGRAM_RU_TIMEOUT_MS,
      ),
    ),
  ]);

  const dumps: Array<{ name: string; raw: unknown }> = [];
  const parts: NewsPackArticle[] = [];
  if (deepS.ok) {
    dumps.push({ name: "telegram_deep_dump.json", raw: deepS.value });
    parts.push(...postsFromDump(deepS.value, "iran-israel"));
  }
  if (broadS.ok) {
    dumps.push({ name: "telegram_broad_dump.json", raw: broadS.value });
    parts.push(...postsFromDump(broadS.value, "iran-israel"));
  }
  if (ruS.ok) {
    dumps.push({ name: "telegram_ru_light_dump.json", raw: ruS.value });
    parts.push(...postsFromDump(ruS.value, "russia-ukraine"));
  }

  const seen = new Set<string>();
  const posts: NewsPackArticle[] = [];
  for (const a of parts) {
    const key = tgLinkKey(a.link, a.body ?? a.title);
    if (seen.has(key)) continue;
    seen.add(key);
    posts.push(a);
  }
  posts.sort((a, b) => pubMs(b.pubDate) - pubMs(a.pubDate));

  const capability = [
    deepS.ok ? "deep ok" : `deep failed: ${deepS.error}`,
    broadS.ok ? "broad ok" : `broad failed: ${broadS.error}`,
    ruS.ok ? "RU light ok" : `RU light failed: ${ruS.error}`,
  ].join(" · ");

  if (posts.length === 0) {
    const sampleParts = await Promise.all(
      IRONSIGHT_CONFLICTS.map((c) => collectTelegramSample(base, c)),
    );
    return {
      posts: sampleParts.flat(),
      mode: "sample",
      capability: `dumps failed — sample fallback. ${capability}`,
      dumps: [],
    };
  }

  return { posts, mode: "deep", capability, dumps };
}

async function collectTelegramForPack(
  base: string,
  mode: NewsPackTelegramMode,
  conflicts: IronsightConflictKey[],
): Promise<TelegramCollection> {
  if (mode === "robust") return collectTelegramRobust(base);
  if (mode === "deep") return collectTelegramDeep(base);

  const parts = await Promise.all(
    conflicts.map((c) => collectTelegramSample(base, c)),
  );
  const seen = new Set<string>();
  const posts: NewsPackArticle[] = [];
  for (const a of parts.flat()) {
    const key = tgLinkKey(a.link, a.body ?? a.title);
    if (seen.has(key)) continue;
    seen.add(key);
    posts.push(a);
  }
  posts.sort((a, b) => pubMs(b.pubDate) - pubMs(a.pubDate));
  return {
    posts,
    mode: "sample",
    capability: "IRONSIGHT panel sample (latest embeds per channel)",
    dumps: [],
  };
}

function buildMarkdownIndex(
  articles: NewsPackArticle[],
  telegram: NewsPackArticle[],
  meta: {
    generatedAt: string;
    conflicts: string[];
    fetchLimit: number;
    bodyFetchedOk: number;
    bodyFetchedFail: number;
    bodySkipped: number;
    telegramMode: NewsPackTelegramMode;
    telegramCapability?: string;
  },
): string {
  const lines: string[] = [];
  lines.push(`# NEWS_PACK`);
  lines.push("");
  lines.push(`Generated: ${meta.generatedAt}`);
  lines.push(`Theaters: ${meta.conflicts.join(", ")}`);
  lines.push(
    `Articles: ${articles.length} · Telegram posts: ${telegram.length} (${meta.telegramMode})`,
  );
  if (meta.telegramCapability) {
    lines.push(`Telegram: ${meta.telegramCapability}`);
  }
  lines.push(
    `Body fetch: ok=${meta.bodyFetchedOk} fail=${meta.bodyFetchedFail} skipped=${meta.bodySkipped} (cap ${meta.fetchLimit})`,
  );
  lines.push("");
  lines.push(
    "> Bodies are best-effort. RSS descriptions are included when IRONSIGHT provides them; HTML fetch often fails on paywalls / 403 / JS shells. See README.md.",
  );
  lines.push("");

  lines.push(`## News (${articles.length})`);
  lines.push("");
  for (const [i, a] of articles.entries()) {
    const excerpt = (a.body ?? "").replace(/\s+/g, " ").slice(0, 280);
    lines.push(`### ${i + 1}. ${a.title}`);
    lines.push("");
    lines.push(
      `- **Source:** ${a.source ?? "?"} · **Theater:** ${a.conflict} · **Date:** ${a.pubDate ?? "?"}`,
    );
    lines.push(`- **Link:** ${a.link}`);
    lines.push(
      `- **Body:** source=${a.bodySource}` +
        (a.bodyFetched ? " · fetched" : a.fetchError ? ` · ${a.fetchError}` : ""),
    );
    if (excerpt) {
      lines.push("");
      lines.push(excerpt + (a.body && a.body.length > 280 ? "…" : ""));
    }
    lines.push("");
  }

  if (telegram.length) {
    const tgLabel =
      meta.telegramMode === "sample"
        ? "Telegram sample"
        : `Telegram ${meta.telegramMode} dump`;
    lines.push(`## ${tgLabel} (${telegram.length})`);
    lines.push("");
    for (const [i, a] of telegram.entries()) {
      const excerpt = (a.body ?? "").replace(/\s+/g, " ").slice(0, 280);
      lines.push(`### T${i + 1}. ${a.source ?? "Telegram"}`);
      lines.push("");
      lines.push(`- **Date:** ${a.pubDate ?? "?"} · **Theater:** ${a.conflict}`);
      lines.push(`- **Link:** ${a.link}`);
      if (excerpt) {
        lines.push("");
        lines.push(excerpt + (a.body && a.body.length > 280 ? "…" : ""));
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function buildReadme(meta: {
  fetchLimit: number;
  concurrency: number;
  sourceBase: string;
  telegramMode: NewsPackTelegramMode;
}): string {
  return `# Tradehole News Pack

Standalone news export (not the OSINT / AI_BRIEF / EVERYTHING pack).

## Contents
- \`NEWS_PACK.md\` — index with titles + truncated excerpts
- \`articles.json\` — full article records (RSS body + optional fetched body)
- \`telegram.json\` — merged Telegram posts (deduped) from the ${meta.telegramMode} dump pipeline
- \`telegram_robust_dump.json\` — raw IRONSIGHT dump (full toolkit · 30d · ≤500/channel · maxPages=40) when mode=robust
- \`telegram_broad_dump.json\` — raw broad ME dump (14d · ≤200/channel)
- \`telegram_ru_light_dump.json\` — raw RU spillover (3d light)
- \`telegram_deep_dump.json\` — present when mode=deep (priority Hormuz channels only)

## Telegram modes
Default **robust** = deepest public scrape IRONSIGHT allows (API caps: days≤30, limit≤500, maxPages≤40) across the **full Hormuz toolkit channel list**, plus broad ME dump + light RU spillover. Query \`telegram=deep\` for priority-only channels, or \`telegram=sample\` for the thin panel embeds.

## Body sources
1. **RSS** — \`description\` / \`content\` / \`content:encoded\` from IRONSIGHT news API when present
2. **HTML fetch** — best-effort scrape of the newest ${meta.fetchLimit} news URLs (concurrency ${meta.concurrency}, ~${FETCH_TIMEOUT_MS / 1000}s timeout each)
3. Remaining items keep title + link (+ RSS if any) with \`bodyFetched: false\`

## Limitations (honest)
- Many outlets paywall, geo-block, or return JS shells → fetch fails or short text
- Google News links often redirect; extraction quality varies
- No guarantee every URL yields full text — failed fetches keep title/link and \`fetchError\`
- Telegram dumps are public t.me/s pagination — not GramJS forever-history; private channels unsupported
- Robust dump can take 1–3 minutes while IRONSIGHT paginates every toolkit channel

Source: ${meta.sourceBase}
`;
}

export async function buildNewsPack(
  ironsightUrl: string,
  opts: NewsPackOpts = {},
): Promise<NewsPackResult> {
  const base = ironsightUrl.replace(/\/$/, "");
  const conflicts = opts.conflicts?.length
    ? opts.conflicts
    : IRONSIGHT_CONFLICTS;
  const fetchLimit = Math.max(
    0,
    Math.min(MAX_FETCH_LIMIT, opts.fetchLimit ?? DEFAULT_FETCH_LIMIT),
  );
  const concurrency = Math.max(
    1,
    Math.min(8, opts.concurrency ?? DEFAULT_CONCURRENCY),
  );
  const includeTelegram = opts.includeTelegram !== false;
  const telegramMode: NewsPackTelegramMode = opts.telegramMode ?? "robust";

  const newsParts = await Promise.all(
    conflicts.map(async (c) => {
      try {
        return await collectNews(base, c);
      } catch (err) {
        console.warn(`[newsPack] news fetch failed for ${c}:`, err);
        return [] as NewsPackArticle[];
      }
    }),
  );

  const seen = new Set<string>();
  const articles: NewsPackArticle[] = [];
  for (const part of newsParts) {
    for (const a of part) {
      const key = a.link;
      if (seen.has(key)) continue;
      seen.add(key);
      articles.push(a);
    }
  }

  if (articles.length === 0) {
    throw new Error(
      `IRONSIGHT news empty/unreachable at ${base}. Start it with npm run osint.`,
    );
  }

  // Newest first for fetch priority
  const now = Date.now();
  articles.sort((a, b) => {
    const da = Math.abs(now - pubMs(a.pubDate));
    const db = Math.abs(now - pubMs(b.pubDate));
    return da - db;
  });

  let telegram: NewsPackArticle[] = [];
  let telegramCapability = "";
  let effectiveTelegramMode: NewsPackTelegramMode = telegramMode;
  const telegramDumpFiles: Array<{ name: string; content: string; mediaType: string }> =
    [];

  if (includeTelegram) {
    console.log(`[newsPack] telegram mode=${telegramMode}…`);
    const tg = await collectTelegramForPack(base, telegramMode, conflicts);
    telegram = tg.posts;
    telegramCapability = tg.capability;
    effectiveTelegramMode = tg.mode;
    for (const d of tg.dumps) {
      telegramDumpFiles.push({
        name: d.name,
        content: JSON.stringify(d.raw, null, 2),
        mediaType: "application/json",
      });
    }
    console.log(
      `[newsPack] telegram done: ${telegram.length} posts (${effectiveTelegramMode}) · ${telegramCapability}`,
    );
  }

  const toFetch = articles.slice(0, fetchLimit);
  const skipped = articles.slice(fetchLimit);
  for (const a of skipped) {
    a.bodyFetched = false;
  }

  let bodyFetchedOk = 0;
  let bodyFetchedFail = 0;

  await mapPool(toFetch, concurrency, async (article) => {
    const result = await fetchArticleText(article.link);
    if (result.text) {
      // Prefer longer fetched body over short RSS blurb
      const rssLen = article.body?.length ?? 0;
      if (result.text.length > rssLen) {
        article.body = result.text;
        article.bodySource = "fetch";
      }
      article.bodyFetched = true;
      bodyFetchedOk++;
    } else {
      article.bodyFetched = false;
      article.fetchError = result.error ?? "fetch failed";
      bodyFetchedFail++;
    }
    return article;
  });

  const generatedAt = new Date().toISOString();
  const note =
    "Best-effort news pack. RSS bodies when available; HTML fetch for newest N only. Paywalls/403s expected. Telegram defaults to robust dump (full toolkit + broad + RU light).";

  const payload = {
    generatedAt,
    sourceBase: base,
    conflicts,
    note,
    fetchLimit,
    concurrency,
    fetchTimeoutMs: FETCH_TIMEOUT_MS,
    telegramMode: effectiveTelegramMode,
    telegramCapability,
    stats: {
      articleCount: articles.length,
      telegramCount: telegram.length,
      bodyFetchedOk,
      bodyFetchedFail,
      bodySkipped: skipped.length,
    },
    articles,
  };

  const readme = buildReadme({
    fetchLimit,
    concurrency,
    sourceBase: base,
    telegramMode: effectiveTelegramMode,
  });
  const md = buildMarkdownIndex(articles, telegram, {
    generatedAt,
    conflicts,
    fetchLimit,
    bodyFetchedOk,
    bodyFetchedFail,
    bodySkipped: skipped.length,
    telegramMode: effectiveTelegramMode,
    telegramCapability,
  });

  const files = [
    { name: "README.md", content: readme, mediaType: "text/markdown" },
    { name: "NEWS_PACK.md", content: md, mediaType: "text/markdown" },
    {
      name: "articles.json",
      content: JSON.stringify(payload, null, 2),
      mediaType: "application/json",
    },
    {
      name: "telegram.json",
      content: JSON.stringify(
        {
          generatedAt,
          mode: effectiveTelegramMode,
          capability: telegramCapability,
          conflicts,
          count: telegram.length,
          posts: telegram,
          note:
            effectiveTelegramMode === "robust"
              ? "ROBUST: full Hormuz toolkit (30d/500/40) + broad ME + RU light — raw dumps also in ZIP"
              : effectiveTelegramMode === "deep"
                ? "Deep priority channels + broad + RU light"
                : "Thin IRONSIGHT panel sample",
        },
        null,
        2,
      ),
      mediaType: "application/json",
    },
    ...telegramDumpFiles,
  ];

  const zip = zipStore(files.map((f) => ({ name: f.name, content: f.content })));

  return {
    generatedAt,
    sourceBase: base,
    conflicts,
    articleCount: articles.length,
    telegramCount: telegram.length,
    telegramMode: effectiveTelegramMode,
    telegramCapability,
    bodyFetchedOk,
    bodyFetchedFail,
    bodySkipped: skipped.length,
    fetchLimit,
    note,
    files,
    zip,
  };
}
