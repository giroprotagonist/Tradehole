/**
 * Bridge: Tradehole Node API ↔ Python news_reader package.
 * Spawns `.venv/bin/python -m news_reader.main` with safe args (telegram web only
 * unless TELEGRAM_API_ID/HASH are set). Reads SQLite for status/articles.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  articleMatchesRegionPack,
  findRegionPack,
  listRegionPacks,
  type RegionPackId,
} from "./analytics/regionPacks";

export type NewsReaderStage = "all" | "ingest" | "extract" | "summarize";
export type NewsReaderTelegramMode = "web" | "telethon" | "both";

export type NewsReaderJob = {
  id: string;
  running: boolean;
  stage: NewsReaderStage;
  limit: number | null;
  summarizeLimit: number | null;
  telegramMode: NewsReaderTelegramMode;
  model: string | null;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  error: string | null;
  logTail: string;
  command: string[];
};

export type NewsReaderCounts = {
  pending: number;
  extracted: number;
  summarized: number;
  failed: number;
  total: number;
};

export type NewsReaderStatus = {
  ok: boolean;
  repoRoot: string;
  venvOk: boolean;
  pythonPath: string | null;
  dbPath: string | null;
  dbExists: boolean;
  counts: NewsReaderCounts;
  lastUpdatedAt: string | null;
  ollama: {
    up: boolean;
    host: string;
    model: string;
    models: string[];
    error: string | null;
  };
  job: NewsReaderJob | null;
  telethonConfigured: boolean;
};

export type NewsReaderArticleSummary = {
  key_points: string[];
  primary_topic: string;
  sentiment: string;
  importance_score: number;
};

export type NewsReaderArticle = {
  id: number;
  url: string;
  title: string | null;
  source: string | null;
  source_type: string;
  channel_id: string | null;
  published_at: string | null;
  status: string;
  extraction_tier: string | null;
  error: string | null;
  updated_at: string;
  summary: NewsReaderArticleSummary | null;
};

const LOG_TAIL_MAX = 12_000;
const DEFAULT_MODEL = process.env.OLLAMA_MODEL?.trim() || "llama3.2";
const DEFAULT_OLLAMA_HOST =
  process.env.OLLAMA_HOST?.trim().replace(/\/$/, "") || "http://127.0.0.1:11434";

let lastJob: NewsReaderJob | null = null;
let activeChild: ChildProcess | null = null;

export function resolveNewsReaderRepoRoot(): string {
  if (process.env.TRADEHOLE_ROOT?.trim()) {
    return path.resolve(process.env.TRADEHOLE_ROOT.trim());
  }
  const candidates = [process.cwd(), path.resolve(process.cwd(), "..")];
  for (const c of candidates) {
    if (
      fs.existsSync(path.join(c, "news_reader")) &&
      fs.existsSync(path.join(c, "package.json"))
    ) {
      return c;
    }
  }
  return process.cwd();
}

function pythonPath(root: string): string | null {
  const candidates = [
    path.join(root, ".venv", "bin", "python"),
    path.join(root, ".venv", "bin", "python3"),
    path.join(root, ".venv", "Scripts", "python.exe"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function dbPath(root: string): string {
  const env = process.env.NEWS_READER_DB?.trim();
  if (env) return path.resolve(env);
  return path.join(root, "news_reader", "news_reader.db");
}

function telethonConfigured(): boolean {
  const id = process.env.TELEGRAM_API_ID?.trim();
  const hash = process.env.TELEGRAM_API_HASH?.trim();
  return Boolean(id && hash && /^\d+$/.test(id));
}

function emptyCounts(): NewsReaderCounts {
  return { pending: 0, extracted: 0, summarized: 0, failed: 0, total: 0 };
}

function readCounts(dbFile: string): {
  counts: NewsReaderCounts;
  lastUpdatedAt: string | null;
} {
  if (!fs.existsSync(dbFile)) {
    return { counts: emptyCounts(), lastUpdatedAt: null };
  }
  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(dbFile, { readOnly: true });
    const counts = emptyCounts();
    const rows = database
      .prepare(
        `SELECT status, COUNT(*) AS n FROM articles GROUP BY status`,
      )
      .all() as Array<{ status: string; n: number | bigint }>;
    for (const row of rows) {
      const n = Number(row.n);
      const st = String(row.status);
      if (st === "pending") counts.pending = n;
      else if (st === "extracted") counts.extracted = n;
      else if (st === "summarized") counts.summarized = n;
      else if (st === "failed") counts.failed = n;
      counts.total += n;
    }
    const last = database
      .prepare(`SELECT MAX(updated_at) AS ts FROM articles`)
      .get() as { ts: string | null } | undefined;
    return { counts, lastUpdatedAt: last?.ts ?? null };
  } catch {
    return { counts: emptyCounts(), lastUpdatedAt: null };
  } finally {
    try {
      database?.close();
    } catch {
      /* ignore */
    }
  }
}

