import { useState } from "react";
import { copyText } from "../lib/clipboard";
import { downloadNewsPack, getApiBase } from "../services/api";

type Props = {
  /** Show on IRONSIGHT tab primarily */
  compact?: boolean;
};

type Busy = "links" | "pack" | null;

export function CopyIronsightNewsButton({ compact }: Props) {
  const [busy, setBusy] = useState<Busy>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function handleCopy() {
    setBusy("links");
    setStatus("Fetching both theaters…");
    try {
      const base = await getApiBase();
      // Default: both iran-israel + russia-ukraine
      const res = await fetch(`${base}/api/ironsight/news-blast?conflict=all`);
      const data = (await res.json()) as {
        error?: string;
        count?: number;
        links?: string[];
        articles?: unknown[];
        byPanel?: Record<string, number>;
        byConflict?: Record<string, number>;
        conflicts?: string[];
        json?: string;
        generatedAt?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      const payload =
        data.json ??
        JSON.stringify(
          {
            generatedAt: data.generatedAt,
            conflicts: data.conflicts,
            count: data.count,
            byConflict: data.byConflict,
            byPanel: data.byPanel,
            links: data.links,
            articles: data.articles,
          },
          null,
          2,
        );

      await copyText(payload);
      const theaters =
        data.byConflict && typeof data.byConflict === "object"
          ? Object.entries(data.byConflict)
              .map(([k, v]) => `${k}:${v}`)
              .join(" · ")
          : (data.conflicts ?? []).join(" + ");
      setStatus(`Copied ${data.count ?? 0} links (${theaters})`);
    } catch (err) {
      setStatus(`Failed: ${String(err)}`);
    } finally {
      setBusy(null);
      window.setTimeout(() => setStatus(null), 10_000);
    }
  }

  async function handleNewsPack() {
    setBusy("pack");
    setStatus(
      "Building news pack (RSS + article bodies + ROBUST Telegram dump — may take a few min)…",
    );
    try {
      const stats = await downloadNewsPack({
        conflict: "all",
        fetchLimit: 100,
        telegram: "robust",
      });
      setStatus(
        `Downloaded news pack · ${stats.articles} articles · tg=${stats.telegram} (${stats.telegramMode}) · bodies ok=${stats.fetchedOk} fail=${stats.fetchedFail}`,
      );
    } catch (err) {
      setStatus(`Failed: ${String(err)}`);
    } finally {
      setBusy(null);
      window.setTimeout(() => setStatus(null), 14_000);
    }
  }

  return (
    <div className="dossier-actions">
      <button
        type="button"
        className={compact ? "ghost" : "primary"}
        disabled={busy != null}
        onClick={() => void handleCopy()}
        title="Copy clickable links from both IRONSIGHT theaters (Iran–Israel + Russia–Ukraine)"
      >
        {busy === "links" ? "Fetching…" : "Copy links"}
      </button>
      <button
        type="button"
        className="ghost"
        disabled={busy != null}
        onClick={() => void handleNewsPack()}
        title="Download ZIP: IRONSIGHT news (RSS + body fetch) + ROBUST Telegram dump (full toolkit 30d/500/40 + broad + RU). May take a few minutes."
      >
        {busy === "pack" ? "Packing…" : "News pack"}
      </button>
      {status && <span className="dossier-status">{status}</span>}
    </div>
  );
}
