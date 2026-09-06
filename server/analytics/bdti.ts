import fs from "node:fs";
import path from "node:path";
import { historyDataDir } from "../history/db";

export type BdtiPoint = { date: string; value: number };

export type BdtiReport = {
  latest: BdtiPoint | null;
  prev: BdtiPoint | null;
  changePct1d: number | null;
  changePct5d: number | null;
  points: BdtiPoint[];
  sourceUrl: string;
  note: string;
  structuralBias: "structural" | "blip" | "unknown";
  biasNote: string;
  asOf: string;
  /** Calendar lag of latest StockQ print vs today (null if no date). */
  lagDays: number | null;
};

const SOURCE = "https://en.stockq.org/index/BDTI.php";

function cachePath(): string {
  return path.join(historyDataDir(), "bdti-cache.json");
}

function readCache(): BdtiPoint[] {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(), "utf8")) as BdtiPoint[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeCache(points: BdtiPoint[]): void {
  try {
    fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
    fs.writeFileSync(cachePath(), JSON.stringify(points, null, 2));
  } catch {
    /* ignore */
  }
}

/**
 * StockQ client-side obfuscation (sq-obfuscate.js): base64 of
 * `seed|a|b|c|d|e` (6 pipe fields). LCG scramble drops 2 fakes and
 * reorders the remaining 3 chunks into the displayed number/string.
 */
export function decodeStockqObfuscated(payload: string): string | null {
  try {
    const fields = Buffer.from(payload, "base64").toString("utf8").split("|");
    if (fields.length !== 6) return null;
    let z = Number.parseInt(fields[0]!, 10);
    if (!Number.isFinite(z)) return null;
    const a = fields.slice(1);
    const random = () => {
      z = (z * 48271) % 2147483647;
      return z / 2147483647;
    };
    random();
    random();
    const order = [0, 1, 2];
    for (let i = 2; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const temp = order[i]!;
      order[i] = order[j]!;
      order[j] = temp;
    }
    random();
    const fakePosition1 = Math.floor(random() * 4);
    random();
    const fakePosition2 = Math.floor(random() * 5);
    a.splice(fakePosition2, 1);
    a.splice(fakePosition1, 1);
    const value = ["", "", ""];
    for (let k = 0; k < 3; k++) {
      value[order[k]!] = a[k]!;
    }
    return value.join("");
  } catch {
    return null;
  }
}

function lagDaysFromIso(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(`${iso}T12:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 86_400_000));
}

export function parseStockq(html: string): BdtiPoint[] {
  const points: BdtiPoint[] = [];

  // Obfuscated rows (Aug 2026+): date cell + sq-obfuscated index span.
  const obRe =
    /(\d{4})\/(\d{2})\/(\d{2})\s*<\/td>\s*<td[^>]*>\s*<span class="sq-obfuscated" data-sq="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = obRe.exec(html))) {
    const decoded = decodeStockqObfuscated(m[4]!);
    if (!decoded) continue;
    const value = Number(decoded.replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    points.push({
      date: `${m[1]}-${m[2]}-${m[3]}`,
      value,
    });
  }

  // Legacy plain rows: 2026/07/14 | 2145.00 | 4.13%
  if (!points.length) {
    const re =
      /(\d{4})\/(\d{2})\/(\d{2})\s*<\/td>\s*<td[^>]*>\s*([\d,]+\.?\d*)/gi;
    while ((m = re.exec(html))) {
      const value = Number(String(m[4]).replace(/,/g, ""));
      if (Number.isFinite(value)) {
        points.push({ date: `${m[1]}-${m[2]}-${m[3]}`, value });
      }
    }
  }

  // Fallback: plain text dates
  if (!points.length) {
    const re2 = /(\d{4})\/(\d{2})\/(\d{2})\s+(\d{3,5}(?:\.\d+)?)/g;
    while ((m = re2.exec(html))) {
      points.push({
        date: `${m[1]}-${m[2]}-${m[3]}`,
        value: Number(m[4]),
      });
    }
  }

  const byDate = new Map(points.map((p) => [p.date, p]));
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchBdtiSeries(): Promise<BdtiReport> {
  let points = readCache();
  try {
    const res = await fetch(SOURCE, {
      headers: {
        "User-Agent": "Tradehole/0.1 (personal research; BDTI proxy)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (res.ok) {
      const html = await res.text();
      const scraped = parseStockq(html);
      if (scraped.length) {
        points = scraped;
        writeCache(points);
      }
    }
  } catch (err) {
    console.warn("[tradehole] BDTI scrape failed:", err);
  }

  const latest = points.at(-1) ?? null;
  const prev = points.length >= 2 ? points[points.length - 2] : null;
  const ago5 = points.length >= 6 ? points[points.length - 6] : null;
  const changePct1d =
    latest && prev && prev.value > 0
      ? ((latest.value - prev.value) / prev.value) * 100
      : null;
  const changePct5d =
    latest && ago5 && ago5.value > 0
      ? ((latest.value - ago5.value) / ago5.value) * 100
      : null;
  const lagDays = lagDaysFromIso(latest?.date ?? null);

  let structuralBias: BdtiReport["structuralBias"] = "unknown";
  let biasNote =
    "True TD3C FFA (Q3/Q4) requires Baltic data license. BDTI is a dirty-tanker composite proxy only.";
  if (changePct5d != null) {
    if (changePct5d >= 8) {
      structuralBias = "structural";
      biasNote = `BDTI +${changePct5d.toFixed(1)}% over ~5 sessions — freight strength looks persistent (proxy for structural tanker boom). FFA curve still not licensed.`;
    } else if (changePct5d <= -5) {
      structuralBias = "blip";
      biasNote = `BDTI ${changePct5d.toFixed(1)}% over ~5 sessions — freight softening; treats the spike as more blip-like until FFAs available.`;
    } else {
      structuralBias = "unknown";
      biasNote = `BDTI ~flat (${changePct5d.toFixed(1)}% / 5d). Without TD3C FFA contango/backwardation, treat physical WS prints as lagged leading indicators only.`;
    }
  }
  if (lagDays != null && lagDays >= 5) {
    biasNote += ` StockQ print lag ~${lagDays}d (as-of ${latest?.date ?? "—"}) — not a live Baltic tape.`;
  }

  return {
    latest,
    prev,
    changePct1d,
    changePct5d,
    points: points.slice(-120),
    sourceUrl: SOURCE,
    note: "Public StockQ BDTI reprint — not official Baltic FFA. Contango/backwardation of TD3C Q3/Q4 is not free.",
    structuralBias,
    biasNote,
    asOf: new Date().toISOString(),
    lagDays,
  };
}
