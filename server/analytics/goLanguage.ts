/**
 * Hebrew / Home Front / preemptive “go language” classifier.
 * Soft pre-launch tell — never a sole High-go peer.
 */

export type GoLanguageItem = {
  title: string;
  pubDate?: string | null;
  link?: string | null;
  source?: string | null;
};

export type GoLanguageHit = GoLanguageItem & {
  strength: "hard" | "soft";
};

/** Hard: civilian instructions / open shelters / Home Front Command / preemptive strike framing. */
export const GO_LANGUAGE_HARD_RE =
  /Home\s*Front\s*Command|פיקוד\s*העורף|open(ing)?\s+(the\s+)?shelters?|enter\s+(the\s+)?shelters?|כניסה\s*למרחבים\s*מוגנים|pre-?emptive\s+(strike|attack)|מכה\s*מקדימה|civilian\s+defense\s+(alert|instruction)|stay\s+near\s+shelters?|sealed\s+room|מרחב\s*מוגן|go\s+to\s+(the\s+)?(nearest\s+)?shelter|enter\s+protected\s+spaces?/i;

/** Soft: go-alone / strike prep language without shelter instructions. */
export const GO_LANGUAGE_SOFT_RE =
  /ready\s+to\s+strike|strike\s+Iran|attack\s+Iran|IDF\s+prepar|war\s+cabinet\s+authorized|green\s+light\s+to\s+strike|operational\s+order|התראה|יציאה\s*למתקפה|צה.?ל\s+.{0,40}(מוכן|מתכונן|יציאה)|IDF\s+.{0,40}(ready|preparing|authorized)\s+.{0,40}(strike|attack|Iran)|Home\s*Front.{0,40}(alert|instruction|prepare)|Pikud.{0,40}(alert|instruction)/i;

/** Actual civilian-facing go language (validates a Home Front mention). */
export const GO_LANGUAGE_CIVIL_RE =
  /open(ing)?\s+(the\s+)?shelters?|enter\s+(the\s+)?shelters?|כניסה\s*למרחבים|sealed\s+room|מרחב\s*מוגן|civilian\s+defense|pre-?emptive\s+(strike|attack)|מכה\s*מקדימה|stay\s+near\s+shelters?|go\s+to\s+(the\s+)?(nearest\s+)?shelter|enter\s+protected\s+spaces?/i;

/** Home Front Command also runs foreign SAR — Colombia quake / humanitarian is not go-language. */
export const GO_LANGUAGE_AID_FALSE_RE =
  /humanitarian|earthquake|Colombia|disaster\s+relief|search\s+and\s+rescue|Alliance\s+of\s+Brothers|ברית\s*רעים|רעידת\s*האדמה|קולומביה/i;

const GO_LANG_WINDOW_MS = 18 * 60 * 60 * 1000;

function isAidFalsePositive(title: string): boolean {
  return GO_LANGUAGE_AID_FALSE_RE.test(title) && !GO_LANGUAGE_CIVIL_RE.test(title);
}

export function formatGoLanguageHit(h: GoLanguageHit, maxTitle = 220): string {
  const src = h.source?.trim() ? ` · ${h.source.trim()}` : "";
  const when = h.pubDate?.trim() ? ` · ${h.pubDate.trim()}` : "";
  const link = h.link?.trim() ? ` · ${h.link.trim()}` : "";
  return `[${h.strength.toUpperCase()}] ${h.title.slice(0, maxTitle)}${src}${when}${link}`;
}

export function classifyGoLanguageItems(
  items: GoLanguageItem[],
  nowMs = Date.now(),
): {
  hardHits: GoLanguageHit[];
  softHits: GoLanguageHit[];
  /** hot = ≥1 hard fresh; warm = ≥2 soft or 1 soft+hard path already covered */
  status: "quiet" | "warm" | "hot";
} {
  const fresh = items.filter((i) => {
    if (!i.pubDate) return true;
    const t = Date.parse(i.pubDate);
    if (!Number.isFinite(t)) return true;
    return nowMs - t <= GO_LANG_WINDOW_MS;
  });

  const hardHits: GoLanguageHit[] = [];
  const softHits: GoLanguageHit[] = [];
  for (const i of fresh) {
    const hit = {
      title: i.title,
      pubDate: i.pubDate,
      link: i.link ?? null,
      source: i.source ?? null,
    };
    if (isAidFalsePositive(i.title)) continue;
    if (GO_LANGUAGE_HARD_RE.test(i.title)) {
      hardHits.push({ ...hit, strength: "hard" });
    } else if (GO_LANGUAGE_SOFT_RE.test(i.title)) {
      softHits.push({ ...hit, strength: "soft" });
    }
  }

  let status: "quiet" | "warm" | "hot" = "quiet";
  if (hardHits.length >= 1) status = "hot";
  else if (softHits.length >= 2) status = "warm";
  else if (softHits.length >= 1) status = "warm";

  return { hardHits, softHits, status };
}
