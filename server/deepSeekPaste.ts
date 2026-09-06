/**
 * Size-capped DeepSeek web-UI paste — high-signal decision content only.
 * Full OSINT / EVERYTHING packs remain available for ZIP / power users.
 */
import {
  buildOsintPack,
  type OsintNewsHeadline,
  type OsintPackOpts,
  type OsintTelegramPost,
} from "./osintPack";
import { PACK_SCHEMA_VERSION } from "./aiBrief";
import { buildBookSummary } from "./bookSummary";
import { buildIsraelStrikeTells } from "./analytics/israelStrikeTells";
import { buildPoliticsCalendarChip } from "./analytics/politicsCalendar";
import { getLatestIntelAlarm } from "./intelAlarm";
import { HORMUZ_TG_DEEP_CHANNELS } from "./hormuzTelegramChannels";

/** Default ~36k chars — room for denser Hormuz TG dump in free web UI. */
export const DEFAULT_DEEPSEEK_MAX_CHARS = 36_000;
/** Soft UI warn when paste approaches / exceeds this. */
export const DEFAULT_DEEPSEEK_SOFT_WARN_CHARS = 40_000;

/** How many ranked TG lines land in the paste (Export ZIP still has full dump). */
const DEEPSEEK_TG_LIMIT = 40;
const DEEPSEEK_TG_TEXT_CHARS = 480;

const DEEP_CHANNEL_NAMES = new Set(
  HORMUZ_TG_DEEP_CHANNELS.map((c) => c.name.toLowerCase()),
);

const TRUNC_FOOTER =
  "…truncated for DeepSeek web UI; full pack in ZIP (Export ▾ → Download EVERYTHING)";

const PASTE_RULES_HEADER = [
  "## Paste rules (read before acting)",
  "- Desk posture block + **Interpretive heuristics** are authoritative — scenario **titles** are secondary labels only.",
  "- Do **not** claim the interpretive framework is missing — EMCON / pre-dawn clocks / CONUS-L2 / politics calendar / Never-All-Together demotion are **in this paste** (section below). Apply them; do not ask the operator to re-teach them.",
  "- Do **not** treat Israel Strike scenario **title** alone as a trade signal — action line is `froGuidance` / HOLD-watch.",
  "- **High-go** = AER ≥3 Levant tankers + hard peer. DeepSeek “E-6B+AWACS+tankers all together” ≠ Tradehole High-go (E-6B = 5-Lock L2).",
  "- Soft OSINT (1 tanker, DIP warm, empty AIS, hex-watch K35R) ≠ High-go / Doomsday / buy-the-ask.",
  "- Do **not** forecast “FRO will keep rallying” or invent buy/sell — desk is alert + HOLD/watch only; no auto-trade.",
  "- Book: sum Sep $46c across **all** accounts (Rollover + Roth + Robinhood) — a 0× account ≠ flat book. RH is a separate account.",
  "- Rome next: September — walkout arm DISABLED. Do **not** invent a Rome walkout / spoiler-path-live / delegation-returning clock.",
  "- East Africa / al-Shabaab Cape-route watch is **soft FRO freight** — never Israel High-go; one headline ≠ Cape-closed.",
].join("\n");

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Fixed-offset local clock for paste heuristics (DST-coarse is fine). */
function localClock(
  nowMs: number,
  offsetHours: number,
): { hh: number; mm: number; label: string } {
  const t = new Date(nowMs + offsetHours * 3600_000);
  const hh = t.getUTCHours();
  const mm = t.getUTCMinutes();
  return { hh, mm, label: `${pad2(hh)}:${pad2(mm)}` };
}

/**
 * Interpretive framework so the next DeepSeek chat is not raw-signal-only.
 * Desk High-go stays authoritative; DeepSeek “all together” is a watch pattern.
 */
