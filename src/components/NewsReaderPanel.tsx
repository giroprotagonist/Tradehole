import { useCallback, useEffect, useState } from "react";
import {
  fetchNewsReaderArticles,
  fetchNewsReaderRegions,
  fetchNewsReaderStatus,
  runNewsReader,
} from "../services/api";
import type {
  NewsReaderArticle,
  NewsReaderRegionPack,
  NewsReaderStage,
  NewsReaderStatus,
} from "../types";

const DEFAULT_LIMIT = 100;
const LIMIT_PRESETS = [100, 500, 2000, 10_000] as const;
const BULK_SUMMARIZE_BATCH = 150;

const FALLBACK_PACKS: NewsReaderRegionPack[] = [
  {
    id: "all",
    label: "All desks",
    short: "All",
    layers: "Unfiltered archive",
  },
  {
    id: "levant",
    label: "Levant board",
    short: "Levant",
    layers: "Lebanon · Gaza · Golan · Syria · Jordan · Israel",
  },
  {
    id: "iran_gulf",
    label: "Iran / Gulf",
    short: "Iran–Gulf",
    layers: "Hormuz · Iran · Iraq",
  },
  {
    id: "red_sea_horn",
    label: "Red Sea / Horn",
    short: "Red Sea",
    layers: "Houthi · Bab · Yemen",
  },
  {
    id: "ukraine_europe",
    label: "Ukraine / Europe",
    short: "UA–EU",
    layers: "Ukraine · Black Sea · Europe energy",
  },
  {
    id: "africa",
    label: "Africa / Cape freight",
    short: "Africa",
    layers: "Somalia · Cape route",
  },
  {
    id: "energy_macro",
    label: "Energy / macro",
    short: "Energy",
    layers: "Oil · LNG · Fed",
  },
];

const GROW_HINT =
  "RSS only has recent items; use theme Google News / historical windows to grow past ~2k";

function parseIngestInserted(log: string | undefined): number | null {
  if (!log) return null;
  const matches = [...log.matchAll(/feeds:\s*inserted\s+(\d+)\s+new URLs/gi)];
  if (!matches.length) return null;
  return Number(matches[matches.length - 1]?.[1] ?? NaN);
}

function importanceClass(score: number | undefined): string {
  if (score == null) return "";
  if (score >= 8) return "nr-imp-high";
  if (score >= 5) return "nr-imp-mid";
  return "nr-imp-low";
}

