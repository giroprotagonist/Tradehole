import { useState } from "react";
import { copyText } from "../lib/clipboard";
import {
  downloadAiBundle,
  downloadDeepSeekMarkdown,
  fetchAiPack,
  fetchDeepSeekPaste,
  fetchLlmDossier,
  fetchOsintPack,
  readAisExportOpts,
} from "../services/api";

type Props = {
  symbol?: string;
};

function formatChars(n: number): string {
  return n.toLocaleString();
}

export function CopyDossierButton({ symbol = "FRO" }: Props) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function handleDeepSeekPaste(mode: "copy" | "download" | "both") {
    setBusy(true);
    setOpen(false);
    setStatus("Building DeepSeek paste…");
    try {
      const ais = readAisExportOpts();
      const pack = await fetchDeepSeekPaste(symbol, ais);
      if (mode === "copy" || mode === "both") {
        await copyText(pack.markdown);
      }
      if (mode === "download" || mode === "both") {
        downloadDeepSeekMarkdown(pack.markdown, symbol);
      }
      const warn = pack.softWarn
        ? ` · soft warn (≥${formatChars(pack.softWarnChars)} or truncated)`
        : "";
      const trunc = pack.truncated ? " · truncated" : "";
      if (mode === "download") {
        setStatus(
          `Downloaded DeepSeek .md · ${formatChars(pack.chars)} chars (~${formatChars(pack.tokensEstimate)} tok)${trunc}${warn}`,
        );
      } else {
        setStatus(
          `Copied ${formatChars(pack.chars)} chars (~${formatChars(pack.tokensEstimate)} tok)${trunc}${warn}${mode === "both" ? " · .md saved" : ""}`,
        );
      }
    } catch (err) {
      setStatus(`Failed: ${String(err)}`);
    } finally {
      setBusy(false);
      window.setTimeout(() => setStatus(null), 14000);
    }
  }

  async function handleExportOsint() {
    setBusy(true);
    setOpen(false);
    setStatus("Building OSINT 7-bucket pack…");
    try {
      const ais = readAisExportOpts();
      const pack = await fetchOsintPack(symbol, ais);
      await copyText(pack.markdown);
      const kb = Math.round(pack.byteLength / 1024);
      const failed = Object.entries(pack.sources)
        .filter(([, v]) => v === "error")
        .map(([k]) => k);
      setStatus(
        failed.length
          ? `Copied OSINT pack ${kb} KB (${failed.length} gap(s): ${failed.join(", ")})`
          : `Copied OSINT pack ${kb} KB · large paste — prefer DeepSeek paste for web UI`,
      );
    } catch (err) {
      setStatus(`Failed: ${String(err)}`);
    } finally {
      setBusy(false);
      window.setTimeout(() => setStatus(null), 12000);
    }
  }

  async function handleExportEverything(mode: "copy" | "zip") {
    setBusy(true);
    setOpen(false);
    setStatus(
      mode === "copy"
        ? "Building EVERYTHING pack for AI…"
        : "Building EVERYTHING ZIP…",
    );
    try {
      const ais = readAisExportOpts();
      if (mode === "copy") {
        const pack = await fetchAiPack(symbol, ais);
        await copyText(pack.text);
        const kb = Math.round(pack.byteLength / 1024);
        setStatus(
          `Copied EVERYTHING ${kb} KB · ${pack.files.length} files (prefer ZIP / DeepSeek paste for web UI)`,
        );
      } else {
        await downloadAiBundle(symbol, ais);
        setStatus("Downloaded tradehole-everything.zip");
      }
    } catch (err) {
      setStatus(`Failed: ${String(err)}`);
    } finally {
      setBusy(false);
      window.setTimeout(() => setStatus(null), 12000);
    }
  }

  async function handleCopyDossier() {
    setBusy(true);
    setOpen(false);
    setStatus("Building dossier only…");
    try {
      const dossier = await fetchLlmDossier(symbol);
      await copyText(dossier.text);
      const kb = Math.round(dossier.byteLength / 1024);
      const failed = Object.entries(dossier.sources)
        .filter(([, v]) => v === "error")
        .map(([k]) => k);
      setStatus(
        failed.length
          ? `Copied dossier ${kb} KB (${failed.length} source(s) failed: ${failed.join(", ")})`
          : `Copied dossier ${kb} KB · all sources OK`,
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
      <div className="export-menu">
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => void handleDeepSeekPaste("copy")}
          title="Copy size-capped DeepSeek paste for free web UI (~30k chars). Use full Export for AI / ZIP for complete packs."
        >
          {busy ? "Building…" : "DeepSeek paste"}
        </button>
        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={() => setOpen((v) => !v)}
          title="More export options"
          aria-expanded={open}
        >
          ▾
        </button>
        {open && (
          <div className="export-dropdown">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleDeepSeekPaste("copy")}
            >
              Copy DeepSeek paste (web UI)
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleDeepSeekPaste("download")}
            >
              Download DeepSeek .md
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleDeepSeekPaste("both")}
            >
              Copy + download DeepSeek
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleExportOsint()}
              title="Large clipboard — prefer DeepSeek paste for web UI"
            >
              Export for AI (full OSINT)
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleExportEverything("copy")}
            >
              Copy EVERYTHING for AI
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleExportEverything("zip")}
            >
              Download EVERYTHING (.zip)
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleCopyDossier()}
            >
              Copy dossier only
            </button>
          </div>
        )}
      </div>
      {status && (
        <span
          className={`dossier-status${status.includes("soft warn") || status.includes("truncated") ? " dossier-status-warn" : ""}`}
          title={status}
        >
          {status}
        </span>
      )}
      <span className="dossier-hint muted tiny">
        DeepSeek paste for web UI; full pack for ZIP
      </span>
    </div>
  );
}