function parseSummary(raw: string | null): NewsReaderArticleSummary | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (!data || typeof data !== "object") return null;
    const points = data.key_points ?? data.keyPoints;
    const key_points = Array.isArray(points)
      ? points.map((p) => String(p)).filter(Boolean)
      : typeof points === "string"
        ? [points]
        : [];
    const scoreRaw = data.importance_score ?? data.importance ?? 5;
    const score = Math.max(1, Math.min(10, Number(scoreRaw) || 5));
    return {
      key_points,
      primary_topic: String(data.primary_topic ?? data.topic ?? "unknown"),
      sentiment: String(data.sentiment ?? "neutral"),
      importance_score: score,
    };
  } catch {
    return null;
  }
}

export function listNewsReaderArticles(opts?: {
  limit?: number;
  offset?: number;
  status?: string;
  /** World Desk region pack id — filters title/url/source/topic. */
  region?: string;
}): { articles: NewsReaderArticle[]; total: number; region: RegionPackId } {
  const root = resolveNewsReaderRepoRoot();
  const dbFile = dbPath(root);
  const pack = findRegionPack(opts?.region) ?? findRegionPack("all")!;
  const regionId = pack.id;
  if (!fs.existsSync(dbFile)) {
    return { articles: [], total: 0, region: regionId };
  }

  const limit = Math.max(1, Math.min(200, opts?.limit ?? 40));
  const offset = Math.max(0, opts?.offset ?? 0);
  const statusFilter =
    opts?.status && opts.status !== "all" ? opts.status : null;
  const regionFilter = pack.id !== "all";
  // Over-fetch when filtering by region so the page still fills.
  const fetchLimit = regionFilter
    ? Math.min(800, Math.max(limit * 8, limit + offset + 40))
    : limit;
  const fetchOffset = regionFilter ? 0 : offset;

  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(dbFile, { readOnly: true });
    const where = statusFilter ? `WHERE status = ?` : "";
    const countRow = database
      .prepare(`SELECT COUNT(*) AS n FROM articles ${where}`)
      .get(...(statusFilter ? [statusFilter] : [])) as { n: number | bigint };
    const dbTotal = Number(countRow?.n ?? 0);

    // Summarized first, then by importance in JSON when present, then updated_at
    const rows = database
      .prepare(
        `
        SELECT id, url, title, source, source_type, channel_id, published_at,
               status, extraction_tier, error, updated_at, summary_json
        FROM articles
        ${where}
        ORDER BY
          CASE status
            WHEN 'summarized' THEN 0
            WHEN 'extracted' THEN 1
            WHEN 'pending' THEN 2
            ELSE 3
          END,
          updated_at DESC
        LIMIT ? OFFSET ?
        `,
      )
      .all(
        ...(statusFilter
          ? [statusFilter, fetchLimit, fetchOffset]
          : [fetchLimit, fetchOffset]),
      ) as Array<{
      id: number | bigint;
      url: string;
      title: string | null;
      source: string | null;
      source_type: string;
      channel_id: string | null;
      published_at: string | null;
      status: string;
      extraction_tier: string | null;
      error: string | null;
      updated_at: string;
      summary_json: string | null;
    }>;

    let articles = rows.map((r) => ({
      id: Number(r.id),
      url: r.url,
      title: r.title,
      source: r.source,
      source_type: r.source_type,
      channel_id: r.channel_id,
      published_at: r.published_at,
      status: r.status,
      extraction_tier: r.extraction_tier,
      error: r.error,
      updated_at: r.updated_at,
      summary: parseSummary(r.summary_json),
    }));

    // Prefer higher importance among summarized when no status filter
    if (!statusFilter) {
      articles.sort((a, b) => {
        const rank = (s: string) =>
          s === "summarized" ? 0 : s === "extracted" ? 1 : s === "pending" ? 2 : 3;
        const dr = rank(a.status) - rank(b.status);
        if (dr !== 0) return dr;
        const ia = a.summary?.importance_score ?? 0;
        const ib = b.summary?.importance_score ?? 0;
        if (ib !== ia) return ib - ia;
        return b.updated_at.localeCompare(a.updated_at);
      });
    }

    if (regionFilter) {
      articles = articles.filter((a) =>
        articleMatchesRegionPack(pack, {
          title: a.title,
          url: a.url,
          source: a.source,
          channelId: a.channel_id,
          topic: a.summary?.primary_topic,
        }),
      );
      const total = articles.length;
      const sliced = articles.slice(offset, offset + limit);
      return { articles: sliced, total, region: regionId };
    }

    return { articles, total: dbTotal, region: regionId };
  } catch {
    return { articles: [], total: 0, region: regionId };
  } finally {
    try {
      database?.close();
    } catch {
      /* ignore */
    }
  }
}