export function NewsReaderPanel() {
  const [status, setStatus] = useState<NewsReaderStatus | null>(null);
  const [articles, setArticles] = useState<NewsReaderArticle[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [region, setRegion] = useState("all");
  const [packs, setPacks] = useState<NewsReaderRegionPack[]>(FALLBACK_PACKS);

  const refresh = useCallback(async () => {
    try {
      const [st, list] = await Promise.all([
        fetchNewsReaderStatus(),
        fetchNewsReaderArticles({ limit: 50, region }),
      ]);
      setStatus(st);
      setArticles(list.articles);
      setTotal(list.total);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, [region]);

  useEffect(() => {
    void fetchNewsReaderRegions()
      .then((r) => {
        if (r.packs?.length) setPacks(r.packs);
      })
      .catch(() => {
        /* keep fallback */
      });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const running = status?.job?.running;
    const ms = running ? 2_000 : 20_000;
    const id = window.setInterval(() => void refresh(), ms);
    return () => window.clearInterval(id);
  }, [refresh, status?.job?.running]);

  const run = useCallback(
    async (
      stages: NewsReaderStage,
      opts?: { limit?: number; summarizeLimit?: number },
    ) => {
      setBusy(true);
      setShowLog(true);
      try {
        await runNewsReader({
          stages,
          limit: opts?.limit ?? limit,
          summarizeLimit: opts?.summarizeLimit,
          telegramMode: "web",
          model: status?.ollama.model,
        });
        await refresh();
      } catch (err) {
        setError(String(err));
      } finally {
        setBusy(false);
      }
    },
    [limit, refresh, status?.ollama.model],
  );

  const bulkSuck = useCallback(async () => {
    // Ingest all feeds/TG, extract up to selected limit, summarize a finite batch
    // so the UI does not block for hours on local LLM.
    await run("all", {
      limit: Math.max(limit, 2000),
      summarizeLimit: BULK_SUMMARIZE_BATCH,
    });
  }, [limit, run]);

  const counts = status?.counts;
  const job = status?.job;
  const ollamaUp = status?.ollama.up ?? false;
  const venvOk = status?.venvOk ?? false;
  const controlsLocked = !venvOk || busy || Boolean(job?.running);
  const ingestInserted = parseIngestInserted(job?.logTail);
  const showGrowHint =
    !job?.running &&
    ingestInserted != null &&
    ingestInserted < 25 &&
    (job?.stage === "ingest" || job?.stage === "all") &&
    (counts?.total ?? 0) > 500;
  const extractedWaiting = counts?.extracted ?? 0;
  const activePack = packs.find((p) => p.id === region) ?? packs[0];

  return (
    <section className="panel news-reader-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">World Desk · local digests</p>
          <h2>News Reader</h2>
          <p className="muted tiny">
            RSS + Google News theme packs + Telegram web → extract → Ollama
            summaries. Region tabs cut the archive into desks — not one giant
            noisy feed.
          </p>
        </div>
        <button type="button" className="ghost" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>

      <div className="nr-region-tabs" role="tablist" aria-label="World Desk region">
        {packs.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={region === p.id}
            className={region === p.id ? "nr-region on" : "nr-region"}
            title={p.layers}
            onClick={() => setRegion(p.id)}
          >
            {p.short}
          </button>
        ))}
      </div>
      {activePack && (
        <p className="muted tiny nr-region-hint">{activePack.layers}</p>
      )}

      {!ollamaUp && (
        <p className="banner error nr-banner">
          Ollama offline — Summarize needs a local model at{" "}
          {status?.ollama.host ?? "http://127.0.0.1:11434"}. Install with{" "}
          <code>brew install ollama</code>, then{" "}
          <code>brew services start ollama</code> and{" "}
          <code>ollama pull {status?.ollama.model ?? "llama3.2"}</code>.
        </p>
      )}

      {!venvOk && (
        <p className="banner error nr-banner">
          Python venv missing — expected{" "}
          <code>.venv/bin/python</code> at repo root with{" "}
          <code>news_reader</code> installed.
        </p>
      )}

      {error && <p className="error">{error}</p>}

      <div className="nr-status-strip">
        <span className={ollamaUp ? "nr-pill on" : "nr-pill"}>
          Ollama {ollamaUp ? "up" : "down"}
        </span>
        <span className={venvOk ? "nr-pill on" : "nr-pill"}>
          venv {venvOk ? "ok" : "missing"}
        </span>
        <span className="nr-pill">
          pending {counts?.pending ?? 0}
        </span>
        <span className="nr-pill">
          extracted {counts?.extracted ?? 0}
        </span>
        <span className="nr-pill">
          summarized {counts?.summarized ?? 0}
        </span>
        <span className="nr-pill">
          failed {counts?.failed ?? 0}
        </span>
        <span className="nr-pill">
          total {counts?.total ?? 0}
        </span>
        <span className="muted tiny nr-last">
          {job?.running
            ? `Running ${job.stage}…`
            : job?.finishedAt
              ? `Last run ${new Date(job.finishedAt).toLocaleString()}${
                  job.exitCode != null ? ` · exit ${job.exitCode}` : ""
                }${
                  ingestInserted != null
                    ? ` · ingest +${ingestInserted}`
                    : ""
                }`
              : status?.lastUpdatedAt
                ? `DB updated ${new Date(status.lastUpdatedAt).toLocaleString()}`
                : "No runs yet"}
        </span>
      </div>

      {showGrowHint && (
        <p className="muted tiny nr-warn nr-grow-hint">{GROW_HINT}</p>
      )}

      <div className="nr-controls">
        <label className="nr-limit">
          Limit
          <input
            type="number"
            min={0}
            max={10_000}
            value={limit}
            disabled={controlsLocked}
            title="0 = unlimited extract/summarize"
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setLimit(Math.max(0, Math.min(10_000, n)));
            }}
          />
        </label>
        <div className="nr-presets" role="group" aria-label="Limit presets">
          {LIMIT_PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              className={limit === n ? "ghost nr-preset on" : "ghost nr-preset"}
              disabled={controlsLocked}
              onClick={() => setLimit(n)}
            >
              {n >= 1000 ? `${n / 1000}k` : n}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="ghost"
          disabled={controlsLocked}
          onClick={() => void run("all")}
        >
          Run all
        </button>
        <button
          type="button"
          className="ghost nr-bulk"
          disabled={controlsLocked}
          title={`Ingest + extract (limit ${Math.max(limit, 2000)}) + summarize ${BULK_SUMMARIZE_BATCH}. Full 10k summaries take hours on local LLM.`}
          onClick={() => void bulkSuck()}
        >
          Bulk suck
        </button>
        <button
          type="button"
          className="ghost"
          disabled={controlsLocked}
          onClick={() => void run("ingest")}
        >
          Ingest
        </button>
        <button
          type="button"
          className="ghost"
          disabled={controlsLocked}
          onClick={() => void run("extract")}
        >
          Extract
        </button>
        <button
          type="button"
          className="ghost"
          disabled={!ollamaUp || controlsLocked}
          onClick={() => void run("summarize")}
          title={!ollamaUp ? "Ollama must be running" : undefined}
        >
          Summarize
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => setShowLog((v) => !v)}
        >
          {showLog ? "Hide log" : "Show log"}
        </button>
      </div>

      {(limit >= 500 || extractedWaiting > BULK_SUMMARIZE_BATCH) && (
        <p className="muted tiny nr-warn">
          Extract can run to thousands; Summarize stays batched (~
          {BULK_SUMMARIZE_BATCH}/run on Bulk suck) so local Ollama stays
          usable. Hit Summarize again to drain the extracted queue
          {extractedWaiting > 0 ? ` (${extractedWaiting} waiting)` : ""}.
          Full 10k LLM digests take many hours — not required to grow the
          archive.
        </p>
      )}

      {showLog && (
        <pre className="nr-log">
          {job?.logTail?.trim() || "(no log yet)"}
        </pre>
      )}

      {job?.error && !job.running && (
        <p className="error tiny">{job.error}</p>
      )}

      <div className="nr-list-head">
        <p className="eyebrow">
          {activePack?.short ?? "Articles"} · {articles.length}
          {total > articles.length ? ` of ${total}` : ""}
        </p>
      </div>

      {articles.length === 0 ? (
        <p className="muted">
          No articles
          {region !== "all" ? ` for ${activePack?.label ?? region}` : " yet"}.
          {region === "all" ? (
            <>
              {" "}
              Hit <strong>Bulk suck</strong> or <strong>Ingest</strong> to pull
              feeds + Telegram web.
            </>
          ) : (
            <> Try another desk tab, or ingest more theme windows.</>
          )}
        </p>
      ) : (
        <ul className="nr-articles">
          {articles.map((a) => {
            const imp = a.summary?.importance_score;
            return (
              <li key={a.id} className={`nr-article ${importanceClass(imp)}`}>
                <div className="nr-article-top">
                  <span className={`nr-status st-${a.status}`}>{a.status}</span>
                  {imp != null && (
                    <span className="nr-score" title="Importance">
                      {imp}/10
                    </span>
                  )}
                  {a.summary?.primary_topic && (
                    <span className="nr-topic">{a.summary.primary_topic}</span>
                  )}
                  {a.summary?.sentiment && (
                    <span className="muted tiny">{a.summary.sentiment}</span>
                  )}
                </div>
                <h3>
                  {a.url ? (
                    <a href={a.url} target="_blank" rel="noreferrer">
                      {a.title || a.url}
                    </a>
                  ) : (
                    a.title || "(untitled)"
                  )}
                </h3>
                <p className="muted tiny">
                  {[a.source || a.channel_id, a.source_type, a.published_at]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {a.summary?.key_points?.length ? (
                  <ul className="nr-points">
                    {a.summary.key_points.slice(0, 6).map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                ) : a.error ? (
                  <p className="error tiny">{a.error}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
