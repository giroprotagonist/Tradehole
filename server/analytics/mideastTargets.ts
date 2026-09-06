/**
 * Named Mideast kinetic target book — approximate pins, not official geometry.
 * Desk rewind / map overlays only. Never an Israel AER-01 High-go gate.
 */

export type MideastTargetCountry =
  | "syria"
  | "lebanon"
  | "iraq"
  | "iran"
  | "israel"
  | "jordan"
  | "gaza"
  | "golan"
  | "gulf"
  | "yemen";

/** kinetic = strike-rewind pin; context = Israel bases (not go gates); corridor/support = tanker path. */
export type MideastTargetRole = "kinetic" | "context" | "corridor" | "support";

export type MideastTarget = {
  id: string;
  label: string;
  country: MideastTargetCountry;
  role: MideastTargetRole;
  lat: number;
  lon: number;
  /** Local pin radius (km) — not the 400 km rewind search. */
  radiusKm: number;
  aliases: string[];
  note: string;
};

export const JORDAN_EAST_CORRIDOR = {
  id: "jordan-east",
  label: "Jordan-east inbound corridor",
  latMin: 30,
  latMax: 33,
  /** Exclusive: recoveries with lon > 36. */
  lonMin: 36,
  lonMax: 39.5,
  note: "lon>36 · lat 30–33 · westbound into Israel = SOFT tell, never High-go. Abu al-Duhur signature was Jordan-east inbound KC-135s.",
} as const;

/**
 * Well-known public coords (airbase / facility centroids). Approximate pins
 * for rewind distance — not official airfield geometry or kill-boxes.
 */