export function listNewsReaderRegionPacks() {
  return listRegionPacks().map((p) => ({
    id: p.id,
    label: p.label,
    short: p.short,
    layers: p.layers,
  }));
}

export function exportNewsReaderDigests(opts?: {
  limit?: number;
  status?: string;
}): { generatedAt: string; count: number; articles: NewsReaderArticle[] } {
  const status = opts?.status ?? "summarized";
  const { articles } = listNewsReaderArticles({
    limit: opts?.limit ?? 100,
    offset: 0,
    status,
  });
  return {
    generatedAt: new Date().toISOString(),
    count: articles.length,
    articles,
  };
}

async function probeOllama(): Promise<NewsReaderStatus["ollama"]> {
  const host = DEFAULT_OLLAMA_HOST;
  const model = DEFAULT_MODEL;
  try {
    const res = await fetch(`${host}/api/tags`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) {
      return {
        up: false,
        host,
        model,
        models: [],
        error: `HTTP ${res.status}`,
      };
    }
    const body = (await res.json()) as {
      models?: Array<{ name?: string }>;
    };
    const models = (body.models ?? [])
      .map((m) => m.name)
      .filter((n): n is string => Boolean(n));
    return { up: true, host, model, models, error: null };
  } catch (err) {
    return {
      up: false,
      host,
      model,
      models: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getNewsReaderStatus(): Promise<NewsReaderStatus> {
  const root = resolveNewsReaderRepoRoot();
  const py = pythonPath(root);
  const dbFile = dbPath(root);
  const { counts, lastUpdatedAt } = readCounts(dbFile);
  const ollama = await probeOllama();
  const job = lastJob
    ? { ...lastJob, logTail: sanitizeLogChunk(lastJob.logTail) }
    : null;
  return {
    ok: Boolean(py) && fs.existsSync(path.join(root, "news_reader")),
    repoRoot: root,
    venvOk: Boolean(py),
    pythonPath: py,
    dbPath: dbFile,
    dbExists: fs.existsSync(dbFile),
    counts,
    lastUpdatedAt,
    ollama,
    job,
    telethonConfigured: telethonConfigured(),
  };
}

function resolveTelegramMode(
  requested: NewsReaderTelegramMode | undefined,
): NewsReaderTelegramMode {
  // Never Telethon unless credentials exist — UI may ask; we clamp.
  const want = requested ?? "web";
  if (want === "web") return "web";
  if (!telethonConfigured()) return "web";
  return want;
}

function buildCliArgs(opts: {
  stage: NewsReaderStage;
  limit: number | null;
  summarizeLimit: number | null;
  telegramMode: NewsReaderTelegramMode;
  model: string | null;
}): string[] {
  const args = ["-m", "news_reader.main"];
  switch (opts.stage) {
    case "all":
      args.push("--run-all");
      break;
    case "ingest":
      args.push("--ingest");
      break;
    case "extract":
      args.push("--extract");
      break;
    case "summarize":
      args.push("--summarize");
      break;
  }
  args.push("--telegram-mode", opts.telegramMode);
  // limit: null = omit (CLI defaults unlimited for that stage);
  // 0 = explicit unlimited; >0 = capped
  if (opts.limit != null && Number.isFinite(opts.limit)) {
    if (opts.stage === "all") {
      args.push("--extract-limit", String(Math.floor(opts.limit)));
    } else if (opts.stage !== "ingest") {
      args.push("--limit", String(Math.floor(opts.limit)));
    }
  }
  if (
    opts.summarizeLimit != null &&
    Number.isFinite(opts.summarizeLimit) &&
    (opts.stage === "all" || opts.stage === "summarize")
  ) {
    if (opts.stage === "all") {
      args.push("--summarize-limit", String(Math.floor(opts.summarizeLimit)));
    } else {
      args.push("--limit", String(Math.floor(opts.summarizeLimit)));
    }
  }
  const model = opts.model?.trim() || DEFAULT_MODEL;
  if (model) args.push("--model", model);
  return args;
}

function sanitizeLogChunk(chunk: string): string {
  // Keep newlines/tabs; drop other C0 controls that break JSON clients.
  return chunk.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function appendLog(job: NewsReaderJob, chunk: string): void {
  job.logTail = (job.logTail + sanitizeLogChunk(chunk)).slice(-LOG_TAIL_MAX);
}

/** Clamp API limit: 0 = unlimited; positive capped at 10_000. */
function clampLimit(raw: unknown, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.max(0, Math.min(10_000, Math.floor(raw)));
}

function runNewsReaderProcess(opts: {
  stage: NewsReaderStage;
  limit: number | null;
  summarizeLimit: number | null;
  telegramMode: NewsReaderTelegramMode;
  model: string | null;
}): Promise<NewsReaderJob> {
  const root = resolveNewsReaderRepoRoot();
  const py = pythonPath(root);
  if (!py) {
    const job: NewsReaderJob = {
      id: `nr-${Date.now()}`,
      running: false,
      stage: opts.stage,
      limit: opts.limit,
      summarizeLimit: opts.summarizeLimit,
      telegramMode: opts.telegramMode,
      model: opts.model,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      exitCode: 127,
      error: "Python venv not found (.venv/bin/python)",
      logTail: "",
      command: [],
    };
    lastJob = job;
    return Promise.resolve(job);
  }

  const cliArgs = buildCliArgs(opts);
  const job: NewsReaderJob = {
    id: `nr-${Date.now()}`,
    running: true,
    stage: opts.stage,
    limit: opts.limit,
    summarizeLimit: opts.summarizeLimit,
    telegramMode: opts.telegramMode,
    model: opts.model ?? DEFAULT_MODEL,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    error: null,
    logTail: "",
    command: [py, ...cliArgs],
  };
  lastJob = job;

  return new Promise((resolve) => {
    const child = spawn(py, cliArgs, {
      cwd: root,
      env: {
        ...process.env,
        OLLAMA_HOST: DEFAULT_OLLAMA_HOST,
        OLLAMA_MODEL: opts.model?.trim() || DEFAULT_MODEL,
        PYTHONUNBUFFERED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChild = child;

    child.stdout.on("data", (buf: Buffer) => {
      appendLog(job, buf.toString("utf8"));
    });
    child.stderr.on("data", (buf: Buffer) => {
      appendLog(job, buf.toString("utf8"));
    });

    child.on("error", (err) => {
      job.running = false;
      job.finishedAt = new Date().toISOString();
      job.exitCode = 1;
      job.error = err.message;
      appendLog(job, `\n[spawn error] ${err.message}\n`);
      if (activeChild === child) activeChild = null;
      lastJob = { ...job };
      resolve(job);
    });

    child.on("close", (code) => {
      job.running = false;
      job.finishedAt = new Date().toISOString();
      job.exitCode = code ?? 1;
      if (code !== 0 && !job.error) {
        job.error = `news_reader exited with code ${code}`;
      }
      if (activeChild === child) activeChild = null;
      lastJob = { ...job };
      resolve(job);
    });
  });
}

export type NewsReaderRunRequest = {
  stages?: NewsReaderStage;
  /** Extract/stage limit. 0 = unlimited. Max 10_000. */
  limit?: number;
  /** Summarize batch when stage is "all" (keeps local LLM jobs finite). */
  summarizeLimit?: number;
  telegramMode?: NewsReaderTelegramMode;
  model?: string;
};

/**
 * Start a pipeline run without awaiting completion.
 * Poll GET /api/news-reader/status (or /job) for progress + logTail.
 */
export function startNewsReaderRun(
  body: NewsReaderRunRequest,
): { accepted: boolean; job: NewsReaderJob } {
  if (lastJob?.running) {
    return { accepted: false, job: lastJob };
  }

  const stage: NewsReaderStage =
    body.stages === "ingest" ||
    body.stages === "extract" ||
    body.stages === "summarize" ||
    body.stages === "all"
      ? body.stages
      : "all";
  const limit = clampLimit(body.limit, 100);
  const summarizeLimit = clampLimit(
    body.summarizeLimit,
    stage === "all" ? 100 : limit,
  );
  const telegramMode = resolveTelegramMode(body.telegramMode);
  const model = body.model?.trim() || DEFAULT_MODEL;

  void runNewsReaderProcess({
    stage,
    limit: stage === "ingest" ? null : limit,
    summarizeLimit:
      stage === "all" || stage === "summarize" ? summarizeLimit : null,
    telegramMode,
    model,
  });

  return { accepted: true, job: lastJob! };
}

export function getNewsReaderJob(): NewsReaderJob | null {
  return lastJob;
}
