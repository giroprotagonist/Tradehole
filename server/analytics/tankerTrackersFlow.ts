/**
 * TankerTrackers Hormuz / blockade-line crude flow — parsed from public t.me/s feed.
 * Not a licensed TT API; AIS + satellite research reposted on Telegram (~daily).
 */

export type TankerTrackersFlowPrint = {
  /** Mbpd crude through blockade line or Hormuz (context-dependent). */
  bpdMillions: number;
  /** YYYY-MM-DD from message datetime when parseable. */
  asOfDate: string | null;
  /** ISO timestamp of source post. */
  asOfIso: string | null;
  lagDays: number | null;
  /** Short context label, e.g. "7d avg · blockade line". */
  windowLabel: string;
  excerpt: string;
  hormuzMbpd: number | null;
  sourceUrl: string;
  note: string;
};

export type TankerTrackersFlowReport = {
  asOf: string;
  latest: TankerTrackersFlowPrint | null;
  source: string;
  channelUrl: string;
  lagNote: string;
};

const CHANNEL = "tankerTrackers";
const SOURCE_URL = `https://t.me/s/${CHANNEL}`;

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function lagDaysFromIso(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 86_400_000));
}

function isoToDate(iso: string | null): string | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return m?.[1] ?? null;
}

/** Exported for unit tests. */
export function parseTankerTrackersMessages(
  html: string,
): TankerTrackersFlowPrint[] {
  const out: TankerTrackersFlowPrint[] = [];
  const re =
    /<time[^>]+datetime="([^"]+)"[\s\S]*?<div class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const dt = m[1]?.trim() ?? null;
    const text = stripHtml(m[2] ?? "");
    if (!text) continue;

    const lower = text.toLowerCase();
    const flowRelevant =
      /hormuz|blockade line|mbpd|barrels per day|barrels a day|million barrels of crude/i.test(
        text,
      );
    if (!flowRelevant) continue;

    let bpdMillions: number | null = null;
    let windowLabel = "TT post";

    const mbpdDirect = text.match(/(\d+(?:\.\d+)?)\s*Mbpd\b/i);
    if (mbpdDirect) {
      bpdMillions = Number(mbpdDirect[1]);
      windowLabel = "Mbpd (TT breakdown)";
    }

    const perDay = text.match(
      /(\d+(?:\.\d+)?)\s*million\s+barrels(?:\s+of\s+crude\s+oil)?\s+per\s+day/i,
    );
    if (perDay) {
      bpdMillions = Number(perDay[1]);
      if (
        /past\s+(\d+)\s+full\s+days|past\s+seven|7\s+complete\s+days|7d|seven\s+days/i.test(
          text,
        )
      ) {
        windowLabel = "7d avg · blockade line";
      } else if (/past\s+(\d+)\s+days|28\s+days/i.test(text)) {
        const d = text.match(/past\s+(\d+)\s+days/i)?.[1];
        windowLabel = d ? `${d}d avg · blockade line` : "28d avg · blockade line";
      } else {
        windowLabel = "avg · blockade line";
      }
    }

    const barrelsADay = text.match(
      /(\d+(?:\.\d+)?)\s*million\s+barrels\s+a\s+day/i,
    );
    if (barrelsADay) {
      bpdMillions = Number(barrelsADay[1]);
      windowLabel = "7d avg · Bloomberg cite";
    }

    const nearly = text.match(
      /nearly\s+(\d+(?:\.\d+)?)\s+million\s+barrels\s+of\s+crude\s+oil\s+per\s+day/i,
    );
    if (nearly) {
      bpdMillions = Number(nearly[1]);
      windowLabel = "7d avg · blockade line";
    }

    if (bpdMillions == null || !Number.isFinite(bpdMillions)) continue;

    let hormuzMbpd: number | null = null;
    const hormuzBreak = text.match(
      /(\d+(?:\.\d+)?)\s*Mbpd\s+passed\s+through\s+the\s+Strait\s+of\s+Hormuz/i,
    );
    if (hormuzBreak) {
      hormuzMbpd = Number(hormuzBreak[1]);
    }

    out.push({
      bpdMillions,
      asOfDate: isoToDate(dt),
      asOfIso: dt,
      lagDays: lagDaysFromIso(dt),
      windowLabel,
      excerpt: text.slice(0, 280),
      hormuzMbpd,
      sourceUrl: SOURCE_URL,
      note:
        "TankerTrackers Telegram — AIS + satellite research; not IMF PortWatch transit counts.",
    });
  }

  return out;
}

export async function fetchTankerTrackersFlow(): Promise<TankerTrackersFlowReport> {
  const empty: TankerTrackersFlowReport = {
    asOf: new Date().toISOString(),
    latest: null,
    source: "TankerTrackers.com Telegram (@tankerTrackers)",
    channelUrl: SOURCE_URL,
    lagNote:
      "TT flow updates are irregular — usually weekly 7d averages via blockade-line AIS + imagery.",
  };

  try {
    const res = await fetch(SOURCE_URL, {
      headers: {
        "User-Agent":
          "Tradehole/0.2 (personal research; Hormuz flow monitor)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return empty;
    const html = await res.text();
    const prints = parseTankerTrackersMessages(html);
    if (!prints.length) return empty;
    // Prefer newest by post date among top-scored prints.
    prints.sort((a, b) => {
      const ta = a.asOfIso ? Date.parse(a.asOfIso) : 0;
      const tb = b.asOfIso ? Date.parse(b.asOfIso) : 0;
      return tb - ta;
    });
    return { ...empty, latest: prints[0] ?? null };
  } catch (err) {
    console.warn("[tradehole] TankerTrackers flow scrape failed:", err);
    return empty;
  }
}
