import { useState } from "react";
import { getApiBase } from "../services/api";

type Props = {
  /** Show on IRONSIGHT tab primarily */
  compact?: boolean;
};

export function CopyIronsightNewsButton({ compact }: Props) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function handleCopy() {
    setBusy(true);
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

      await navigator.clipboard.writeText(payload);
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
      setBusy(false);
      window.setTimeout(() => setStatus(null), 10_000);
    }
  }

  return (
    <div className="dossier-actions">
      <button
        type="button"
        className={compact ? "ghost" : "primary"}
        disabled={busy}
        onClick={() => void handleCopy()}
        title="Copy clickable links from both IRONSIGHT theaters (Iran–Israel + Russia–Ukraine)"
      >
        {busy ? "Fetching links…" : "Copy IRONSIGHT links JSON"}
      </button>
      {status && <span className="dossier-status">{status}</span>}
    </div>
  );
}
