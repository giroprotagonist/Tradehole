import { useState } from "react";
import { fetchLlmDossier } from "../services/api";

type Props = {
  symbol?: string;
};

export function CopyDossierButton({ symbol = "FRO" }: Props) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function handleCopy() {
    setBusy(true);
    setStatus("Building full dossier…");
    try {
      const dossier = await fetchLlmDossier(symbol);
      await navigator.clipboard.writeText(dossier.text);
      const kb = Math.round(dossier.byteLength / 1024);
      const failed = Object.entries(dossier.sources)
        .filter(([, v]) => v === "error")
        .map(([k]) => k);
      setStatus(
        failed.length
          ? `Copied ${kb} KB (${failed.length} source(s) failed: ${failed.join(", ")})`
          : `Copied ${kb} KB · all sources OK`,
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
        className="primary"
        disabled={busy}
        onClick={() => void handleCopy()}
        title="Copy every available FRO data field into the clipboard as one LLM-ready text packet"
      >
        {busy ? "Building dossier…" : "Copy LLM dossier"}
      </button>
      {status && <span className="dossier-status">{status}</span>}
    </div>
  );
}
