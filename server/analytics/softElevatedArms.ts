/**
 * Soft elevated arms: Iran connectivity blackout (news proxy) + FIRMS thermal spike.
 * Neither is a High-go gate — elevated watch / soft alarm only.
 */

export type SoftElevatedArm = {
  id: "iran_blackout" | "firms_spike";
  lit: boolean;
  status: "quiet" | "warm" | "hot" | "unknown";
  read: string;
  evidence: string[];
};

const BLACKOUT_RE =
  /internet\s+(blackout|shutdown|cut|outage)|cuts?\s+internet|disconnect(ed|ion)?\s+(from\s+)?(the\s+)?internet|national\s+internet|filter(?:ing)?\s+of\s+internet|قطع\s*(ی|ي)?\s*اینترنت/i;

const IRAN_GEO_RE = /Iran|Iranian|Tehran|Islamic\s+Republic/i;

export function classifyIranBlackoutItems(
  items: Array<{ title: string; pubDate?: string | null }>,
  nowMs = Date.now(),
): SoftElevatedArm {
  const maxAge = 24 * 60 * 60 * 1000;
  const hits = items.filter((i) => {
    if (!IRAN_GEO_RE.test(i.title) || !BLACKOUT_RE.test(i.title)) return false;
    if (!i.pubDate) return true;
    const t = Date.parse(i.pubDate);
    if (!Number.isFinite(t)) return true;
    return nowMs - t <= maxAge;
  });
  const status: SoftElevatedArm["status"] =
    hits.length >= 2 ? "hot" : hits.length >= 1 ? "warm" : "quiet";
  return {
    id: "iran_blackout",
    lit: status === "hot" || status === "warm",
    status,
    read:
      status === "hot"
        ? `Iran connectivity blackout chatter elevated (${hits.length} ≤24h) — soft prelude watch, not a go gate.`
        : status === "warm"
          ? `One Iran internet blackout/outage headline ≤24h — corroborate; not a High-go peer.`
          : "No fresh Iran internet blackout/outage headlines in free RSS.",
    evidence: hits.map((h) => h.title).slice(0, 5),
  };
}

/** FIRMS soft wake when Hormuz+Israel/Bab sample is unusually hot. */
export function classifyFirmsSpike(opts: {
  hormuzCount: number | null;
  babCount: number | null;
  israelRegionCount?: number | null;
}): SoftElevatedArm {
  const h = opts.hormuzCount;
  const b = opts.babCount;
  const il = opts.israelRegionCount ?? null;
  if (h == null && b == null && il == null) {
    return {
      id: "firms_spike",
      lit: false,
      status: "unknown",
      read: "FIRMS counts unavailable — open NASA FIRMS deep link.",
      evidence: [],
    };
  }
  const hormuz = h ?? 0;
  const bab = b ?? 0;
  const israel = il ?? 0;
  // Soft thresholds — desk wake, not strike confirmation
  const hot = hormuz >= 40 || israel >= 25 || hormuz + bab >= 55;
  const warm = hormuz >= 20 || israel >= 12 || hormuz + bab >= 30;
  const status: SoftElevatedArm["status"] = hot ? "hot" : warm ? "warm" : "quiet";
  return {
    id: "firms_spike",
    lit: status !== "quiet",
    status,
    read:
      status === "hot"
        ? `FIRMS thermal spike soft wake — Hormuz ${hormuz} · Bab ${bab} · Israel-region ${israel}. Corroborate on map; not a High-go gate.`
        : status === "warm"
          ? `FIRMS elevated — Hormuz ${hormuz} · Bab ${bab} · Israel-region ${israel}. Soft watch only.`
          : `FIRMS routine — Hormuz ${hormuz} · Bab ${bab} · Israel-region ${israel}.`,
    evidence: [
      `hormuz=${hormuz}`,
      `bab=${bab}`,
      `israelRegion=${israel}`,
    ],
  };
}
