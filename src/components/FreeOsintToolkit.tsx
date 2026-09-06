import { useCallback, useState } from "react";
import { copyText } from "../lib/clipboard";
import { HORMUZ_TG_TOOLKIT, TELEGRAM_DEEP_DUMP_HREF, TELEGRAM_ROBUST_DUMP_HREF } from "../lib/hormuzTelegramChannels";
import {
  downloadDeepSeekMarkdown,
  fetchDeepSeekPaste,
  readAisExportOpts,
} from "../services/api";

type LinkItem = {
  label: string;
  href: string;
  note: string;
  cost: "free" | "free-tier";
};

const CONFLICT_MAPS: LinkItem[] = [
  {
    label: "Pharos / conflicts.app",
    href: "https://conflicts.app",
    note: "Live Iran conflict map + briefs",
    cost: "free",
  },
  {
    label: "Israel Monitor",
    href: "https://israelmonitor.org",
    note: "ME conflict dashboard",
    cost: "free",
  },
  {
    label: "INSS map",
    href: "https://www.inss.org.il/he/interactive-map/",
    note: "Strategic ME overview",
    cost: "free",
  },
];

const SHIPS: LinkItem[] = [
  {
    label: "MarineTraffic · Hormuz",
    href: "https://www.marinetraffic.com/en/ais/home/centerx:56.25/centery:26.56/zoom:8",
    note: "Live AIS (free tier)",
    cost: "free-tier",
  },
  {
    label: "MyShipTracking",
    href: "https://www.myshiptracking.com/",
    note: "AIS network map",
    cost: "free",
  },
  {
    label: "Global Fishing Watch",
    href: "https://globalfishingwatch.org/map",
    note: "Open vessel activity map",
    cost: "free",
  },
];

const SAT: LinkItem[] = [
  {
    label: "EO Browser (Sentinel)",
    href: "https://apps.sentinel-hub.com/eo-browser/?zoom=7&lat=26.5&lng=56.3&themeId=DEFAULT-THEME",
    note: "ESA Sentinel over Hormuz",
    cost: "free",
  },
  {
    label: "NASA FIRMS fires",
    href: "https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@56.3,26.5,6z",
    note: "Thermal detections (also in IRONSIGHT)",
    cost: "free",
  },
];

const ENERGY: LinkItem[] = [
  {
    label: "EIA oil prices",
    href: "https://www.eia.gov/petroleum/",
    note: "Brent/inventories (also in Tradehole)",
    cost: "free",
  },
  {
    label: "Baltic weekly reprints",
    href: "https://www.theedgemalaysia.com/search?keyword=Baltic%20Exchange",
    note: "Free TD3C / tanker round-ups",
    cost: "free",
  },
];

const TELEGRAM: LinkItem[] = [
  {
    label: "IRONSIGHT ROBUST dump JSON",
    href: TELEGRAM_ROBUST_DUMP_HREF,
    note: "mode=dump · 30d · full toolkit channels · max pages (needs :3170)",
    cost: "free",
  },
  {
    label: "IRONSIGHT deep dump JSON",
    href: TELEGRAM_DEEP_DUMP_HREF,
    note: "mode=dump · 30d · Hormuz priority channels only",
    cost: "free",
  },
  ...HORMUZ_TG_TOOLKIT,
];
async function openExternal(href: string): Promise<void> {
  if (window.tradehole?.openExternal) {
    await window.tradehole.openExternal(href);
    return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
}

function LinkRow({ items }: { items: LinkItem[] }) {
  return (
    <div className="osint-kit-row">
      {items.map((item) => (
        <button
          key={item.href}
          type="button"
          className="osint-kit-link"
          title={`${item.note} · ${item.cost}`}
          onClick={() => void openExternal(item.href)}
        >
          <span className="osint-kit-label">{item.label}</span>
          <span className="osint-kit-note">{item.note}</span>
        </button>
      ))}
    </div>
  );
}

export function FreeOsintToolkit({ compact = false }: { compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const copyDeepSeek = useCallback(async () => {
    setBusy(true);
    setStatus("Building DeepSeek paste…");
    try {
      const pack = await fetchDeepSeekPaste("FRO", readAisExportOpts());
      await copyText(pack.markdown);
      setCopied(true);
      const warn = pack.softWarn ? " · soft warn" : "";
      setStatus(
        `Copied ${pack.chars.toLocaleString()} chars (~${pack.tokensEstimate.toLocaleString()} tok)${warn}`,
      );
      window.setTimeout(() => {
        setCopied(false);
        setStatus(null);
      }, 4000);
    } catch (err) {
      setStatus(`Failed: ${String(err)}`);
      window.setTimeout(() => setStatus(null), 8000);
    } finally {
      setBusy(false);
    }
  }, []);

  const downloadDeepSeek = useCallback(async () => {
    setBusy(true);
    setStatus("Building DeepSeek .md…");
    try {
      const pack = await fetchDeepSeekPaste("FRO", readAisExportOpts());
      downloadDeepSeekMarkdown(pack.markdown, "FRO");
      setStatus(`Downloaded ${pack.chars.toLocaleString()} chars`);
      window.setTimeout(() => setStatus(null), 4000);
    } catch (err) {
      setStatus(`Failed: ${String(err)}`);
      window.setTimeout(() => setStatus(null), 8000);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <section className={`panel osint-kit ${compact ? "osint-kit-compact" : ""}`}>
      <div className="panel-head">
        <div>
          <p className="eyebrow">Free / near-zero cost</p>
          <h2>Live OSINT toolkit</h2>
          <p className="muted tiny">
            IRONSIGHT panel <code>/api/telegram</code> without <code>mode=dump</code> is a thin sample (both theaters, stale tails). Beefy path: DeepSeek paste / Export ZIP (two-pass live dump: deep Hormuz channels + broad ME). Or open IRONSIGHT dump URL from toolkit footer when :3170 is up.
          </p>
        </div>
        <div className="osint-kit-actions">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void copyDeepSeek()}
          title="Copy size-capped DeepSeek paste (~36k chars · ranked Hormuz TG dump). ZIP has full telegram_channel_dump.json."
        >
          {busy ? "Building…" : copied ? "Copied" : "DeepSeek paste"}
        </button>
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => void downloadDeepSeek()}
            title="Download tiny DeepSeek .md"
          >
            .md
          </button>
        </div>
      </div>
      {status && <p className="muted tiny">{status}</p>}

      <p className="osint-kit-section">Conflict maps</p>
      <LinkRow items={CONFLICT_MAPS} />
      <p className="osint-kit-section">AIS / ships</p>
      <LinkRow items={SHIPS} />
      <p className="osint-kit-section">Satellite</p>
      <LinkRow items={SAT} />
      <p className="osint-kit-section">Telegram</p>
      <LinkRow items={TELEGRAM} />
      <p className="osint-kit-section">Energy / freight</p>
      <LinkRow items={ENERGY} />
    </section>
  );
}