export const MIDEAST_TARGETS: MideastTarget[] = [
  // —— Syria ——
  {
    id: "abu-al-duhur",
    label: "Abu al-Duhur",
    country: "syria",
    role: "kinetic",
    lat: 35.732,
    lon: 37.104,
    radiusKm: 12,
    aliases: [
      "Abu al-Duhur",
      "Abu al Duhur",
      "Abu al-Dhuhur",
      "Abu Dhuhur",
      "Abul Duhur",
      "Abu al-Duhour",
      "Abu Duhur",
      "Abu Duhour",
      "Abou al-Duhur",
      "Idlib air base",
      "Idlib airbase",
      "air base in Idlib",
      "airbase in Idlib",
      "Idlib airfield",
    ],
    note: "Idlib airbase · ~35.73N 37.10E · approx pin",
  },
  {
    id: "t4-tiyas",
    label: "T4 / Tiyas",
    country: "syria",
    role: "kinetic",
    lat: 34.523,
    lon: 37.63,
    radiusKm: 12,
    aliases: ["Tiyas", "T-4", "T4", "T4 airbase", "T4 air base", "T-4 airbase"],
    note: "Tiyas (T-4) · Homs east · approx pin",
  },
  {
    id: "shayrat",
    label: "Shayrat",
    country: "syria",
    role: "kinetic",
    lat: 34.491,
    lon: 36.906,
    radiusKm: 12,
    aliases: ["Shayrat", "Shaayrat", "al-Shayrat"],
    note: "Homs · approx pin",
  },
  {
    id: "mezzeh",
    label: "Mezzeh",
    country: "syria",
    role: "kinetic",
    lat: 33.478,
    lon: 36.223,
    radiusKm: 10,
    aliases: ["Mezzeh", "Mezze", "Mazzeh", "Mezzeh Military"],
    note: "Damascus west · approx pin",
  },
  {
    id: "palmyra-tadmur",
    label: "Palmyra / Tadmur",
    country: "syria",
    role: "kinetic",
    lat: 34.557,
    lon: 38.317,
    radiusKm: 12,
    aliases: [
      "Palmyra airbase",
      "Palmyra airport",
      "Palmyra",
      "Tadmur",
      "Tadmor airbase",
      "Palmyra air base",
    ],
    note: "Tadmur airbase · approx pin",
  },
  {
    id: "dumayr",
    label: "Dumayr",
    country: "syria",
    role: "kinetic",
    lat: 33.61,
    lon: 36.749,
    radiusKm: 12,
    aliases: ["Dumayr", "Al-Dumayr", "Al Dumayr", "Dmeir"],
    note: "Damascus northeast · approx pin",
  },
  {
    id: "hama",
    label: "Hama",
    country: "syria",
    role: "kinetic",
    lat: 35.118,
    lon: 36.711,
    radiusKm: 12,
    aliases: ["Hama airbase", "Hama air base", "Hama Military Airport"],
    note: "Hama airbase · approx pin",
  },
  {
    id: "aleppo",
    label: "Aleppo",
    country: "syria",
    role: "kinetic",
    lat: 36.181,
    lon: 37.224,
    radiusKm: 12,
    aliases: [
      "Aleppo airport",
      "Aleppo International",
      "Nayrab",
      "Aleppo airbase",
    ],
    note: "Nayrab / Aleppo International · approx pin",
  },
  {
    id: "deir-ez-zor",
    label: "Deir ez-Zor",
    country: "syria",
    role: "kinetic",
    lat: 35.285,
    lon: 40.176,
    radiusKm: 12,
    aliases: [
      "Deir ez-Zor",
      "Deir ez Zor",
      "Deir Ezzor",
      "Deir al-Zor",
      "Deir ez-Zour",
    ],
    note: "Deir ez-Zor airport · approx pin",
  },
  {
    id: "khmeimim",
    label: "Khmeimim",
    country: "syria",
    role: "kinetic",
    lat: 35.411,
    lon: 35.949,
    radiusKm: 12,
    aliases: ["Khmeimim", "Hmeimim", "Hmeymim", "Humaymim"],
    note: "Russian Hmeimim / Latakia · approx pin",
  },
  // —— Lebanon ——
  {
    id: "beirut-rafik-hariri",
    label: "Beirut / Rafik Hariri",
    country: "lebanon",
    role: "kinetic",
    lat: 33.821,
    lon: 35.488,
    radiusKm: 10,
    aliases: [
      "Rafik Hariri",
      "Rafic Hariri",
      "Beirut airport",
      "Beirut International",
      "OLBA",
    ],
    note: "OLBA · approx pin · Blue Line is DIP-01, not this pin",
  },
  {
    id: "rayak",
    label: "Rayak",
    country: "lebanon",
    role: "kinetic",
    lat: 33.851,
    lon: 35.987,
    radiusKm: 8,
    aliases: ["Rayak", "Riyaq", "Rayaq"],
    note: "Bekaa airbase · approx pin",
  },
  // —— Gaza (kinetic rewind only — never DIP-01 / High-go fuel) ——
  {
    id: "gaza-city",
    label: "Gaza City",
    country: "gaza",
    role: "kinetic",
    lat: 31.501,
    lon: 34.466,
    radiusKm: 8,
    aliases: ["Gaza City", "Gaza city", "northern Gaza", "North Gaza"],
    note: "Strip north · approx pin · Gaza ground ≠ DIP-01 High-go",
  },
  {
    id: "rafah",
    label: "Rafah",
    country: "gaza",
    role: "kinetic",
    lat: 31.287,
    lon: 34.25,
    radiusKm: 8,
    aliases: ["Rafah", "Rafah crossing", "Rafah border"],
    note: "Southern Gaza / Egypt border · approx pin",
  },
  {
    id: "khan-younis",
    label: "Khan Younis",
    country: "gaza",
    role: "kinetic",
    lat: 31.346,
    lon: 34.304,
    radiusKm: 8,
    aliases: ["Khan Younis", "Khan Yunus", "Khan Yunis"],
    note: "Southern Gaza · approx pin",
  },
  {
    id: "gaza-strip",
    label: "Gaza Strip",
    country: "gaza",
    role: "kinetic",
    lat: 31.4,
    lon: 34.35,
    radiusKm: 18,
    aliases: ["Gaza Strip", "the Gaza Strip", "Gaza enclave"],
    note: "Whole-strip centroid · prefer named sites when present",
  },
  // —— Golan (DIP-01 geo peer; kinetic rewind pin) ——
  {
    id: "quneitra",
    label: "Quneitra",
    country: "golan",
    role: "kinetic",
    lat: 33.126,
    lon: 35.824,
    radiusKm: 12,
    aliases: ["Quneitra", "Al-Quneitra", "Al Quneitra", "Kuneitra"],
    note: "Golan / Syria UNDOF axis · approx pin",
  },
  {
    id: "mount-hermon",
    label: "Mount Hermon",
    country: "golan",
    role: "kinetic",
    lat: 33.416,
    lon: 35.857,
    radiusKm: 10,
    aliases: [
      "Mount Hermon",
      "Mt Hermon",
      "Hermon peak",
      "Jabal al-Sheikh",
      "Jabal Sheikh",
    ],
    note: "Hermon heights · approx pin · Golan DIP-01 geo",
  },
  {
    id: "golan-heights",
    label: "Golan Heights",
    country: "golan",
    role: "kinetic",
    lat: 33.0,
    lon: 35.75,
    radiusKm: 20,
    aliases: ["Golan Heights", "the Golan", "Israeli Golan", "Syrian Golan"],
    note: "Heights centroid · approx pin · DIP-01 geo peer",
  },
  // —— Iraq ——
  {
    id: "ain-al-asad",
    label: "Ain al-Asad / Al Asad",
    country: "iraq",
    role: "kinetic",
    lat: 33.786,
    lon: 42.441,
    radiusKm: 15,
    aliases: [
      "Ain al-Asad",
      "Ain al Asad",
      "Ayn al-Asad",
      "Al Asad Airbase",
      "Al Asad Air Base",
      "Al-Assad Airbase",
      "Al-Assad Air Base",
      "Al Asad air base",
    ],
    note: "Same site as Al Asad · Anbar · approx pin (not 'Assad' the person)",
  },
  {
    id: "balad",
    label: "Balad",
    country: "iraq",
    role: "kinetic",
    lat: 33.94,
    lon: 44.362,
    radiusKm: 12,
    aliases: ["Balad Air", "Joint Base Balad", "Al-Bakr", "Al Bakr Air"],
    note: "Joint Base Balad / Al-Bakr · approx pin",
  },
  {
    id: "baghdad",
    label: "Baghdad",
    country: "iraq",
    role: "kinetic",
    lat: 33.263,
    lon: 44.234,
    radiusKm: 12,
    aliases: [
      "Baghdad airport",
      "Baghdad International",
      "BIAP",
      "Baghdad airbase",
    ],
    note: "BIAP · approx pin",
  },
  {
    id: "erbil",
    label: "Erbil",
    country: "iraq",
    role: "kinetic",
    lat: 36.238,
    lon: 43.963,
    radiusKm: 12,
    aliases: ["Erbil airport", "Erbil International", "Erbil airbase", "Irbil airport"],
    note: "Erbil International · approx pin",
  },
  // —— Iran ——
  {
    id: "natanz",
    label: "Natanz",
    country: "iran",
    role: "kinetic",
    lat: 33.725,
    lon: 51.726,
    radiusKm: 8,
    aliases: ["Natanz"],
    note: "Enrichment site · approx pin · already a map landmark",
  },
  {
    id: "fordow",
    label: "Fordow",
    country: "iran",
    role: "kinetic",
    lat: 34.885,
    lon: 50.996,
    radiusKm: 8,
    aliases: ["Fordow", "Fordo", "Fordow facility"],
    note: "Qom enrichment · approx pin · already a map landmark",
  },
  {
    id: "isfahan",
    label: "Isfahan",
    country: "iran",
    role: "kinetic",
    lat: 32.583,
    lon: 51.833,
    radiusKm: 10,
    aliases: [
      "Isfahan nuclear",
      "Esfahan nuclear",
      "Isfahan NFC",
      "Isfahan airbase",
    ],
    note: "Nuclear / air cluster · approx pin",
  },
  {
    id: "bushehr",
    label: "Bushehr",
    country: "iran",
    role: "kinetic",
    lat: 28.945,
    lon: 50.835,
    radiusKm: 12,
    aliases: ["Bushehr", "Bushire"],
    note: "Nuclear / air · approx pin",
  },
  {
    id: "bandar-abbas",
    label: "Bandar Abbas",
    country: "iran",
    role: "kinetic",
    lat: 27.218,
    lon: 56.378,
    radiusKm: 15,
    aliases: ["Bandar Abbas", "Bandar-e Abbas"],
    note: "Naval / air · approx pin · already a map landmark",
  },
  {
    id: "kharg",
    label: "Kharg",
    country: "iran",
    role: "kinetic",
    lat: 29.247,
    lon: 50.322,
    radiusKm: 15,
    aliases: ["Kharg Island", "Khark Island", "Kharg air"],
    note: "Export terminal / island · already a map landmark",
  },
  // —— Israel (context — not new go gates) ——
  {
    id: "llbg",
    label: "LLBG",
    country: "israel",
    role: "context",
    lat: 32.011,
    lon: 34.887,
    radiusKm: 8,
    aliases: ["LLBG", "Ben Gurion", "Ben-Gurion"],
    note: "Context pin only — not an AER-01 / High-go gate",
  },
  {
    id: "hatzerim",
    label: "Hatzerim",
    country: "israel",
    role: "context",
    lat: 31.233,
    lon: 34.662,
    radiusKm: 8,
    aliases: ["Hatzerim"],
    note: "Context pin only — not an AER-01 / High-go gate",
  },
  {
    id: "ramat-david",
    label: "Ramat David",
    country: "israel",
    role: "context",
    lat: 32.665,
    lon: 35.179,
    radiusKm: 8,
    aliases: ["Ramat David"],
    note: "Context pin only — not an AER-01 / High-go gate",
  },
  {
    id: "nevatim",
    label: "Nevatim",
    country: "israel",
    role: "context",
    lat: 31.208,
    lon: 35.012,
    radiusKm: 8,
    aliases: ["Nevatim"],
    note: "Context pin only — not an AER-01 / High-go gate",
  },
  // —— Jordan corridor ——
  {
    id: "mafraq",
    label: "Mafraq",
    country: "jordan",
    role: "corridor",
    lat: 32.356,
    lon: 36.259,
    radiusKm: 20,
    aliases: ["Mafraq", "King Hussein Air", "OJMF"],
    note: "King Hussein Air Base · Jordan-east corridor pin",
  },
  {
    id: "azraq",
    label: "Azraq",
    country: "jordan",
    role: "corridor",
    lat: 31.833,
    lon: 36.782,
    radiusKm: 20,
    aliases: ["Azraq", "Muwaffaq Salti", "OJMS"],
    note: "Muwaffaq Salti / Azraq · eastern approaches · lon>36 inbound was Abu signature",
  },
  {
    id: "amman-marka",
    label: "Amman / Marka",
    country: "jordan",
    role: "corridor",
    lat: 31.973,
    lon: 35.992,
    radiusKm: 12,
    aliases: ["Marka", "Amman Marka", "OJAM", "King Abdullah I"],
    note: "Amman civil/mil · Jordan approaches · soft corridor",
  },
  {
    id: "king-abdullah-ii",
    label: "King Abdullah II",
    country: "jordan",
    role: "corridor",
    lat: 32.007,
    lon: 36.146,
    radiusKm: 12,
    aliases: [
      "King Abdullah II",
      "King Abdullah II Air Base",
      "OJKA",
    ],
    note: "Jordan air base (Zarqa) · corridor / support context",
  },
  // —— Gulf tanker / CSG context ——
  {
    id: "al-udeid",
    label: "Al Udeid",
    country: "gulf",
    role: "support",
    lat: 25.117,
    lon: 51.315,
    radiusKm: 12,
    aliases: ["Al Udeid", "Al-Udeid", "AUAB"],
    note: "Qatar · tanker / CSG context · approx pin",
  },
  {
    id: "dhafra",
    label: "Dhafra",
    country: "gulf",
    role: "support",
    lat: 24.248,
    lon: 54.548,
    radiusKm: 12,
    aliases: ["Dhafra", "Al Dhafra"],
    note: "UAE · tanker context · approx pin",
  },
  {
    id: "ali-al-salem",
    label: "Ali Al Salem",
    country: "gulf",
    role: "support",
    lat: 29.347,
    lon: 47.521,
    radiusKm: 12,
    aliases: ["Ali Al Salem", "Ali al-Salem"],
    note: "Kuwait · tanker context · approx pin",
  },
  {
    id: "isa",
    label: "Isa",
    country: "gulf",
    role: "support",
    lat: 25.918,
    lon: 50.591,
    radiusKm: 10,
    aliases: ["Isa Air Base", "Isa Airbase", "Shaikh Isa"],
    note: "Bahrain · tanker / CSG context · approx pin",
  },
  {
    id: "prince-sultan",
    label: "Prince Sultan",
    country: "gulf",
    role: "support",
    lat: 24.063,
    lon: 47.581,
    radiusKm: 15,
    aliases: ["Prince Sultan", "PSAB", "Al Kharj air"],
    note: "Saudi · tanker context · approx pin",
  },
  // —— Yemen / Red Sea (light) ——
  {
    id: "hodeidah",
    label: "Hodeidah",
    country: "yemen",
    role: "kinetic",
    lat: 14.753,
    lon: 42.976,
    radiusKm: 12,
    aliases: ["Hodeidah", "Hudaydah", "Al Hudaydah", "Hodeida"],
    note: "Red Sea port / air · approx pin · already a map landmark",
  },
  {
    id: "sanaa",
    label: "Sanaa",
    country: "yemen",
    role: "kinetic",
    lat: 15.476,
    lon: 44.22,
    radiusKm: 12,
    aliases: ["Sanaa airport", "Sana'a airport", "Sanaa International"],
    note: "Sanaa International · approx pin",
  },
];