function buildInterpretiveHeuristicsSection(nowMs = Date.now()): string {
  const il = localClock(nowMs, 3); // Israel summer ≈ IDT UTC+3
  const ir = localClock(nowMs, 3.5); // Iran ≈ IRST UTC+3:30
  const preDawnIl = il.hh >= 2 && il.hh < 5;
  const cal = buildPoliticsCalendarChip(new Date(nowMs));
  const calBits = cal.upcoming
    .slice(0, 3)
    .map((e) =>
      e.daysUntil <= 0
        ? `${e.label} · today`
        : `${e.label} in ${e.daysUntil}d`,
    );
  const intel = getLatestIntelAlarm();
  const l2 = intel?.locks?.find((l) => l.id === 2);
  const l2Sample = (
    l2?.evidence as
      | { samples?: Array<{ lat?: number; lon?: number; hex?: string }> }
      | undefined
  )?.samples?.[0];
  const l2Pos =
    l2Sample?.lat != null && l2Sample?.lon != null
      ? `${l2Sample.lat.toFixed(1)}°N, ${Math.abs(l2Sample.lon).toFixed(1)}°${l2Sample.lon < 0 ? "W" : "E"}`
      : null;
  const l2Conus =
    l2Sample?.lat != null &&
    l2Sample?.lon != null &&
    l2Sample.lat >= 24 &&
    l2Sample.lat <= 50 &&
    l2Sample.lon >= -125 &&
    l2Sample.lon <= -66;

  const lines = [
    "## Interpretive heuristics (desk framework — paste-carried)",
    "**REQUIRED:** This section IS the interpretive layer. Do not list these as “still missing / needs human.” Remaining human work = Layer-3 manual fills (Bataan SOG, VLCC count, Hebrew go on N12) only.",
    `As-of clocks: **Israel ${il.label}** (UTC+3) · **Iran ${ir.label}** (UTC+3:30)${preDawnIl ? " · **PRE-DAWN IL window (02–05)** — classic strike watch hours" : " · not in 02–05 IL strike-window hours"}.`,
    calBits.length
      ? `Politics calendar: ${calBits.join(" · ")}${cal.headline ? ` — ${cal.headline}` : ""} (overlay only, not go).`
      : "Politics calendar: (none in 45d horizon).",
    l2?.triggered
      ? `L2 E-6B: FIRED${l2Pos ? ` @ ${l2Pos}` : ""}${
          l2Conus
            ? " — CONUS posture (strategic C2), not Levant tactical deployment"
            : " — check lat/lon vs Levant"
        } (5-Lock Hormuz/C2; not Israel High-go).`
      : "L2 E-6B: quiet / not fired on last 5-Lock sample.",
    "",
    "### Authoritative gates",
    "1. **High-go** = AER-01 HOT (≥3 Levant tankers) **AND** hard peer (NAV lit / DIP HOT / ELEC HOT / AER-02 HOT). Soft STRAT/POL/GO-01 never substitute. AER warm (1 tanker) + DIP HOT = elevated watch, NOT High-go.",
    "2. DeepSeek **“Never All Together”** (E-6B + AWACS + ≥3 tankers simultaneous) = **watch pattern / narrative**, not the Tradehole go gate. Component separation can mean prep **or** unrelated ops — do not invent GO from L2 alone.",
    "3. **0 tankers ≠ all clear** (EMCON / dark possible) **and** ≠ High-go. Quiet AER → HOLD/elevated watch; do not upgrade on darkness alone.",
    "4. **Shekel spike** = lagging market panic / confirmation — never required for High-go; alone with quiet AER/NAV = elevated watch NOT go.",
    "",
    "### Soft pressure (elevated watch only)",
    "5. **STRAT-01/02 HOT** = escalation *pressure* (Iran doctrine / recovery clock) — strategy stress, not a kinetic go print.",
    "6. **Likud / Mossad / POL-02** = domestic/diplomatic desperation overlay — judgment, not auto-go. POL-03 Hormuz MOU / Sunday deadline is PAST and DISABLED.",
    "7. **Pre-dawn IL/IR (≈02–05)** = heighten attention on AER ladder + peers; still need visible High-go gates.",
    "8. **Manual Layer-3** still required: Bataan SOG, VLCC divert count, IRGC posture, NAVWARN force, Hebrew go on N12/Walla — paste cannot invent these.",
    "9. **East Africa / al-Shabaab Cape-route watch** = soft FRO/freight overlay (Somali-basin anti-ship can reprice the Cape *route* via war-risk). Never Israel High-go. One headline ≠ Cape-closed. No live Somali AIS. Sunday/Monday Bibi timing is chatter, not a fire rule.",
    "",
    "### How to read a quiet / warm board",
    "- Score ~30–50 + AER 0–1 + STRAT HOT + L2 CONUS = **elevated strategic watch / NOT GO** — wait for AER≥3 + peer.",
    "- Do **not** say “all clear” solely because tankers=0. Do **not** say “GO” solely because L2 fired or STRAT is HOT.",
    "- Do **not** issue FRO price forecasts or buy/sell calls — ACTION line is froGuidance only.",
    "- East Africa HOT = underwriter-path freight watch (FRO/VLCC), **not** Israel go and **not** automatic Cape-closed.",
  ];
  return lines.join("\n");
}

