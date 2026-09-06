/**
 * Export pack completeness score (0–100) from free-source status.
 * Licensed gaps (AIS / Baltic / Platts) do not reduce the free ceiling.
 */

export type SourceStatus = "ok" | "error" | "partial";

export type PackScoreInput = {
  sources: Record<string, SourceStatus>;
  telegramDeepPosts?: number;
  telegramBroadPosts?: number;
  historyOptionRows?: number;
  footprintOk?: boolean;
  surpriseOk?: boolean;
};

export type PackScore = {
  score: number;
  freeCeiling: number;
  band: "thin" | "usable" | "strong" | "max_free";
  parts: Array<{ id: string; weight: number; earned: number; note: string }>;
  licensedGaps: string[];
  asOf: string;
};

const LICENSED_GAPS = [
  "Live Baltic TD3C / FFA (Baltic Data Services)",
  "Platts Dated Brent",
  "Commercial AIS (MarineTraffic paid) — not wired; NAV-01 uses optional AISStream free key + deep links",
  "TI Fixture App live fixtures (ToS)",
  "Frontline realized fleet TCE auto-ingest from PDFs",
];

function earn(
  status: SourceStatus | undefined,
  weight: number,
  partialFrac = 0.5,
): number {
  if (status === "ok") return weight;
  if (status === "partial") return weight * partialFrac;
  return 0;
}

export function computePackScore(input: PackScoreInput): PackScore {
  const s = input.sources;
  const parts: PackScore["parts"] = [];

  const add = (
    id: string,
    weight: number,
    earned: number,
    note: string,
  ) => {
    parts.push({ id, weight, earned, note });
  };

  add(
    "telegram_deep",
    18,
    input.telegramDeepPosts && input.telegramDeepPosts > 20
      ? 18
      : input.telegramDeepPosts && input.telegramDeepPosts > 0
        ? 10
        : earn(s.telegramDeep ?? s.telegram, 18, 0.35),
    `Deep Hormuz dump posts=${input.telegramDeepPosts ?? 0}`,
  );
  add(
    "telegram_broad",
    12,
    input.telegramBroadPosts && input.telegramBroadPosts > 50
      ? 12
      : input.telegramBroadPosts && input.telegramBroadPosts > 0
        ? 7
        : earn(s.telegramBroad ?? s.telegram, 12, 0.35),
    `Broad ME dump posts=${input.telegramBroadPosts ?? 0}`,
  );
  add("firms", 10, earn(s.fires, 10), "NASA FIRMS via IRONSIGHT");
  add("flights", 8, earn(s.flights, 8), "adsb.lol mil via IRONSIGHT");
  add("alerts", 6, earn(s.alerts, 6), "Pikud / theater alerts");
  add("strikes", 6, earn(s.strikes, 6), "Google News strike layer");
  add(
    "regional",
    4,
    earn(s.regionalAlerts, 4),
    "Regional Google News alerts",
  );
  add("polymarket", 6, earn(s.polymarketIs ?? s.polymarket, 6), "Polymarket");
  add("news", 6, earn(s.news, 6), "IRONSIGHT news RSS");
  add("theater", 8, earn(s.theaterWatch, 8), "Theater watch stack");
  add(
    "footprint",
    6,
    input.footprintOk ? 6 : earn(s.decisionFootprint, 6),
    "Decision Footprint",
  );
  add(
    "surprise",
    6,
    input.surpriseOk ? 6 : earn(s.marketSurprise, 6),
    "Market Surprise",
  );
  add("physical", 4, earn(s.physical, 4), "EIA / TD3C reprints");
  add("chokepoints", 6, earn(s.chokepoints, 6), "IMF PortWatch Hormuz/Bab/Cape");
  add(
    "shipping_ir",
    4,
    earn(s.shippingIndustry, 4),
    "Frontline/peer IR headlines",
  );
  const histRows = input.historyOptionRows ?? 0;
  add(
    "history",
    6,
    histRows >= 1000 ? 6 : histRows >= 100 ? 4 : histRows > 0 ? 2 : 0,
    `SQLite option rows=${histRows}`,
  );

  const score = Math.round(
    Math.min(
      100,
      parts.reduce((a, p) => a + p.earned, 0),
    ),
  );
  const freeCeiling = parts.reduce((a, p) => a + p.weight, 0);
  const band: PackScore["band"] =
    score >= 85
      ? "max_free"
      : score >= 65
        ? "strong"
        : score >= 40
          ? "usable"
          : "thin";

  return {
    score,
    freeCeiling,
    band,
    parts,
    licensedGaps: LICENSED_GAPS,
    asOf: new Date().toISOString(),
  };
}

export function packScoreMarkdown(score: PackScore): string {
  const lines = [
    `## Pack completeness (free ceiling)`,
    `**Score ${score.score}/${score.freeCeiling}** · band=\`${score.band}\` · asOf ${score.asOf}`,
    "Licensed gaps (do not count against free score):",
    ...score.licensedGaps.map((g) => `- ❌ ${g}`),
    "Parts:",
    ...score.parts.map(
      (p) =>
        `- ${p.id}: ${p.earned.toFixed(0)}/${p.weight} — ${p.note}`,
    ),
  ];
  return lines.join("\n");
}