const BY_ID = new Map(MIDEAST_TARGETS.map((t) => [t.id, t]));

export function findTargetById(id: string | null | undefined): MideastTarget | null {
  if (!id) return null;
  return BY_ID.get(id.trim().toLowerCase()) ?? null;
}

function aliasToRe(alias: string): RegExp {
  const escaped = alias
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/[\s-]+/g, "[\\s'-]+");
  return new RegExp(`\\b${escaped}\\b`, "i");
}

const ALIAS_RES: Array<{ target: MideastTarget; re: RegExp; len: number }> =
  MIDEAST_TARGETS.flatMap((target) =>
    target.aliases.map((alias) => ({
      target,
      re: aliasToRe(alias),
      len: alias.length,
    })),
  ).sort((a, b) => b.len - a.len);

/**
 * Match named bases in a headline. Longer aliases win when two targets collide.
 * "T4" is stored as "T-4" / "T4 airbase" so bare "T4" in other contexts is weaker.
 */
export function matchNamedTargets(text: string): MideastTarget[] {
  if (!text.trim()) return [];
  const hit = new Map<string, { target: MideastTarget; len: number }>();
  for (const row of ALIAS_RES) {
    if (!row.re.test(text)) continue;
    const prev = hit.get(row.target.id);
    if (!prev || row.len > prev.len) hit.set(row.target.id, { target: row.target, len: row.len });
  }
  return [...hit.values()]
    .sort((a, b) => b.len - a.len)
    .map((h) => h.target);
}

export function listMideastTargets(): MideastTarget[] {
  return MIDEAST_TARGETS.slice();
}
