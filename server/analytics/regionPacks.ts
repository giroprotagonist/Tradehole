/**
 * World Desk region packs — multi-theater slices, not one giant noisy feed.
 *
 * Used by news_reader article filtering (UI tabs) and as the product map for
 * which layers belong to which desk. Packs are awareness windows; Israel
 * AER-01 / High-go stays Levant-gated elsewhere.
 */

export type RegionPackId =
  | "all"
  | "levant"
  | "iran_gulf"
  | "red_sea_horn"
  | "ukraine_europe"
  | "africa"
  | "energy_macro";

export type RegionPack = {
  id: RegionPackId;
  label: string;
  short: string;
  /** Title/url/source/topic match — case-insensitive substring. */
  keywords: string[];
  /** Product note: what this desk already owns vs gap. */
  layers: string;
};

export const REGION_PACKS: RegionPack[] = [
  {
    id: "all",
    label: "All desks",
    short: "All",
    keywords: [],
    layers: "Unfiltered news_reader archive — use a region tab to cut noise.",
  },
  {
    id: "levant",
    label: "Levant board",
    short: "Levant",
    keywords: [
      "lebanon",
      "lebanese",
      "hezbollah",
      "beirut",
      "gaza",
      "rafah",
      "khan younis",
      "golan",
      "quneitra",
      "syria",
      "syrian",
      "damascus",
      "jordan",
      "amman",
      "blue line",
      "litani",
      "idf",
      "israel",
      "israeli",
      "hamas",
      "pikud",
      "northern front",
      "southern front",
    ],
    layers:
      "DIP-01 · AER-01 Levant ADS-B · kinetic pins (Gaza/Golan/Lebanon/Syria/Jordan) · FIRMS Israel/Gaza/Golan · Cyprus AIS · news themes",
  },
  {
    id: "iran_gulf",
    label: "Iran / Gulf",
    short: "Iran–Gulf",
    keywords: [
      "iran",
      "iranian",
      "tehran",
      "irgc",
      "hormuz",
      "persian gulf",
      "kharg",
      "natanz",
      "fordow",
      "bandar abbas",
      "iraq",
      "baghdad",
      "erbil",
      "centcom",
      "fifth fleet",
      "bataan",
    ],
    layers:
      "TheaterWatch Gulf ADS-B + AIS Hormuz · IRONSIGHT naval · kinetic Iran/Iraq pins · FIRMS Hormuz · Oman deal / Polymarket",
  },
  {
    id: "red_sea_horn",
    label: "Red Sea / Horn",
    short: "Red Sea",
    keywords: [
      "houthi",
      "ansar allah",
      "red sea",
      "bab el-mandeb",
      "bab el mandeb",
      "aden",
      "yemen",
      "sanaa",
      "hodeidah",
      "suez",
    ],
    layers:
      "ADS-B Red Sea/Bab · AIS Bab · FIRMS Bab · TheaterWatch Red Sea stamps · Houthi news",
  },
  {
    id: "ukraine_europe",
    label: "Ukraine / Europe",
    short: "UA–EU",
    keywords: [
      "ukraine",
      "ukrainian",
      "kyiv",
      "kiev",
      "donbas",
      "crimea",
      "zaporizhzhia",
      "odessa",
      "odesa",
      "black sea",
      "russia",
      "russian",
      "moscow",
      "putin",
      "zelensky",
      "nato",
      "europe",
      "european",
      "eu energy",
      "lng europe",
    ],
    layers:
      "news_reader RSS + TG (Kyiv Independent, DeepState, …) · Google themes · no dedicated ADS-B/AIS theater yet",
  },
  {
    id: "africa",
    label: "Africa / Cape freight",
    short: "Africa",
    keywords: [
      "somalia",
      "somali",
      "al-shabaab",
      "al shabaab",
      "puntland",
      "bosaso",
      "kismayo",
      "cape of good hope",
      "cape route",
      "horn of africa",
      "sahel",
      "sudan",
      "red sea africa",
    ],
    layers:
      "East Africa Cape soft freight chip · ADS-B Somali basin (plot) · no live Somali AIS",
  },
  {
    id: "energy_macro",
    label: "Energy / macro",
    short: "Energy",
    keywords: [
      "brent",
      "wti",
      "crude",
      "opec",
      "lng",
      "natural gas",
      "tanker",
      "vlcc",
      "freight",
      "bdti",
      "federal reserve",
      "fomc",
      "inflation",
      "sanctions",
      "oil price",
    ],
    layers: "TheaterWatch curves / BDTI / peers · news_reader energy feeds",
  },
];

const BY_ID = new Map(REGION_PACKS.map((p) => [p.id, p]));

export function listRegionPacks(): RegionPack[] {
  return REGION_PACKS.slice();
}

export function findRegionPack(id: string | null | undefined): RegionPack | null {
  if (!id) return null;
  return BY_ID.get(id.trim().toLowerCase() as RegionPackId) ?? null;
}

/** Match article blob against a pack (empty keywords = match all). */
export function articleMatchesRegionPack(
  pack: RegionPack,
  parts: {
    title?: string | null;
    url?: string | null;
    source?: string | null;
    channelId?: string | null;
    topic?: string | null;
  },
): boolean {
  if (pack.id === "all" || pack.keywords.length === 0) return true;
  const blob = [
    parts.title,
    parts.url,
    parts.source,
    parts.channelId,
    parts.topic,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!blob) return false;
  return pack.keywords.some((kw) => blob.includes(kw.toLowerCase()));
}
