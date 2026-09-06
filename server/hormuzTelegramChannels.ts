/**
 * Unified Hormuz / Iran–Israel Telegram watch list for Export ALL + toolkit.
 * Keep in sync with IRONSIGHT `iran-israel.ts` telegramChannels and FreeOsintToolkit.
 */

export type HormuzTgChannel = {
  /** t.me username (no @) */
  name: string;
  label: string;
  note: string;
};

/** Deep-dump priority (Hormuz / fee / IRGC / IL OSINT) — maxed scrape. */
export const HORMUZ_TG_DEEP_CHANNELS: HormuzTgChannel[] = [
  { name: "FotrosResistancee", label: "Fotros Resistance", note: "IRGC / Hormuz" },
  { name: "SaberinFa", label: "Saberin (IRGC)", note: "IRGC ops" },
  { name: "TasnimNewsEN", label: "Tasnim News", note: "State EN" },
  { name: "PressTV", label: "PressTV", note: "Iran state" },
  { name: "Osint613", label: "OSINT 613", note: "IL OSINT / demands" },
  { name: "rnintel", label: "RN Intel", note: "Conflict OSINT" },
  { name: "Alsaa_plus_EN", label: "Al-Saa EN", note: "ME wire EN" },
  { name: "thecradlemedia", label: "The Cradle", note: "Hormuz / tanker" },
  { name: "OSINTdefender", label: "OSINT Defender", note: "Conflict OSINT" },
  { name: "AbuAliExpress", label: "Abu Ali Express", note: "IL OSINT" },
  { name: "defapress_ir", label: "DefaPress", note: "Iran MOD" },
  { name: "IDFofficial", label: "IDF Official", note: "IDF releases" },
  { name: "RocketAlert", label: "Rocket Alert", note: "Israel alerts" },
  { name: "sepah", label: "IRGC Official", note: "IRGC" },
  { name: "bintjbeilnews", label: "Bint Jbeil", note: "Lebanon / ME" },
  { name: "middle_east_spectator", label: "ME Spectator", note: "ME breaking" },
  { name: "GeoPWatch", label: "GeoPol Watch", note: "ME / Gulf OSINT" },
  { name: "warfareanalysis", label: "Warfare Analysis", note: "ME combat" },
  { name: "KanNews", label: "Kan News", note: "Ch13 / Hebrew TV" },
  { name: "N12News", label: "N12 News", note: "IL broadcast" },
  { name: "wamnews_en", label: "WAM (UAE)", note: "Gulf official / Hormuz ships" },
  { name: "Alibk3", label: "Ali Bk", note: "ME strike video" },
];

/** Full toolkit / manual-subscribe list (UI + pack footer). */
export const HORMUZ_TG_TOOLKIT_CHANNELS: HormuzTgChannel[] = [
  ...HORMUZ_TG_DEEP_CHANNELS,
  { name: "rybar", label: "Rybar EN/RU", note: "RU OSINT / cargo" },
  { name: "InfoDefenseENGLISH", label: "InfoDefense EN", note: "Energy impact" },
  { name: "GeopoliticsPrime", label: "Geopolitics Prime", note: "Iran war updates" },
  { name: "iranintl_en", label: "Iran Intl", note: "Opposition EN" },
  { name: "TimesofIsrael", label: "Times of Israel", note: "IL wire" },
  { name: "gulfnewsUAE", label: "Gulf News", note: "Gulf media" },
];

/** Light Russia–Ukraine dump for Black Sea / freight spillover. */
export const RU_TG_LIGHT_CHANNELS = ["rybar", "mod_russia", "DeepStateUA"].join(",");

export const TELEGRAM_DEEP_DUMP_QUERY = [
  "conflict=iran-israel",
  "mode=dump",
  "days=30",
  "limit=500",
  "maxPages=40",
  "translate=0",
  `channels=${HORMUZ_TG_DEEP_CHANNELS.map((c) => c.name).join(",")}`,
].join("&");

/**
 * ROBUST dump — deepest IRONSIGHT public scrape (API caps: days≤30, limit≤500, maxPages≤40)
 * across the **full toolkit** channel list (deep priority + spillover). Prefer this for
 * news-pack / operator ZIP when you want max coverage without GramJS private history.
 */
export const TELEGRAM_ROBUST_DUMP_QUERY = [
  "conflict=iran-israel",
  "mode=dump",
  "days=30",
  "limit=500",
  "maxPages=40",
  "translate=0",
  `channels=${HORMUZ_TG_TOOLKIT_CHANNELS.map((c) => c.name).join(",")}`,
].join("&");

/** Broad ME dump — still iran-israel theater only (no RU-UA panel sample). */
export const TELEGRAM_BROAD_DUMP_QUERY =
  "conflict=iran-israel&mode=dump&days=14&limit=200&maxPages=20&translate=0";

export const TELEGRAM_RU_LIGHT_DUMP_QUERY = [
  "conflict=russia-ukraine",
  "mode=dump",
  "days=3",
  "limit=40",
  "maxPages=4",
  "translate=0",
  `channels=${RU_TG_LIGHT_CHANNELS}`,
].join("&");

/** Direct IRONSIGHT URL path for operators who want the raw deep dump JSON. */
export function telegramDeepDumpPath(): string {
  return `/api/telegram?${TELEGRAM_DEEP_DUMP_QUERY}`;
}

/** Direct IRONSIGHT URL path for the robust (full-toolkit) dump. */
export function telegramRobustDumpPath(): string {
  return `/api/telegram?${TELEGRAM_ROBUST_DUMP_QUERY}`;
}

export const TELEGRAM_DEEP_TIMEOUT_MS = 90_000;
export const TELEGRAM_BROAD_TIMEOUT_MS = 120_000;
/** Full toolkit × max pages — allow IRONSIGHT to finish pagination. */
export const TELEGRAM_ROBUST_TIMEOUT_MS = 180_000;
export const TELEGRAM_RU_TIMEOUT_MS = 45_000;

export function toolkitTelegramLinks(): Array<{
  label: string;
  href: string;
  note: string;
}> {
  return HORMUZ_TG_TOOLKIT_CHANNELS.map((c) => ({
    label: c.label,
    href: `https://t.me/${c.name}`,
    note: c.note,
  }));
}

export function manualSubscribeLine(): string {
  return HORMUZ_TG_TOOLKIT_CHANNELS.map((c) => `t.me/${c.name}`).join(" · ");
}
