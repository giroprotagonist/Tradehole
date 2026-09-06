/**
 * Shared NAVWARN classifier for Theater ghost (navwarn_box) and 5-Lock L4.
 * Same hard/soft regex, Gulf geo filter, and 7-day freshness window.
 */

export type NavwarnNewsItem = {
  title: string;
  pubDate?: string | null;
  link?: string | null;
};

export const NAVWARN_WINDOW_HOURS = 168; // 7d

/** Hard = real advisory language (not generic exercises alone). */
export const NAVWARN_HARD_RE =
  /NAVWARN|NAVAREA|navigation\s+warning|maritime\s+(security\s+)?advisory|navigation\s+restricted|exclusion\s+zone|maritime\s+exclusion|dangerous\s+operations/i;

/** Soft = exercises / drills only when Gulf geo present + fresh. */
export const NAVWARN_SOFT_RE =
  /military\s+exercises?|naval\s+(drill|exercise)|live[- ]fire/i;

export const NAVWARN_GULF_RE =
  /Hormuz|Persian\s+Gulf|Arabian\s+Gulf|Kharg|Bahrain|CENTCOM|Northern\s+Gulf|Gulf\s+of\s+Oman/i;

export const NAVWARN_WEST_KHARG_RE =
  /Kharg|west\s+of|western\s+gulf|toward\s+kharg|Bandar\s+Abbas/i;

export function isFreshNavwarn(
  pubDate: string | null | undefined,
  maxAgeMs = NAVWARN_WINDOW_HOURS * 60 * 60 * 1000,
  nowMs = Date.now(),
): boolean {
  if (!pubDate) return false;
  const t = Date.parse(pubDate);
  if (!Number.isFinite(t)) return false;
  return nowMs - t <= maxAgeMs;
}

export type NavwarnClassification = {
  hardHits: NavwarnNewsItem[];
  softHits: NavwarnNewsItem[];
  rejectedStale: string[];
  /** Lock 4: ≥1 hard OR ≥2 soft (fresh Gulf). */
  lock4Triggered: boolean;
  /** Ghost status using same evidence. */
  ghostStatus: "quiet" | "warm" | "hot";
  windowHours: number;
};

export function classifyNavwarnItems(
  items: NavwarnNewsItem[],
  nowMs = Date.now(),
): NavwarnClassification {
  const maxAge = NAVWARN_WINDOW_HOURS * 60 * 60 * 1000;
  const rejectedStale: string[] = [];

  const freshGulf = items.filter((i) => {
    if (!NAVWARN_GULF_RE.test(i.title)) return false;
    if (!isFreshNavwarn(i.pubDate, maxAge, nowMs)) {
      if (NAVWARN_HARD_RE.test(i.title) || NAVWARN_SOFT_RE.test(i.title)) {
        rejectedStale.push(i.title);
      }
      return false;
    }
    return true;
  });

  const hardHits = freshGulf.filter((i) => NAVWARN_HARD_RE.test(i.title));
  const softHits = freshGulf.filter(
    (i) => NAVWARN_HARD_RE.test(i.title) || NAVWARN_SOFT_RE.test(i.title),
  );
  const westHits = hardHits.filter((i) => NAVWARN_WEST_KHARG_RE.test(i.title));

  const lock4Triggered = hardHits.length >= 1 || softHits.length >= 2;

  let ghostStatus: "quiet" | "warm" | "hot" = "quiet";
  if (
    hardHits.length >= 2 ||
    (hardHits.length >= 1 && westHits.length >= 1) ||
    softHits.length >= 2
  ) {
    ghostStatus = "hot";
  } else if (hardHits.length >= 1 || softHits.length >= 1) {
    ghostStatus = "warm";
  }

  return {
    hardHits,
    softHits,
    rejectedStale,
    lock4Triggered,
    ghostStatus,
    windowHours: NAVWARN_WINDOW_HOURS,
  };
}
