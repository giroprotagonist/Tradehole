import { useState } from "react";
import { getApiBase } from "../services/api";

type NewsItem = {
  title: string;
  link: string;
  source?: string;
  pubDate?: string;
  category?: string;
};

type Props = {
  /** Show on IRONSIGHT tab primarily */
  compact?: boolean;
};

export function CopyIronsightNewsButton({ compact }: Props) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function handleCopy() {
    setBusy(true);
    setStatus("Fetching IRONSIGHT news…");
    try {
      const base = await getApiBase();
      const res = await fetch(`${base}/api/ironsight/news-blast`);
      const data = (await res.json()) as {
        error?: string;
        count?: number;
        links?: string[];
        articles?: NewsItem[];
        byPanel?: Record<string, number>;
        json?: string;
        generatedAt?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      const payload =
        data.json ??
        JSON.stringify(
          {
            generatedAt: data.generatedAt,
            count: data.count,
            links: data.links,
            articles: data.articles,
          },
          null,
          2,
        );

      await navigator.clipboard.writeText(payload);
      const byPanel =
        data.byPanel && typeof data.byPanel === "object"
          ? Object.entries(data.byPanel as Record<string, number>)
              .map(([k, v]) => `${k}:${v}`)
              .join(" · ")
          : null;
      setStatus(
        byPanel
          ? `Copied ${data.count ?? 0} links (${byPanel})`
          : `Copied ${data.count ?? 0} links as JSON`,
      );
    } catch (err) {
      setStatus(`Failed: ${String(err)}`);
    } finally {
      setBusy(false);
      window.setTimeout(() => setStatus(null), 8000);
    }
  }

  return (
    <div className="dossier-actions">
      <button
        type="button"
        className={compact ? "ghost" : "primary"}
        disabled={busy}
        onClick={() => void handleCopy()}
        title="Copy all clickable IRONSIGHT links (news, telegram, strikes, regional alerts)"
      >
        {busy ? "Fetching links…" : "Copy IRONSIGHT links JSON"}
      </button>
      {status && <span className="dossier-status">{status}</span>}
    </div>
  );
}