const NEWS_PRIORITY_RE =
  /\b(Hormuz|Strait|Kharg|fee[- ]?free|fee\b|OFAC|tanker|VLCC|shipping|oil|Brent|WTI|BDTI|TD3C|Cape\b|war[- ]?risk|IRGC|CENTCOM|UKMTO|NAVWARN|Oman|TRIM|ceasefire|deal|Ch\.?\s*13|Channel\s*13|Kan\b|Bataan|Florida|George\s+Washington|Philippine\s+Sea|SSGN|missile|drone|boarded|seized|al-?Shabaab|Puntland|Bosaso|Kismayo|Hobyo|Somali\s+basin)\b/i;

const NEWS_NOISE_RE =
  /\b(Ukraine|Kyiv|Zelensky|wildfire|wild fire|California\s+fire|lifestyle|football|soccer|celebrity|recipe|tourism)\b/i;

const TG_PRIORITY_RE =
  /\b(Hormuz|Strait|Kharg|fee\b|OFAC|Ch\.?\s*13|Channel\s*13|Kan\b|CENTCOM|UKMTO|NAVWARN|tanker|VLCC|ADNOC|IRGC|war[- ]?risk|Bataan|Florida|George\s+Washington|Philippine\s+Sea|missile|drone|Shahed|boarded|seized|ceasefire|deal|Erbil|Marib|Patriot|MQ-9|defense\s+industr|al-?Shabaab|Puntland|Bosaso|Kismayo|Hobyo)\b/i;

