/**
 * Mirror of server/hormuzTelegramChannels.ts toolkit list for FreeOsintToolkit UI.
 * Keep usernames in sync with server + IRONSIGHT iran-israel.ts.
 */
export const HORMUZ_TG_TOOLKIT: Array<{
  label: string;
  href: string;
  note: string;
  cost: "free";
}> = [
  { label: "Fotros Resistance", href: "https://t.me/FotrosResistancee", note: "IRGC / Hormuz", cost: "free" },
  { label: "Saberin (IRGC)", href: "https://t.me/SaberinFa", note: "IRGC ops", cost: "free" },
  { label: "Tasnim News", href: "https://t.me/TasnimNewsEN", note: "State EN", cost: "free" },
  { label: "PressTV", href: "https://t.me/PressTV", note: "Iran state", cost: "free" },
  { label: "OSINT 613", href: "https://t.me/Osint613", note: "IL OSINT / demands", cost: "free" },
  { label: "RN Intel", href: "https://t.me/rnintel", note: "Conflict OSINT", cost: "free" },
  { label: "Al-Saa EN", href: "https://t.me/Alsaa_plus_EN", note: "ME wire EN", cost: "free" },
  { label: "The Cradle", href: "https://t.me/thecradlemedia", note: "Hormuz / tanker", cost: "free" },
  { label: "OSINT Defender", href: "https://t.me/OSINTdefender", note: "Conflict OSINT", cost: "free" },
  { label: "Abu Ali Express", href: "https://t.me/AbuAliExpress", note: "IL OSINT", cost: "free" },
  { label: "DefaPress", href: "https://t.me/defapress_ir", note: "Iran MOD", cost: "free" },
  { label: "IDF Official", href: "https://t.me/IDFofficial", note: "IDF releases", cost: "free" },
  { label: "Rocket Alert", href: "https://t.me/RocketAlert", note: "Israel alerts", cost: "free" },
  { label: "IRGC Official", href: "https://t.me/sepah", note: "IRGC", cost: "free" },
  { label: "Bint Jbeil", href: "https://t.me/bintjbeilnews", note: "Lebanon / ME", cost: "free" },
  { label: "ME Spectator", href: "https://t.me/middle_east_spectator", note: "ME breaking", cost: "free" },
  { label: "GeoPol Watch", href: "https://t.me/GeoPWatch", note: "ME / Gulf OSINT", cost: "free" },
  { label: "Warfare Analysis", href: "https://t.me/warfareanalysis", note: "ME combat", cost: "free" },
  { label: "Kan News", href: "https://t.me/KanNews", note: "Ch13 / Hebrew TV", cost: "free" },
  { label: "N12 News", href: "https://t.me/N12News", note: "IL broadcast", cost: "free" },
  { label: "Ali Bk", href: "https://t.me/Alibk3", note: "ME strike video", cost: "free" },
  { label: "Rybar EN/RU", href: "https://t.me/rybar", note: "RU OSINT / cargo", cost: "free" },
  { label: "InfoDefense EN", href: "https://t.me/InfoDefenseENGLISH", note: "Energy impact", cost: "free" },
  { label: "Geopolitics Prime", href: "https://t.me/GeopoliticsPrime", note: "Iran war updates", cost: "free" },
  { label: "Iran Intl", href: "https://t.me/iranintl_en", note: "Opposition EN", cost: "free" },
  { label: "Times of Israel", href: "https://t.me/TimesofIsrael", note: "IL wire", cost: "free" },
  { label: "WAM (UAE)", href: "https://t.me/wamnews_en", note: "Gulf official", cost: "free" },
  { label: "Gulf News", href: "https://t.me/gulfnewsUAE", note: "Gulf media", cost: "free" },
];

/** Same query Tradehole Export hits for the deep Hormuz scrape (IRONSIGHT :3170). */
export const TELEGRAM_DEEP_DUMP_HREF =
  "http://localhost:3170/api/telegram?conflict=iran-israel&mode=dump&days=30&limit=500&maxPages=40&translate=0&channels=" +
  [
    "FotrosResistancee",
    "SaberinFa",
    "TasnimNewsEN",
    "PressTV",
    "Osint613",
    "rnintel",
    "Alsaa_plus_EN",
    "thecradlemedia",
    "OSINTdefender",
    "AbuAliExpress",
    "defapress_ir",
    "IDFofficial",
    "RocketAlert",
    "sepah",
    "bintjbeilnews",
    "middle_east_spectator",
    "GeoPWatch",
    "warfareanalysis",
    "KanNews",
    "N12News",
    "wamnews_en",
    "Alibk3",
  ].join(",");

/** Maxed dump across the full toolkit list (deep + spillover channels). Prefer for news pack. */
export const TELEGRAM_ROBUST_DUMP_HREF =
  "http://localhost:3170/api/telegram?conflict=iran-israel&mode=dump&days=30&limit=500&maxPages=40&translate=0&channels=" +
  [
    "FotrosResistancee",
    "SaberinFa",
    "TasnimNewsEN",
    "PressTV",
    "Osint613",
    "rnintel",
    "Alsaa_plus_EN",
    "thecradlemedia",
    "OSINTdefender",
    "AbuAliExpress",
    "defapress_ir",
    "IDFofficial",
    "RocketAlert",
    "sepah",
    "bintjbeilnews",
    "middle_east_spectator",
    "GeoPWatch",
    "warfareanalysis",
    "KanNews",
    "N12News",
    "wamnews_en",
    "Alibk3",
    "rybar",
    "InfoDefenseENGLISH",
    "GeopoliticsPrime",
    "iranintl_en",
    "TimesofIsrael",
    "gulfnewsUAE",
  ].join(",");