const TG_NOISE_RE =
  /\b(lifestyle|recipe|football|soccer|tourism|celebrity|PressTV\s+Live|apartment\s+for\s+sale|#advertising|gymnast|Twitch|Hasan\s+Piker|Pekingese|wildfire|Halkidiki|Messi|back-to-school|Rent\s+Now)\b/i;

/** Hard demote RU-UA / off-theater clutter that floods the panel sample. */
const TG_OFFTHEATER_RE =
  /\b(Ukraine|Kyiv|Zelensky|Kramatorsk|Donetsk|Zaporizhzhia|Wildberries|Bashkortostan|Sevastopol|SVO\b|Kuril|Iturup|TCC\b|mobilization)\b/i;

const SHIP_KEEP_RE =
  /\b(Bataan|Florida|George\s+Washington|Philippine\s+Sea|SSGN|SSN)\b/i;

function tgChannelKey(p: OsintTelegramPost): string {
  const fromLink = p.link.match(/t\.me\/([^/?#]+)/i)?.[1];
  return (fromLink ?? p.channel).toLowerCase().replace(/^@/, "");
}

function tgDedupeKey(p: OsintTelegramPost): string {
  const link = (p.link || "").toLowerCase().replace(/\/$/, "");
  const normLink = link.replace(/t\.me\/middle_east_spectator\//i, "t.me/middle_east_spectator/");
  if (normLink.includes("t.me/")) return normLink;
  return `${tgChannelKey(p)}|${p.text.slice(0, 96).toLowerCase()}`;
}

function tgAgeHours(p: OsintTelegramPost): number | null {
  const ms = Date.parse(p.time);
  if (!Number.isFinite(ms)) return null;
  return (Date.now() - ms) / 3_600_000;
}

export type DeepSeekPasteOpts = OsintPackOpts & {
  symbol?: string;
  maxChars?: number;
  softWarnChars?: number;
};

export type DeepSeekPasteResult = {
  symbol: string;
  generatedAt: string;
  markdown: string;
  chars: number;
  tokensEstimate: number;
  maxChars: number;
  softWarnChars: number;
  softWarn: boolean;
  truncated: boolean;
  sectionsIncluded: string[];
  sectionsDropped: string[];
  schemaVersion: string;
};

function resolveMaxChars(override?: number): number {
  if (override != null && Number.isFinite(override) && override >= 8_000) {
    return Math.floor(override);
  }
  const env = Number(process.env.DEEPSEEK_PASTE_MAX_CHARS);
  if (Number.isFinite(env) && env >= 8_000) return Math.floor(env);
  return DEFAULT_DEEPSEEK_MAX_CHARS;
}

function resolveSoftWarn(override?: number, maxChars?: number): number {
  if (override != null && Number.isFinite(override) && override >= 8_000) {
    return Math.floor(override);
  }
  const env = Number(process.env.DEEPSEEK_PASTE_SOFT_WARN_CHARS);
  if (Number.isFinite(env) && env >= 8_000) return Math.floor(env);
  const max = maxChars ?? DEFAULT_DEEPSEEK_MAX_CHARS;
  return Math.max(max, DEFAULT_DEEPSEEK_SOFT_WARN_CHARS);
}

export function estimateTokens(chars: number): number {
  return Math.max(0, Math.round(chars / 4));
}

function scoreNews(n: OsintNewsHeadline): number {
  const blob = `${n.source} ${n.title} ${n.excerpt}`;
  if (NEWS_NOISE_RE.test(blob) && !NEWS_PRIORITY_RE.test(blob)) return -100;
  let score = 0;
  if (/\bHormuz|Strait|Kharg\b/i.test(blob)) score += 40;
  if (/\bfee\b|fee[- ]?free|OFAC|6\s*demands?/i.test(blob)) score += 35;
  if (/\btanker|VLCC|shipping|BDTI|TD3C|Cape\b/i.test(blob)) score += 30;
  if (/\b(al-?Shabaab|Puntland|Bosaso|Kismayo|Hobyo|Somali\s+basin)\b/i.test(blob))
    score += 28;
  if (/\boil|Brent|WTI|war[- ]?risk\b/i.test(blob)) score += 20;
  if (/\bCENTCOM|UKMTO|NAVWARN|IRGC\b/i.test(blob)) score += 25;
  if (/\bCh\.?\s*13|Channel\s*13|Kan\b/i.test(blob)) score += 22;
  if (NEWS_PRIORITY_RE.test(blob)) score += 10;
  if (NEWS_NOISE_RE.test(blob)) score -= 50;
  return score;
}

function scoreTg(p: OsintTelegramPost): number {
  const blob = `${p.channel} ${p.text}`;
  const ch = tgChannelKey(p);
  if (/presstv/i.test(ch) && !TG_PRIORITY_RE.test(p.text)) return -80;
  if (TG_NOISE_RE.test(blob) && !TG_PRIORITY_RE.test(blob)) return -100;
  if (TG_OFFTHEATER_RE.test(blob) && !TG_PRIORITY_RE.test(blob)) return -120;
  // Short media-only captions with no ME keywords (e.g. "Erbil", "-Jay")
  if (p.text.trim().length < 40 && !TG_PRIORITY_RE.test(blob)) return -60;

  let score = 0;
  if (DEEP_CHANNEL_NAMES.has(ch)) score += 18;
  if (TG_PRIORITY_RE.test(blob)) score += 20;
  if (/\bHormuz|Kharg|fee\b|CENTCOM|UKMTO|Ch\.?\s*13|Channel\s*13|ADNOC\b/i.test(blob))
    score += 30;
  if (/\bIRGC|defense\s+industr|MQ-9|Patriot|Shahed\b/i.test(blob)) score += 12;
  if (/\b(al-?Shabaab|Puntland|Bosaso|Kismayo|Hobyo)\b/i.test(blob)) score += 16;
  if (p.relevant) score += 8;
  if (/presstv|gulfnews|france24|aljazeera|rnintel/i.test(ch) && !TG_PRIORITY_RE.test(p.text))
    score -= 20;
  if (/presstv/i.test(ch)) score -= 15;

  const ageH = tgAgeHours(p);
  if (ageH != null) {
    if (ageH <= 24) score += 25;
    else if (ageH <= 72) score += 12;
    else if (ageH <= 168) score += 4;
    else if (ageH > 720) score -= 40; // >30d stale sample junk
  }
  if (TG_OFFTHEATER_RE.test(blob)) score -= 40;
  return score;
}

type BudgetBag = {
  parts: string[];
  maxChars: number;
  truncated: boolean;
  included: string[];
  dropped: string[];
};

function currentLen(bag: BudgetBag): number {
  if (!bag.parts.length) return 0;
  return bag.parts.join("\n").length;
}

function tryAppend(bag: BudgetBag, sectionId: string, chunk: string): boolean {
  const body = chunk.trimEnd();
  if (!body) {
    bag.dropped.push(sectionId);
    return false;
  }
  const sep = bag.parts.length ? "\n" : "";
  const footerReserve = TRUNC_FOOTER.length + 2;
  const nextLen = currentLen(bag) + sep.length + body.length;
  if (nextLen + footerReserve <= bag.maxChars) {
    bag.parts.push(body);
    bag.included.push(sectionId);
    return true;
  }
  const room =
    bag.maxChars - currentLen(bag) - sep.length - footerReserve - 20;
  if (room >= 240) {
    bag.parts.push(`${body.slice(0, room).trimEnd()}\n…`);
    bag.included.push(`${sectionId}(partial)`);
    bag.truncated = true;
    return false;
  }
  bag.dropped.push(sectionId);
  bag.truncated = true;
  return false;
}

function buildNewsSection(
  news: OsintNewsHeadline[],
  limit: number,
): string {
  const ranked = [...news]
    .map((n) => ({ n, score: scoreNews(n) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  if (!ranked.length) return "";
  const lines = [
    "## High-signal news (filtered · excerpts ≤300 chars)",
    "| when | source | title / excerpt |",
    "| --- | --- | --- |",
  ];
  for (const { n } of ranked) {
    const excerpt = (n.excerpt || "").slice(0, 300);
    const cell = excerpt
      ? `**${n.title.slice(0, 140)}** — ${excerpt}`
      : `**${n.title.slice(0, 180)}**`;
    const link = n.link ? ` · ${n.link}` : "";
    lines.push(
      `| ${n.pubDate || "—"} | ${n.source.slice(0, 28)} | ${cell.replace(/\|/g, "/")}${link} |`,
    );
  }
  return lines.join("\n");
}

function buildTgSection(posts: OsintTelegramPost[], limit: number): string {
  const seen = new Set<string>();
  const ranked = [...posts]
    .map((p) => ({ p, score: scoreTg(p), key: tgDedupeKey(p) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .filter((x) => {
      if (seen.has(x.key)) return false;
      seen.add(x.key);
      return true;
    })
    .slice(0, limit);
  if (!ranked.length) return "";
  const lines = [
    "## Telegram (Hormuz / fee / Ch13 / CENTCOM / UKMTO · ranked from live dump)",
    `_Showing ${ranked.length} high-signal posts (deduped). Full deep dump is in Export ZIP → telegram_channel_dump.json — not the thin IRONSIGHT panel sample._`,
  ];
  for (const { p } of ranked) {
    const text = p.text.slice(0, DEEPSEEK_TG_TEXT_CHARS);
    const link = p.link ? ` · ${p.link}` : "";
    lines.push(`- **${p.channel}** · ${p.time}: ${text}${link}`);
  }
  return lines.join("\n");
}

function buildShipOneLiners(
  ships: Array<{
    name: string;
    hull: string;
    lat: number;
    lon: number;
    status: string;
    region: string;
  }>,
): string {
  const keep = ships.filter((s) =>
    SHIP_KEEP_RE.test(`${s.name} ${s.hull} ${s.region}`),
  );
  if (!keep.length) return "";
  const lines = ["## Warship stamps (one-liners only · not full IRONSIGHT list)"];
  for (const s of keep.slice(0, 4)) {
    lines.push(
      `- ${s.name}${s.hull ? ` (${s.hull})` : ""} · ${s.status} @ ${s.lat.toFixed(2)},${s.lon.toFixed(2)} · ${s.region}`,
    );
  }
  return lines.join("\n");
}

function buildDeskPostureSection(opts: {
  froGuidance: string;
  scenarioLabel: string;
  israelScore: number;
  lockLevel: string | null;
  lockCount: number | null;
  ghostScore: number | null;
  ghostMax: number | null;
  ghostRegime: string | null;
  dfBand: string | null;
  dfScore: number | null;
  bookFocus46c: number;
  goLanguageStatus?: string | null;
  goLanguageHits?: string[];
}): string {
  const ghost =
    opts.ghostScore != null
      ? `${opts.ghostScore}${opts.ghostMax != null ? `/${opts.ghostMax}` : "/7"}${opts.ghostRegime ? ` · ${opts.ghostRegime}` : ""}`
      : "—";
  const locks =
    opts.lockLevel != null
      ? `${opts.lockLevel.toUpperCase()}${opts.lockCount != null ? ` · ${opts.lockCount}/5` : ""}`
      : "—";
  const df =
    opts.dfBand != null
      ? `${opts.dfBand}${opts.dfScore != null ? ` · ${opts.dfScore}` : ""}`
      : "—";
  const goHits =
    opts.goLanguageHits && opts.goLanguageHits.length
      ? [
          `- **GO-01 quotes (soft wake, not High-go):** ${opts.goLanguageStatus ?? "lit"}`,
          ...opts.goLanguageHits.slice(0, 4).map((h) => `  - ${h}`),
        ]
      : [];
  return [
    "## Desk posture (action first — scenario titles demoted)",
    `- **ACTION:** ${opts.froGuidance}`,
    `- **NOT go / locks:** ${locks}`,
    `- **Ghost:** ${ghost}`,
    `- **DF band:** ${df}`,
    `- **Book qty:** TOTAL Sep $46c = **${opts.bookFocus46c}×** (all accounts)`,
    `- _Scenario title (ignore for trade):_ ${opts.scenarioLabel} · score ${opts.israelScore}`,
    ...goHits,
    "",
    "### High-go gate (Tradehole — not DeepSeek narrative)",
    "- **High-go** = AER-01 HOT (**≥3 Levant tankers**) **AND** hard peer (NAV-01 lit / DIP-01 HOT / ELEC-01 HOT / AER-02 HOT).",
    "- **NOT** High-go: E-6B + AWACS + tankers “all together” (DeepSeek story). E-6B = **5-Lock L2** (Hormuz/C2), separate from Israel AER ladder.",
    "- STRAT-01/02 / GO-01 = **soft pressure** — elevated watch, never sole go. POL-03 MOU Sunday is PAST/DISABLED.",
    "- Soft OSINT (1 tanker, DIP warm, empty AIS, hex-watch K35R) ≠ High-go / Doomsday / buy-the-ask.",
    "- See **Interpretive heuristics** below for EMCON / time-window / CONUS-L2 / politics overlays.",
  ].join("\n");
}

/**
 * Compact multi-account book from portfolio cache + Robinhood account store.
 * Avoids a live E*TRADE round-trip on every DeepSeek paste.
 */
function buildAllAccountsBookSection(): string {
  const summary = buildBookSummary();
  const lines: string[] = [
    "## Book — ALL accounts (Rollover + Roth + Robinhood)",
    "Sum focus Sep $46c across every linked account. Do **not** treat a single 0× row as flat / buy-the-ask. Robinhood is a **separate** account (not merged into E*TRADE views).",
  ];
  for (const bag of summary.byAccount) {
    if (bag.accountIdKey === "robinhood") {
      const legs = bag.legs.map((l) => `${l.quantity}× ${l.description}`);
      lines.push(`- **Robinhood**: ${legs.join(" · ") || "0×"}`);
    } else {
      lines.push(`- **${bag.account}**: ${bag.focus46c}× Sep $46c`);
    }
  }
  lines.push(
    `- **TOTAL focus Sep $46c: ${summary.focus46cTotal}×** (all accounts)`,
  );
  return lines.join("\n");
}

/**
 * Build a DeepSeek-web-safe markdown paste from the live OSINT pack.
 */
export async function buildDeepSeekPaste(
  opts: DeepSeekPasteOpts = {},
): Promise<DeepSeekPasteResult> {
  const symbol = (opts.symbol ?? "FRO").toUpperCase();
  const maxChars = resolveMaxChars(opts.maxChars);
  const softWarnChars = resolveSoftWarn(opts.softWarnChars, maxChars);

  const pack = await buildOsintPack(symbol, opts);
  const ai = pack.aiPack;
  const paste = pack.pasteInputs;
  const generatedAt = pack.generatedAt;

  const bag: BudgetBag = {
    parts: [],
    maxChars,
    truncated: false,
    included: [],
    dropped: [],
  };

  const header = [
    `# Tradehole DeepSeek paste · ${symbol} · ${PACK_SCHEMA_VERSION}`,
    `generatedAt: ${generatedAt}`,
    `budget: ≤${maxChars.toLocaleString()} chars (web UI). Prefer this over full Export for AI clipboard.`,
    "",
    PASTE_RULES_HEADER,
    "",
  ].join("\n");
  tryAppend(bag, "header", header);

  // Desk posture first — froGuidance / locks / ghost / DF / book qty (titles demoted)
  const book = buildBookSummary();
  const desk = paste?.desk;
  let israelGuidance =
    "FRO: HOLD / watch — open Israel Strike panel for live froGuidance.";
  let scenarioLabel = "(unavailable)";
  let israelScore = 0;
  let goLanguageStatus: string | null = null;
  let goLanguageHits: string[] = [];
  try {
    const ist = await buildIsraelStrikeTells();
    israelGuidance = ist.froGuidance;
    scenarioLabel = ist.statusLabel;
    israelScore = ist.score;
    goLanguageStatus = ist.inputs.goLanguageStatus ?? null;
    goLanguageHits = ist.inputs.goLanguageHits ?? [];
  } catch {
    const cached = getLatestIntelAlarm();
    if (cached) {
      israelGuidance = `FRO: HOLD / watch — 5-Lock ${cached.level} · ${cached.lockCount}/5 (Israel tells unavailable)`;
    }
  }
  tryAppend(
    bag,
    "desk_posture",
    buildDeskPostureSection({
      froGuidance: israelGuidance,
      scenarioLabel,
      israelScore,
      lockLevel: desk?.lockLevel ?? getLatestIntelAlarm()?.level ?? null,
      lockCount: desk?.lockCount ?? getLatestIntelAlarm()?.lockCount ?? null,
      ghostScore: desk?.ghostScore ?? null,
      ghostMax: desk?.ghostMax ?? null,
      ghostRegime: desk?.ghostRegime ?? null,
      dfBand: desk?.dfBand ?? null,
      dfScore: desk?.dfScore ?? null,
      bookFocus46c: book.focus46cTotal,
      goLanguageStatus,
      goLanguageHits,
    }),
  );

  // Interpretive framework — next DeepSeek chat should not be raw-signal-only
  tryAppend(bag, "interpretive_heuristics", buildInterpretiveHeuristicsSection());

  // Multi-account book (always — so 0× Roth/RH cannot dominate)
  tryAppend(bag, "book_all_accounts", buildAllAccountsBookSection());

  // 1. AI_BRIEF intact if under budget
  if (ai?.briefMarkdown) {
    const brief = ai.briefMarkdown.trimEnd();
    if (
      brief.length + currentLen(bag) + TRUNC_FOOTER.length + 80 <=
      maxChars
    ) {
      tryAppend(bag, "AI_BRIEF", brief);
    } else {
      // keep as much of the brief as possible
      tryAppend(bag, "AI_BRIEF", brief);
    }
  } else {
    bag.dropped.push("AI_BRIEF");
  }

  // 2–3. Contradiction one-liner + edges + falsifiers + physical (supplement if brief missing pieces)
  if (ai && !bag.included.some((s) => s.startsWith("AI_BRIEF"))) {
    const c = ai.contradiction;
    const contrLines = [
      "## Contradiction",
      `**Market:** ${c.marketSays}`,
      `**Reality:** ${c.realitySays}`,
      "",
      "## Edges",
      "| thesis | reality | market | edge | conf |",
      "| --- | ---: | ---: | ---: | --- |",
      ...c.edges.map(
        (e) =>
          `| ${e.id} | ${e.realityPct ?? "—"} | ${e.marketPct ?? "—"} | ${e.edgePp ?? "—"} | ${e.confidence} |`,
      ),
      "",
      "## Top falsifiers",
      ...(c.falsifiers.length
        ? c.falsifiers.slice(0, 8).map((f) => `- ${f}`)
        : ["- (none hard-lit)"]),
    ];
    tryAppend(bag, "contradiction+falsifiers", contrLines.join("\n"));
  }

  // Physical lag one-liners (TD3C + key hull stamps) — brief already has PortWatch/BDTI
  {
    const chunks: string[] = [];
    if (paste?.td3cLine) {
      chunks.push("## Physical lags (latest row only)", `- ${paste.td3cLine}`);
    }
    const shipMd = buildShipOneLiners(paste?.ships ?? []);
    if (shipMd) chunks.push(shipMd);
    if (chunks.length) tryAppend(bag, "physical_lags", chunks.join("\n\n"));
    else bag.dropped.push("physical_lags");
  }

  {
    const ea = paste?.eastAfrica;
    if (ea) {
      const lines = [
        "## East Africa / Cape-route watch (soft freight — not High-go)",
        `Regime: **${ea.regime}** — ${ea.read}`,
        ea.lit.length ? `Lit: ${ea.lit.join(" · ")}` : "Lit: (none)",
        ...ea.evidence.slice(0, 5).map((e) => `- ${e}`),
        "Honesty: no live Somali AIS; one headline ≠ Cape-closed; not an Israel go peer. Sunday/Monday Bibi timing is chatter, not a fire rule.",
      ];
      tryAppend(bag, "east_africa_cape", lines.join("\n"));
    } else {
      bag.dropped.push("east_africa_cape");
    }
  }

  // Telegram early — dump signal before catalysts/news burn the budget
  {
    const tgMd = buildTgSection(paste?.telegram ?? [], DEEPSEEK_TG_LIMIT);
    if (tgMd) tryAppend(bag, "telegram", tgMd);
    else bag.dropped.push("telegram");
  }

  // 4. Book — only if AI_BRIEF missing
  if (ai && !bag.included.some((s) => s.startsWith("AI_BRIEF"))) {
    tryAppend(
      bag,
      "book",
      `## Book\n${ai.contradiction.bookImplication}`,
    );
  }

  // 5. Catalysts armed only — skip when AI_BRIEF already covered the fuller list
  if (ai?.catalysts?.length && !bag.included.some((s) => s.startsWith("AI_BRIEF"))) {
    const armed = ai.catalysts.filter((c) => c.armed || c.triggered);
    if (armed.length) {
      const lines = [
        "## Catalysts (armed only · short)",
        ...armed.map((c) => {
          const flag = c.triggered ? "TRIGGERED" : "armed";
          return `- **${c.id}** [${flag}] ${c.label} — ${c.whatToWatch.slice(0, 160)}`;
        }),
      ];
      tryAppend(bag, "catalysts_armed", lines.join("\n"));
    }
  } else {
    bag.dropped.push("catalysts_armed");
  }

  // 6. Decision Footprint lit signals only (from canonical events)
  const litEvents = (ai?.events ?? []).filter((e) =>
    e.type.startsWith("df_"),
  );
  if (litEvents.length) {
    const lines = [
      "## Decision Footprint — lit signals only",
      ...litEvents.map(
        (e) =>
          `- **${e.type.replace(/^df_/, "")}** · ${e.title}${e.detail ? ` — ${e.detail.slice(0, 160)}` : ""}${e.source ? ` (${e.source})` : ""}`,
      ),
    ];
    tryAppend(bag, "df_lit", lines.join("\n"));
  } else {
    bag.dropped.push("df_lit");
  }

  // 7. Market Surprise theses compact
  if (ai?.contradiction.edges.length) {
    // Prefer richer event verdicts when present
    const edgeEvents = (ai.events ?? []).filter(
      (e) => e.type === "market_surprise_edge",
    );
    const lines = [
      "## Market Surprise theses (compact)",
      "| thesis | edge pp | note |",
      "| --- | ---: | --- |",
    ];
    for (const e of ai.contradiction.edges) {
      const ev = edgeEvents.find((x) => x.tags?.includes(e.id));
      const note = (ev?.detail ?? e.label).slice(0, 120);
      lines.push(
        `| ${e.id} | ${e.edgePp ?? "—"} | ${note.replace(/\|/g, "/")} |`,
      );
    }
    tryAppend(bag, "surprise_theses", lines.join("\n"));
  } else {
    bag.dropped.push("surprise_theses");
  }

  // 8. News headlines + excerpts
  const newsMd = buildNewsSection(paste?.news ?? [], 22);
  if (newsMd) tryAppend(bag, "news", newsMd);
  else bag.dropped.push("news");

  // telegram already appended early (after physical_lags)

  // 10. Honesty gaps short — only if AI_BRIEF not present (avoid duplicate)
  if (ai && !bag.included.some((s) => s.startsWith("AI_BRIEF"))) {
    const gapBlock = [
      "## Honesty gaps (do not hallucinate)",
      "- ❌ No live commercial AIS scrape",
      "- ❌ No live Baltic TD3C FFA (license)",
      "- ❌ No Platts Dated Brent (license)",
      "- PortWatch / BDTI / TD3C reprints are lagged — respect asOf",
    ].join("\n");
    tryAppend(bag, "honesty_gaps", gapBlock);
  } else {
    bag.dropped.push("honesty_gaps_dup");
  }

  // 11. Output contract — reinforce if brief missing; else short pointer
  if (!bag.included.some((s) => s.startsWith("AI_BRIEF"))) {
    tryAppend(
      bag,
      "output_contract",
      [
        "## Output contract for DeepSeek",
        "Return: (1) contradiction one-liner (2) top falsifiers (3) which catalysts are closest (4) HOLD/TRIM/ADD with size discipline (5) what would flip the thesis. Cite event ids / URLs when possible.",
      ].join("\n"),
    );
  } else if (ai?.deepseekPrompt && currentLen(bag) < maxChars * 0.7) {
    tryAppend(
      bag,
      "deepseek_prompt_stub",
      `## DEEPSEEK_PROMPT (stub)\n${ai.deepseekPrompt.trim()}`,
    );
  }

  if (bag.truncated) {
    bag.parts.push(TRUNC_FOOTER);
  }

  let markdown = bag.parts.join("\n").trimEnd() + "\n";
  if (markdown.length > maxChars) {
    markdown =
      markdown.slice(0, Math.max(0, maxChars - TRUNC_FOOTER.length - 2)).trimEnd() +
      `\n${TRUNC_FOOTER}\n`;
    bag.truncated = true;
  }

  const chars = markdown.length;
  return {
    symbol,
    generatedAt,
    markdown,
    chars,
    tokensEstimate: estimateTokens(chars),
    maxChars,
    softWarnChars,
    softWarn: chars >= softWarnChars || bag.truncated,
    truncated: bag.truncated,
    sectionsIncluded: bag.included,
    sectionsDropped: bag.dropped,
    schemaVersion: PACK_SCHEMA_VERSION,
  };
}
