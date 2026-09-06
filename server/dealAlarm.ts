/**
 * Overnight deal + blind-spot watch (so you don't babysit Telegram).
 *
 * Core deal alarms: signature / fee / US accept-reject / Pezeshkian
 * Blind-spot 7:
 *  1. US Blink — sanctions/blockade/frozen-funds capitulation → TRIM
 *  2. Khamenei Rejection — Leader disapproves draft → BUY/HOLD
 *  3. Bataan Course Correction — IRONSIGHT lat/lon leaves stamp → treat as L1 RED
 *  4. Oman Backs Out — mediation collapse → BUY
 *  5. Deal Text Leak — exact fee % → TRIM if >0, BUY/HOLD if 0%
 *  6. Physical Fixture Spike — VLCC >~$400k/day → HOLD
 *  7. Black Sea Spillover — hard merchant hit / port close / grain corridor death → HOLD
 *     (not RivieraMM "strikes continue" / ceasefire-reject churn; 18h kind cooldown)
 */
import { getStockQuote } from "./market";

const IRONSIGHT_URL = process.env.IRONSIGHT_URL ?? "http://localhost:3170";
const DEAL_ALARM_POLL_MS = Number(process.env.DEAL_ALARM_POLL_MS ?? 45_000);
/** News/telegram older than this window do not create alarm events or arm checklist. */
function dealNewsWindowHours(): number {
  const n = Number(process.env.DEAL_ALARM_RECENCY_HOURS ?? 20);
  return Number.isFinite(n) && n > 0 ? n : 20;
}
function dealNewsMaxAgeMs(): number {
  return dealNewsWindowHours() * 60 * 60 * 1000;
}

/** Baseline stamp from your pack (Bataan Deployed Persian Gulf). */
const BATAAN_BASELINE = { lat: 26.1, lon: 50.5 };
/** Northward sprint / west toward Kharg-ish box. */
const BATAAN_NORTH_LAT = 27.0;
const BATAAN_WEST_LON = 49.0;
const BATAAN_MOVE_DEG = 0.35;

export type DealAlarmLevel = "quiet" | "watch" | "hold" | "trim" | "buy" | "red";

export type DealAlarmKind =
  | "deal_signed_no_fee"
  | "deal_signed_with_fee"
  | "deal_signed_unclear"
  | "us_rejects_fee"
  | "us_accepts_deal"
  | "us_blink"
  | "khamenei_rejection"
  | "khamenei_sign"
  | "oman_backs_out"
  | "deal_breakdown"
  | "fee_pct_leak"
  | "fee_dispute"
  | "pezeshkian_speech"
  | "bataan_course"
  | "vlcc_fixture_spike"
  | "black_sea_spillover"
  | "war_risk_spike"
  | "fro_gap";

export type DealAlarmSeverity = "info" | "warn" | "critical";

export type DealAlarmAction = "hold" | "trim" | "watch" | "buy" | "red";

export type DealAlarmEvent = {
  id: string;
  kind: DealAlarmKind;
  severity: DealAlarmSeverity;
  action: DealAlarmAction;
  title: string;
  read: string;
  source: string;
  link: string | null;
  detectedAt: string;
};

export type DealAlarmState = {
  evaluatedAt: string;
  level: DealAlarmLevel;
  read: string;
  actionBias: DealAlarmAction | "none";
  events: DealAlarmEvent[];
  warRiskRegime: string;
  stateMediaRegime: string;
  froPrice: number | null;
  froChangePct: number | null;
  bataan: {
    lat: number | null;
    lon: number | null;
    baselineLat: number;
    baselineLon: number;
    status: string | null;
    region: string | null;
    moved: boolean;
    read: string;
  };
  checklist: Array<{
    id: string;
    label: string;
    priority: "p0" | "p1" | "p2";
    status: "armed" | "quiet" | "unknown";
    action: string;
  }>;
  links: Array<{ label: string; href: string }>;
  sources: Record<string, "ok" | "error" | "partial">;
};

type NewsItem = { title: string; link: string; pubDate: string; source: string };

let latestState: DealAlarmState | null = null;
let previousWarRisk: string | null = null;
let previousFroChange: number | null = null;
let bataanBaseline: { lat: number; lon: number } | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let evalInFlight = false;
/** Earliest RSS/telegram pubDate ms per kind-independent content key (survives Google date flaps). */
const earliestPubByContent = new Map<string, number>();
/** Suppress repeat Black Sea HOLD overlays from near-duplicate wires (RivieraMM churn). */
let lastBlackSeaFireMs: number | null = null;

function blackSeaKindCooldownMs(): number {
  const h = Number(process.env.BLACK_SEA_ALARM_COOLDOWN_HOURS ?? 18);
  return (Number.isFinite(h) && h > 0 ? h : 18) * 60 * 60 * 1000;
}

const NOISE_RE =
  /Ona\s+Batlle|OpenAI|Anthropic|Arsenal|Codex|LIV\s+Golf|Barcelona|Gartner|Techzine|football|soccer|methamphetamine/i;

const HORMUZ_CTX_RE =
  /Hormuz|Strait|Oman|Tasnim|ONA\b|transit\s*fee|passage\s*fee|\btoll\b|corridor|shipping\s+route|Khamenei|Pezeshkian|Iran[- ]Oman|Fifth\s+Fleet|war[- ]?risk|sanctions?\s+relief|blockade|frozen\s+funds/i;

const FEE_RE =
  /transit\s*fee|passage\s*fee|\btolls?\b|shipping\s+fee|no\s+deal\s+without|fee\s+structure|fee\s+dispute|with\s+(a\s+)?fee|voluntary\s+insurance/i;

const NO_FEE_RE =
  /without\s+(a\s+)?fees?|no\s+fees?|fee[- ]free|free\s+passage|without\s+tolls?|fees?\s+dropped|drops?\s+fee|0\s*%\s*(fee|toll)/i;

const US_ACTOR_RE =
  /\b(?:Trump|U\.S\.|US|United States|White\s+House|Washington|Pentagon|State\s+Department|Treasury|Bessent|Blinken|Rubio|Marco\s+Rubio|OFAC)\b/i;

/**
 * Anti-accept stance: threaten/warn/oppose/against/reject/block near toll/fee/agreement.
 * Word-bound `\bblock(s|ed|ing)?\b` — bare `blocks?` must not match inside `blockade`.
 */
const US_ANTI_TOLL_RE =
  /(threaten(?:s|ed|ing)?|warn(?:s|ed|ing)?|oppose[sd]?|opposing|against|reject(?:s|ed|ing)?|refus(?:e|es|ed|ing)|\bblock(?:s|ed|ing)?\b).{0,90}(toll|fee|agreement|deal|corridor)/i;

const US_ANTI_TOLL_REV_RE =
  /(toll|fee|agreement|deal|corridor).{0,60}(threaten(?:s|ed|ing)?|warn(?:s|ed|ing)?|oppose[sd]?|against|reject(?:s|ed|ing)?|refus(?:e|es|ed|ing)|\bblock(?:s|ed|ing)?\b)/i;

/** Political slam of the blockade itself — not a US reject of fee/deal terms. */
const BLOCKADE_CRITICISM_RE =
  /(stupid|arrogant|arrogance|foolish|idiotic|mistake|pride|criticiz(?:e|es|ed|ing|ism)?|condemn(?:s|ed|ing)?).{0,80}blockade|blockade.{0,80}(stupid|arrogant|arrogance|foolish|idiotic|mistake|pride|criticiz|condemn)|(?:senator|lawmaker|congress(?:man|woman)?|rep\.|representative).{0,100}(blockade|Trump.{0,40}blockade).{0,80}(stupid|arrogant|arrogance|foolish|mistake|pride|criticiz)/i;

/**
 * Iran (not US) cutting US messaging / threatening to block Hormuz — deal path souring.
 * Must not fire us_rejects_fee via incidental "U.S." + "block Hormuz".
 */
const IRAN_DEAL_BREAKDOWN_RE =
  /\bIran\b.{0,100}(stopp(?:ing|ed)?|halts?|halted|suspend(?:s|ed|ing)?|cuts?|cutting|ends?|ending|ceas(?:e|es|ed|ing)).{0,50}(message|messaging|exchanges?|talks?|negotiations?|contacts?|dialogue).{0,40}(?:U\.S\.|US|United\s+States|Washington)|\bIran\b.{0,80}(may\s+|could\s+|might\s+|threaten(?:s|ed|ing)?\s+to\s+|warn(?:s|ed|ing)?\s+(?:it\s+)?(?:will\s+|may\s+)?)?\bblock(?:s|ed|ing)?\b.{0,40}Hormuz|\bIran\b.{0,60}(threaten(?:s|ed|ing)?|warn(?:s|ed|ing)?).{0,40}(block|close|shut|seal).{0,40}Hormuz|(stopp(?:ing|ed)?|halts?|suspend(?:s|ed|ing)?).{0,40}(message|messaging|exchanges?).{0,40}(with\s+)?(?:U\.S\.|US|United\s+States).{0,80}(block|Hormuz)|\bIran\b.{0,80}(?:issued|issues|delivers?).{0,40}ultimatum.{0,150}(?:lift|lifting|ease|easing|remove|end).{0,40}(?:naval\s+)?blockade|\bIran\b.{0,120}(?:threaten(?:s|ing)?|warn(?:s|ing)?).{0,60}(?:expansion|escalat).{0,40}war/i;

/**
 * Known June 1 2026 Tasnim/Reuters wire family — Google often re-surfaces with a fresh
 * RSS pubDate. Earliest-pub memory alone fails on cold start when only the flap date
 * is seen first. Hard-exclude regardless of pubDate (same pattern as intel Natanz reprints).
 */
const STALE_IRAN_MESSAGING_HORMUZ_REPRINT_RE =
  /\bIran\b.{0,120}(stopp(?:ing|ed)?|halts?|halted|suspend(?:s|ed|ing)?|freez(?:e|es|ing)|cuts?|cutting).{0,50}(message|messaging|exchanges?|negotiations?|talks?).{0,80}(U\.?S\.?|United\s+States|Washington).{0,100}(Hormuz|block)|Iran\s+is\s+stopping\s+message\s+exchanges|may\s+block\s+Hormuz.{0,40}Tasnim|vows?\s+to\s+(?:['"]?completely['"]?\s+)?block\s+(?:the\s+)?(?:Strait\s+of\s+)?Hormuz|stops?\s+negotiations?\s+with\s+(?:the\s+)?U\.?S\.?.{0,60}block.{0,40}Hormuz/i;

/**
 * Word-bound accept verbs — bare `agree` must not match inside `agreement`.
 * After the verb, require deal objects (Oman/Hormuz/deal/fee/…) — bare trailing
 * "Iran" alone matched outlet tags like "… - Iran International".
 */
const US_ACCEPT_NEAR_DEAL_RE =
  /(Trump|U\.?S\.?|White\s+House|Washington|Treasury|Bessent).{0,40}\b(?:accept(?:s|ed|ing)?|agree(?:s|d|ing)?|endorse(?:s|d|ment)?|welcome(?:s|d)?|backs?|approves?)\b.{0,50}(Oman|Hormuz|deal|agreement|corridor|fee|toll|Iran[- ]Oman|(?:with|of)\s+Iran)/i;

const US_ACCEPT_IRAN_OMAN_RE =
  /\b(?:accept(?:s|ed|ing)?|agree(?:s|d|ing)?|endorse(?:s|d)?)\b.{0,40}(Iran|Oman).{0,30}(Hormuz|deal|agreement|corridor)/i;

/**
 * Iran demanding the US accept Iran's terms / Hormuz stays closed unless —
 * confrontation / fee leverage, NOT US deal endorsement (CRITICAL TRIM).
 * Smoke FPs: "Iran says Hormuz to stay closed unless US accepts its terms".
 * Keep TPs: "US accepts Oman Hormuz deal", "White House accepts terms of Oman…".
 */
const IRAN_DEMANDS_US_ACCEPT_RE =
  /\bunless\b.{0,60}(?:U\.S\.|US|United\s+States|Trump|White\s+House|Treasury).{0,40}\baccept|\b(Hormuz|Strait).{0,100}\b(stay\s+)?closed\s+unless\b|\bIran\b.{0,120}(says?|said|demands?|demanding|insists?|insisting|vows?|warns?|warning|threatens?|threatening|ultimatum|issued).{0,90}(?:U\.S\.|US|United\s+States|Trump|White\s+House).{0,120}(?:accept|lift|lifting|ease|easing|remove|end).{0,40}(?:naval\s+)?(?:blockade|sanctions?)|\bIran\b.{0,80}(?:issued|issues|delivers?).{0,40}ultimatum.{0,150}(?:lift|lifting|ease|easing|remove|end).{0,40}(?:naval\s+)?blockade/i;

/**
 * "US accepts its/our/Iran's terms" — may be blink (capitulation) but is NOT
 * us_accepts_deal (deal/corridor endorsement). Keep out of usAccepts only.
 */
const US_ACCEPTS_FOREIGN_TERMS_RE =
  /(U\.?S\.?|United\s+States|Trump|White\s+House|Treasury).{0,40}\baccept(?:s|ed|ing)?\b.{0,50}\b(its|our|Iran'?s|Iranian|Tehran'?s)\s+terms\b/i;

/**
 * Omar is a common OCR / wire typo for Oman in Hormuz toll chatter.
 * Only rewrite when Hormuz / toll / Iran context is present.
 */
function normalizeDealTitle(title: string): string {
  if (!/\bOmar\b/i.test(title)) return title;
  if (!/Hormuz|Strait|toll|fee|Iran|transit|passage|agreement|deal/i.test(title)) {
    return title;
  }
  return title.replace(/\bOmar\b/gi, "Oman");
}

function signedDeal(title: string): boolean {
  if (/resign|resignation|denies\s+threatening/i.test(title)) return false;
  if (
    /(Khamenei|Supreme\s+Leader).{0,48}(sign|approv|endorse|green[- ]?light).{0,40}(deal|agreement|Hormuz|corridor|fee|toll)/i.test(
      title,
    ) ||
    /(deal|agreement|Hormuz|corridor).{0,40}(Khamenei|Supreme\s+Leader).{0,24}(sign|approv|endorse)/i.test(
      title,
    )
  ) {
    return true;
  }
  if (
    /(sign(?:ed|s|ature)?|approves?|finaliz(?:e|ed|es)|joint\s+statement).{0,48}(deal|agreement|corridor|Hormuz)/i.test(
      title,
    )
  ) {
    return true;
  }
  if (
    /(deal|agreement|corridor).{0,40}(sign(?:ed|s)?|finaliz(?:e|ed)|done|reached|announced)/i.test(
      title,
    ) &&
    /Hormuz|Oman|Iran/i.test(title) &&
    !/draft|awaits?|pending|reportedly|talks\s+over|final\s+stage/i.test(title)
  ) {
    return true;
  }
  return false;
}

/** Known June-2026 Tasnim/Reuters messaging+Hormuz reprints — never live-alarm. */
function isStaleIranMessagingHormuzReprint(title: string): boolean {
  return STALE_IRAN_MESSAGING_HORMUZ_REPRINT_RE.test(normalizeDealTitle(title));
}

/** Iran walkout / Hormuz-block threat — distinct from US fee reject. */
function iranDealBreakdown(title: string): boolean {
  const t = normalizeDealTitle(title);
  if (isStaleIranMessagingHormuzReprint(t)) return false;
  return IRAN_DEAL_BREAKDOWN_RE.test(t);
}

function usRejects(title: string): boolean {
  const t = normalizeDealTitle(title);
  if (!US_ACTOR_RE.test(t)) return false;
  // Senator/commentary slamming the blockade as stupid ≠ reject of fee/deal terms
  if (BLOCKADE_CRITICISM_RE.test(t)) return false;
  // Iran cutting US messaging / may block Hormuz ≠ US rejecting a fee/toll deal
  if (iranDealBreakdown(t)) return false;
  // Iran refusing fee/deal (incidental "U.S." in "rejects US terms") → fee_dispute, not us_rejects
  if (
    /\bIran\b.{0,100}(refus(?:e|es|ed|ing)|reject(?:s|ed|ing)?|won't\s+accept|will\s+not\s+(?:accept|sign)|insist(?:s|ed|ing)?).{0,80}(fee|toll|deal|agreement|without|Hormuz)/i.test(
      t,
    ) &&
    !/(Trump|White\s+House|Bessent|Treasury|Pentagon|State\s+Department).{0,80}(reject|refus|warn|threaten|oppose|\bblock)/i.test(
      t,
    )
  ) {
    return false;
  }
  // Need fee/toll/deal terms — mere "blockade" is not reject context
  if (!/fee|toll|deal|agreement|Hormuz|corridor/i.test(t)) {
    return false;
  }
  // US official threatens / warns Oman (or Omar→Oman) against tolling/fee agreement with Iran
  if (
    US_ANTI_TOLL_RE.test(t) ||
    US_ANTI_TOLL_REV_RE.test(t) ||
    /(threaten(?:s|ed|ing)?|warn(?:s|ed|ing)?).{0,60}(Oman|Iran).{0,50}(against|not\s+to).{0,50}(toll|fee|agreement|deal)/i.test(
      t,
    )
  ) {
    return true;
  }
  // Explicit US reject/refuse/oppose OF fee-toll-deal-corridor / Hormuz terms.
  // Word-bound `\bblock(s|ed|ing)?\b` — must not match inside `blockade`.
  // `block` alone must target fee/toll/deal/agreement/corridor — NOT bare Hormuz
  // (Iran "may block Hormuz" with incidental "U.S." must not fire us_rejects_fee).
  if (
    /(Trump|U\.?S\.?|White\s+House|Washington|Pentagon|State\s+Department|Treasury|Bessent).{0,80}\b(?:reject(?:s|ed|ing)?|refus(?:e|es|ed|ing)|spurn(?:s|ed)?|won't\s+accept|will\s+not\s+accept|oppose[sd]?|opposing)\b.{0,60}(fee|toll|deal|agreement|corridor|Hormuz|Iran|Oman)/i.test(
      t,
    ) ||
    /(Trump|U\.?S\.?|White\s+House|Washington|Pentagon|State\s+Department|Treasury|Bessent).{0,80}\bblock(?:s|ed|ing)?\b.{0,60}(fee|toll|deal|agreement|corridor)/i.test(
      t,
    ) ||
    /(fee|toll|deal|agreement|corridor|Hormuz).{0,50}\b(?:reject(?:s|ed|ing)?|refus(?:e|es|ed|ing)|spurn(?:s|ed)?|won't\s+accept|will\s+not\s+accept)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

function usAccepts(title: string): boolean {
  const t = normalizeDealTitle(title);
  // Threaten/warn/oppose/against/reject/block + toll/fee/agreement is NOT accept
  if (US_ANTI_TOLL_RE.test(t) || US_ANTI_TOLL_REV_RE.test(t)) return false;
  if (/pressure|urges?\s+Oman|asks?\s+Oman/i.test(t)) return false;
  // "threatens X against Y agreement" — against+agreement must not count as accept
  if (
    /threaten(?:s|ed|ing)?|warn(?:s|ed|ing)?/i.test(t) &&
    /against.{0,40}(agreement|deal|toll|fee)/i.test(t)
  ) {
    return false;
  }
  // Iran-as-subject demanding US accept / "unless US accepts" / Hormuz closed unless
  if (IRAN_DEMANDS_US_ACCEPT_RE.test(t)) return false;
  // "Accepts its/Iran's terms" is blink/capitulation framing, not deal endorsement
  if (US_ACCEPTS_FOREIGN_TERMS_RE.test(t)) return false;
  // US must be the grammatical actor of accept/endorse — not a conditional object
  return (
    US_ACCEPT_NEAR_DEAL_RE.test(t) ||
    (US_ACCEPT_IRAN_OMAN_RE.test(t) &&
      /(Trump|U\.?S\.?|White\s+House|Washington|Treasury|Bessent)/i.test(t) &&
      // Iran/Oman accept path still needs US-near-verb (actor), not bare US elsewhere
      /(Trump|U\.?S\.?|White\s+House|Washington|Treasury|Bessent).{0,40}\b(?:accept(?:s|ed|ing)?|agree(?:s|d|ing)?|endorse(?:s|d|ment)?|welcome(?:s|d)?|backs?|approves?)\b/i.test(
        t,
      ))
  );
}

/**
 * Think-tank / advocacy outlets — criticism of waivers ≠ operational US blink.
 * Google News often appends " - fdd.org" / outlet name to the title.
 */
const THINK_TANK_RE =
  /\bfdd\.org\b|\bFDD\b|Foundation\s+for\s+Defense\s+of\s+Democracies|Washington\s+Institute|\bWINEP\b|Heritage\s+Foundation|American\s+Enterprise|\bAEI\b|Hudson\s+Institute|Brookings|\bCSIS\b|Atlantic\s+Council|\bCFR\b|Council\s+on\s+Foreign\s+Relations|Foreign\s+Policy\s+Research|Institute\s+for\s+the\s+Study\s+of\s+War|\bISW\b|JINSA\b|Jewish\s+Institute/i;

/** Wire / gov corroboration in headline (or source tag Google appends). */
const BLINK_PRIMARY_RE =
  /\bReuters\b|\bAP\b|Associated\s+Press|\bWSJ\b|Wall\s+Street\s+Journal|Bloomberg|Treasury|\bOFAC\b|White\s+House|State\s+Department|\.gov\b/i;

/**
 * Soft advocacy framing: "provides/gives … sanctions relief" without a primary action verb.
 * FDD-style headlines must not alone fire CRITICAL TRIM.
 */
const SOFT_RELIEF_FRAMING_RE =
  /\b(provides?|providing|gives?|giving)\b.{0,60}(billions?|unrestricted)?.{0,40}sanctions?\s+relief|\b(provides?|providing|gives?|giving)\b.{0,40}sanctions?\s+relief/i;

/**
 * Soft future/conditional blockade lift — JPost/Axios "expects deal soon, will lift blockade"
 * is contingent optimism (once announced / performance-based), NOT enacted capitulation.
 */
const SOFT_CONDITIONAL_LIFT_RE =
  /\b(will|would|may|might|could|plans?\s+to|ready\s+to|set\s+to|poised\s+to|expects?\s+to)\s+(lift|ease|remove|unfreeze|release)\b.{0,50}(blockade|sanctions?|frozen\s+funds|assets)|\bexpects?\b.{0,60}(Hormuz\s+)?(deal|agreement).{0,40}\bsoon\b|\bhoping\s+for\s+(an\s+)?(deal|agreement)\b|once\s+(the\s+)?deal\s+(is\s+)?announced|performance[- ]based|tied\s+to\s+Iran.?s?\s+implementation|\bafter\s+(a\s+)?(deal|agreement)\b.{0,40}\b(lift|ease|relief)\b|\bif\s+(a\s+)?(deal|agreement)\b.{0,40}\b(lift|ease|relief)\b/i;

/**
 * Hard enacted blink — past-tense relief already done, or Treasury/OFAC instrument issued.
 * Do NOT include bare present "lift(s)" — that matches inside "will lift blockade" /
 * "plans to lift" even when "White House" is nearby.
 */
const HARD_ENACTED_BLINK_RE =
  /\b(has\s+)?(lifted|eased|removed|unfroze|unfrozen|released)\b.{0,40}(sanctions?|blockade|frozen\s+funds|assets)|\b(blockade|sanctions?)\s+(has\s+been\s+|already\s+|now\s+)?(lifted|eased|removed|ended)\b|(Treasury|OFAC|White\s+House|State\s+Department).{0,50}(issues?|issued|authoriz(?:e|es|ed)|lifted|has\s+lifted|ease[sd]?\s+(?:Iran\s+)?(?:oil\s+)?(?:sanctions?|blockade|restrictions?))|(sanctions?\s+relief\s+(enacted|issued|granted|announced))|(frozen\s+funds\s+(released|unfrozen))|(release[sd]?\s+(of\s+)?(frozen\s+)?(funds|assets))|(issues?|issued).{0,40}(general\s+license|waiver|\bGL\b)|(accept(s|ed)\s+(Iran'?s|Iranian|Tehran'?s)\s+(terms|demands|conditions))|(major\s+concession\s+to\s+Tehran)/i;

/**
 * Soft fee/toll commentary — FT "tolls are legit", Suezmaxxing jokes, analyst reshare.
 * Must not fire fee_dispute WARN; wait for refuse/reject or fee % leak.
 */
const SOFT_FEE_COMMENTARY_RE =
  /totally\s+legit|suezmaxx(?:ing)?|Financial\s+Times\s+reports|FT\s+reports|reports?\s+that\s+tolls?.{0,40}legit|tolls?\s+(?:are|is)\s+(?:totally\s+)?legit|commentary|op[- ]?ed|think[- ]?piece|analysis\s+(?:says|argues)|@Middle_East_Spectator/i;

/** Hard fee-dispute signal: refuse/reject/insist/dispute or new % development. */
const HARD_FEE_DISPUTE_RE =
  /refus(?:e|es|ed|ing)|reject(?:s|ed|ing)?|no\s+deal\s+without|fee\s+dispute|dispute.{0,40}(fee|toll)|(fee|toll).{0,40}dispute|insist(?:s|ed|ing)?.{0,50}(fee|toll|percent|%)|demand(?:s|ed|ing)?.{0,50}(fee|toll|percent|%)|won't\s+(?:accept|sign).{0,40}(without|fee|toll)|will\s+not\s+(?:accept|sign).{0,40}(without|fee|toll)|\d+(?:\.\d+)?\s*%\s*(fee|toll)|(fee|toll).{0,20}\d+(?:\.\d+)?\s*%/i;

/** Undated items: only admit if clearly breaking / same-day cue. */
const BREAKING_OR_SAME_DAY_RE =
  /\b(BREAKING|JUST\s+IN|FLASH|DEVELOPING)\b|\b(today|this\s+morning|this\s+afternoon|minutes?\s+ago|hours?\s+ago)\b/i;

/** Hormuz-deal / capitulation context — skip unrelated sanctions chatter. */
const BLINK_DEAL_CTX_RE =
  /Hormuz|blockade|frozen\s+funds|Strait|corridor|Islamabad|memorandum|\bMOU\b|Iran'?s?\s+(terms|demands|conditions)|general\s+license|\bOFAC\b|oil\s+sanctions?|accept(s|ed)?\s+Iran|concession\s+to\s+Tehran/i;

/** US blink = capitulation on sanctions / blockade / frozen funds before final text. */
function usBlink(title: string): boolean {
  if (!US_ACTOR_RE.test(title)) return false;
  // Iran demanding US accept / lift blockade / ultimatum — confrontation, not US capitulation
  if (IRAN_DEMANDS_US_ACCEPT_RE.test(title)) return false;
  if (iranDealBreakdown(title)) return false;
  // Negations / denials are NOT a blink
  if (
    /would\s+not|won't|will\s+not|not\s+(get|linked|tied)|denies?|no\s+sanctions\s+relief|without\s+sanctions\s+relief|rejects?\s+sanctions\s+relief/i.test(
      title,
    )
  ) {
    return false;
  }
  // Think-tank advocacy alone ≠ operational blink (need Reuters/AP/WSJ/Treasury/WH in title)
  if (THINK_TANK_RE.test(title) && !BLINK_PRIMARY_RE.test(title)) {
    return false;
  }
  // "Provides … sanctions relief" advocacy framing without primary gov action verb
  if (
    SOFT_RELIEF_FRAMING_RE.test(title) &&
    !/(Treasury|OFAC|White\s+House|State\s+Department).{0,50}(issues?|issued|authoriz|lifts?|ease[sd]?)/i.test(
      title,
    ) &&
    !/\b(Reuters|AP|WSJ|Bloomberg)\b/i.test(title)
  ) {
    return false;
  }

  const futureModalLift =
    /\b(will|would|may|might|could|plans?\s+to|ready\s+to|set\s+to|poised\s+to|expects?\s+to|to)\s+(lift|ease|remove|unfreeze|release)\b/i.test(
      title,
    );

  // "Expects deal soon / will lift blockade" = contingent future, not CRITICAL capitulation
  // unless hard enacted language (lifted / Treasury issues / frozen funds released) is also present.
  if (
    (SOFT_CONDITIONAL_LIFT_RE.test(title) || futureModalLift) &&
    !HARD_ENACTED_BLINK_RE.test(title)
  ) {
    return false;
  }

  const operational =
    HARD_ENACTED_BLINK_RE.test(title) ||
    /(lifts?|lifting|ease[sd]?|easing|remov(?:e|es|ed|ing)|unfreeze[sd]?|release[sd]?).{0,40}(sanctions?|blockade|frozen\s+funds|assets)/i.test(
      title,
    ) ||
    /(sanctions?\s+relief|lift(s|ing)?\s+(the\s+)?(sanctions?|blockade)|unfreeze|frozen\s+funds|release\s+(frozen\s+)?assets|conditional(ly)?\s+accept|temporary\s+accept|accept(s|ed)?\s+(Iran'?s|Iranian|Tehran'?s)\s+(terms|demands|conditions)|major\s+concession\s+to\s+Tehran)/i.test(
      title,
    ) ||
    // Possessive / noun phrase only — not verb "Iran demands [that] US accept"
    /((?:Iran'?s|Iranian|Tehran'?s)\s+(terms|demands|conditions)).{0,40}(accept|agree|concede|capitulat)/i.test(
      title,
    ) ||
    /(Treasury|OFAC|White\s+House).{0,50}(issues?|issued|authoriz(?:e|es|ed)).{0,40}(general\s+license|waiver|\bGL\b)/i.test(
      title,
    );

  if (!operational) return false;

  // Prefer deal/Hormuz/blockade/frozen-funds context; bare "eases Iran sanctions" alone is soft
  if (!BLINK_DEAL_CTX_RE.test(title)) {
    const strongPrimary =
      /(Treasury|OFAC|White\s+House|State\s+Department).{0,60}(sanctions?|blockade|frozen|license|waiver|unfreeze|relief)/i.test(
        title,
      );
    if (!strongPrimary) return false;
  }

  return true;
}

/**
 * Leader rejects Hormuz/draft — NOT Pezeshkian unity PR.
 * "Supreme Leader … rejecting foreign media" / "not at odds" must not BUY.
 */
const KHAMENEI_UNITY_DENIAL_RE =
  /not\s+at\s+odds|no\s+(?:rift|differences?|dispute)|denies?\s+(?:a\s+)?(?:rift|differences?|dispute)|denying\s+(?:a\s+)?(?:rift|differences?)|rejecting\s+foreign\s+media|rejects?\s+foreign\s+media|dismiss(?:es|ed)?\s+foreign\s+media|rejecting\s+(?:media\s+)?reports?\s+(?:of\s+)?(?:a\s+)?rift|Pezeshkian.{0,80}reject(?:s|ed|ing)?.{0,40}(foreign\s+media|media\s+reports?|rumou?rs?|rift|differences?)/i;

function khameneiRejection(title: string): boolean {
  if (/resign|resignation/i.test(title)) return false;
  // Pezeshkian denying rift / rejecting foreign media ≠ Leader veto of draft
  if (KHAMENEI_UNITY_DENIAL_RE.test(title)) return false;

  // Explicit draft-veto phrasing
  if (/(Leader\s+disapproves|draft\s+requires\s+fundamental)/i.test(title)) {
    return true;
  }

  // Leader verb must target draft/deal/Hormuz — bare "reject" near "Supreme Leader" is not enough
  // (was matching "Supreme Leader … rejecting foreign media reports").
  return (
    /(Khamenei|Supreme\s+Leader).{0,60}(disapprov|reject|refus|veto|opposes?|blocks?|will\s+not\s+sign|won't\s+sign).{0,50}(draft|deal|agreement|Hormuz|corridor|fee|toll|proposal)/i.test(
      title,
    ) ||
    /(Khamenei|Supreme\s+Leader).{0,40}(fundamental\s+changes?|talks?\s+will\s+continue\s+indefinitely)/i.test(
      title,
    ) ||
    /(disapprov|reject|refus|veto).{0,40}(draft|deal|agreement|Hormuz).{0,40}(Khamenei|Supreme\s+Leader)/i.test(
      title,
    )
  );
}

function pezeshkianSpeech(title: string): boolean {
  if (/resign|resignation/i.test(title)) return false;
  return /Pezeshkian.{0,80}(address|speech|announc|televised|to the nation|deal|Hormuz|fee|toll)/i.test(
    title,
  );
}

function khameneiSign(title: string): boolean {
  if (/resign|resignation|disapprov|reject|refus|veto/i.test(title)) return false;
  if (
    /(awaits?|pending|awaiting).{0,24}Khamenei.{0,24}(approv|sign)/i.test(title) ||
    /Khamenei.{0,24}(approv|sign).{0,24}(await|pending)/i.test(title) ||
    /draft.{0,40}Khamenei.{0,24}approv/i.test(title)
  ) {
    return true;
  }
  return (
    /(Khamenei|Supreme\s+Leader).{0,48}(sign|approv|endorse|green[- ]?light).{0,40}(deal|agreement|Hormuz|corridor|fee|toll)/i.test(
      title,
    ) ||
    /(deal|agreement|Hormuz|corridor).{0,40}(Khamenei|Supreme\s+Leader).{0,24}(sign|approv)/i.test(
      title,
    )
  );
}

function omanBacksOut(title: string): boolean {
  return (
    /(Oman|ONA|Oman\s+News\s+Agency).{0,80}(stall|stalled|collapse|no\s+further\s+talks|talks?\s+(suspended|paused|ended|off)|60[- ]?day|mediation\s+(fails?|failed|collapse)|technical\s+disagreements?\s+remain)/i.test(
      title,
    ) ||
    /(negotiations?\s+have\s+stalled|mediation\s+collapse|no\s+further\s+talks\s+scheduled)/i.test(
      title,
    ) && /Oman|Hormuz/i.test(title)
  );
}

/** Exact fee % leak — returns pct or null. */
function feePctLeak(title: string): number | null {
  if (!/(fee|toll|voluntary\s+insurance|transit|passage)/i.test(title)) return null;
  if (!/(Reuters|AP\b|WSJ|Wall\s+Street|Bloomberg|draft|leak|percent|%|fee\s+of)/i.test(title) &&
      !/\d+(?:\.\d+)?\s*%/.test(title)) {
    // still allow bare "X% transit fee" even without wire name
    if (!/\d+(?:\.\d+)?\s*%/.test(title)) return null;
  }
  const m = title.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!m) {
    if (/0\s*%|zero\s+(percent|fee)|no\s+percent/i.test(title)) return 0;
    return null;
  }
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function vlccFixtureSpike(title: string): boolean {
  const rateHit =
    /\$?\s*4\d{2},?\d{3}|\$?\s*4\d{2}\s*k|over\s+\$?400,?000|above\s+\$?400,?000|>\s*\$?400k|TCE.{0,20}4\d{2}/i.test(
      title,
    );
  const fixtureHit =
    /VLCC|fixture|charter|TradeWinds|Lloyd'?s\s+List|Splash|ME[- ]?Gulf|AG[- ]?China|TD3/i.test(
      title,
    );
  return rateHit && fixtureHit;
}

/**
 * Black Sea / grain spillover → HOLD only on hard freight signals.
 * Do NOT fire on RivieraMM-style status quo ("strikes continue", ceasefire
 * rejected, NATO chatter). Prefer new merchant hits, port closures, corridor death.
 */
function blackSeaSpillover(title: string): boolean {
  const theater =
    /Black\s+Sea|grain\s+corridor|grain\s+deal|grain\s+initiative|Odesa|Odessa|Chornomorsk|Mykolaiv|Ukrainian\s+port/i.test(
      title,
    );
  if (!theater) return false;

  // Physical hit on merchant / grain tonnage (not bare "strikes continue").
  const shipHit =
    /(merchant|cargo|bulk(?:er)?|grain|civilian)\s+(ship|vessel|freighter|tanker).{0,80}(hit|struck|sunk|sinking|damaged|attacked|destroyed|mined)|((?:hit|struck|sunk|damaged|attacked|destroyed|mined).{0,55}(merchant|cargo|bulk(?:er)?|grain|civilian)\s+(ship|vessel|freighter|tanker))|(freighter|bulk\s*carrier|dry\s*bulk|grain\s+ship).{0,55}(hit|struck|sunk|damaged|attacked|destroyed|mined)|(missile|drone).{0,40}(hit|struck|hits|strikes).{0,40}(merchant|cargo|freighter|bulk|grain\s+ship)/i.test(
      title,
    );

  const portClosed =
    /(Odesa|Odessa|Chornomorsk|Mykolaiv|Black\s+Sea\s+port|Ukrainian\s+port|grain\s+port).{0,70}(clos(?:e|ed|ure)|shut|block(?:ed|ade)?|suspend|halt|mined|mining)|((clos(?:e|ed|ure)|shut|block(?:ed|ade)?|suspend|halt).{0,50}(Odesa|Odessa|Black\s+Sea\s+port|Ukrainian\s+port|grain\s+export))/i.test(
      title,
    );

  // Corridor / deal collapse — not generic "Black Sea" + "end".
  const corridorDead =
    /(grain\s+(corridor|deal|initiative)|Black\s+Sea\s+grain).{0,55}(suspend|collapse|end(?:s|ed)?|halt|scrap|abort|dead|terminat|cancel)|((suspend|collapse|ends?|halt|scrap|abort|terminat|cancel).{0,45}(grain\s+(corridor|deal|initiative)|Black\s+Sea\s+grain))/i.test(
      title,
    );

  return shipHit || portClosed || corridorDead;
}

/**
 * Stable content key for IDs — strip leading emoji/dashes/"NEW:", collapse space.
 * Do not include wall-clock / pubDate (identical TG posts must not re-fire).
 */
function normalizeForFingerprint(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, "") // regional flags
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "") // emoji
    .replace(/^[\s—–\-_|:·•.]+/, "")
    .replace(/\bnew:\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function fingerprint(kind: string, title: string, stableKey?: string | null): string {
  const norm = normalizeForFingerprint(stableKey?.trim() ? stableKey : title);
  let h = 0;
  const s = `${kind}|${norm}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `deal_${kind}_${(h >>> 0).toString(36)}`;
}

/** Kind-independent content key — same Reuters wire keeps one key across classifier renames. */
function contentKey(title: string, stableKey?: string | null): string {
  const norm = normalizeForFingerprint(stableKey?.trim() ? stableKey : title);
  let h = 0;
  for (let i = 0; i < norm.length; i++) h = (h * 31 + norm.charCodeAt(i)) | 0;
  return `c_${(h >>> 0).toString(36)}`;
}

function parseItemPubDate(pubDate: string): Date | null {
  if (!pubDate?.trim()) return null;
  const d = new Date(pubDate);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Remember the earliest pubDate for a story. Google News sometimes re-surfaces
 * old wires with a fresh pubDate; once we have seen June 1 we keep June 1.
 */
function earliestPubMs(contentId: string, pub: Date | null): number | null {
  if (pub) {
    const t = pub.getTime();
    const prev = earliestPubByContent.get(contentId);
    if (prev == null || t < prev) {
      earliestPubByContent.set(contentId, t);
      // Cap map growth
      if (earliestPubByContent.size > 800) {
        const first = earliestPubByContent.keys().next().value;
        if (first != null) earliestPubByContent.delete(first);
      }
      return t;
    }
    return prev;
  }
  return earliestPubByContent.get(contentId) ?? null;
}

/**
 * Recency gate: parseable pubDate/telegram time within window.
 * Uses earliest-known pub for the content key (defeats RSS date flaps).
 * Undated → stale unless BREAKING / same-day cue in title (and no prior pub).
 */
function isDealItemFresh(
  item: NewsItem,
  nowMs: number,
  title: string,
  contentId?: string,
): boolean {
  const cid =
    contentId ?? contentKey(title, item.link?.trim() || title);
  const pub = parseItemPubDate(item.pubDate);
  const pubMs = earliestPubMs(cid, pub);
  if (pubMs == null) {
    return BREAKING_OR_SAME_DAY_RE.test(title);
  }
  const ageMs = nowMs - pubMs;
  if (ageMs < -60 * 60 * 1000) return true; // mild future skew
  return ageMs <= dealNewsMaxAgeMs();
}

/** Soft FT/Spectator-style toll chatter — not a live fee dispute. */
function isSoftFeeCommentary(title: string): boolean {
  return SOFT_FEE_COMMENTARY_RE.test(title);
}

function isHardFeeDispute(title: string): boolean {
  return HARD_FEE_DISPUTE_RE.test(title);
}

async function fetchGoogleNewsRss(
  query: string,
  limit = 8,
): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, {
    headers: { Accept: "application/rss+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Google News RSS HTTP ${res.status}`);
  const xml = await res.text();
  const items: NewsItem[] = [];
  const chunks = xml.split(/<item>/i).slice(1);
  for (const chunk of chunks) {
    const title =
      chunk.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i)?.[1] ??
      chunk.match(/<title>(.*?)<\/title>/i)?.[1] ??
      "";
    const link =
      chunk.match(/<link>(.*?)<\/link>/i)?.[1]?.trim() ??
      chunk.match(/<link[^>]*href="([^"]+)"/i)?.[1] ??
      "";
    const pubDate = chunk.match(/<pubDate>(.*?)<\/pubDate>/i)?.[1] ?? "";
    const clean = title.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    if (!clean) continue;
    items.push({ title: clean, link, pubDate, source: "news" });
    if (items.length >= limit) break;
  }
  return items;
}

async function fetchTelegramHits(): Promise<NewsItem[]> {
  try {
    const base = IRONSIGHT_URL.replace(/\/$/, "");
    const res = await fetch(
      `${base}/api/telegram?conflict=${encodeURIComponent("iran-israel")}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!res.ok) throw new Error(`telegram HTTP ${res.status}`);
    const json = (await res.json()) as {
      posts?: Array<Record<string, unknown>>;
    };
    const out: NewsItem[] = [];
    for (const p of json.posts ?? []) {
      const text = String(p.text ?? p.message ?? "").replace(/\s+/g, " ").trim();
      if (!text || text.length < 24) continue;
      const relevant =
        HORMUZ_CTX_RE.test(text) ||
        /Pezeshkian|Khamenei|Tasnim|Black\s+Sea|grain|VLCC|Bataan/i.test(text);
      if (!relevant) continue;
      if (NOISE_RE.test(text)) continue;
      const channel = String(
        p.channelLabel ?? p.channel ?? p.username ?? p.source ?? "telegram",
      );
      const link = p.link != null ? String(p.link) : "";
      // Prefer IRONSIGHT date/ts — never invent "now" (that recycled undated posts as fresh).
      const time =
        p.date != null
          ? String(p.date)
          : p.ts != null
            ? String(p.ts)
            : p.createdAt != null
              ? String(p.createdAt)
              : p.time != null
                ? String(p.time)
                : "";
      out.push({
        title: text.slice(0, 220),
        link,
        pubDate: time,
        source: `tg:${channel}`,
      });
      if (out.length >= 24) break;
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchBataanStamp(): Promise<{
  lat: number | null;
  lon: number | null;
  status: string | null;
  region: string | null;
  error?: string;
}> {
  try {
    const base = IRONSIGHT_URL.replace(/\/$/, "");
    const res = await fetch(
      `${base}/api/ships?conflict=${encodeURIComponent("iran-israel")}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!res.ok) throw new Error(`ships HTTP ${res.status}`);
    const json = (await res.json()) as {
      ships?: Array<Record<string, unknown>>;
    };
    const hit =
      (json.ships ?? []).find((s) =>
        /Bataan|LHD-5/i.test(`${String(s.name ?? "")} ${String(s.hull ?? "")}`),
      ) ?? null;
    if (!hit) {
      return { lat: null, lon: null, status: null, region: null };
    }
    return {
      lat: Number(hit.lat) || null,
      lon: Number(hit.lon) || null,
      status: hit.status != null ? String(hit.status) : null,
      region: hit.region != null ? String(hit.region) : null,
    };
  } catch (err) {
    return {
      lat: null,
      lon: null,
      status: null,
      region: null,
      error: String(err),
    };
  }
}

function classifyItem(item: NewsItem, now: string): DealAlarmEvent | null {
  const rawTitle = item.title;
  const t = normalizeDealTitle(rawTitle);
  if (NOISE_RE.test(t)) return null;
  // Hard-drop June 1 Tasnim/Reuters messaging+Hormuz wire family (Google date flaps).
  if (isStaleIranMessagingHormuzReprint(t)) return null;
  // Prefer stable telegram/article link so identical posts keep the same id.
  const fpKey = item.link?.trim() || t;

  // —— Blind spots that don't need Hormuz ctx ——
  if (blackSeaSpillover(t)) {
    return {
      id: fingerprint("black_sea_spillover", t, fpKey),
      kind: "black_sea_spillover",
      severity: "warn",
      action: "hold",
      title: t,
      read: "Black Sea / grain spillover — parallel freight risk. HOLD stubs even if Hormuz opens.",
      source: item.source,
      link: item.link || null,
      detectedAt: now,
    };
  }

  if (vlccFixtureSpike(t)) {
    return {
      id: fingerprint("vlcc_fixture_spike", t, fpKey),
      kind: "vlcc_fixture_spike",
      severity: "warn",
      action: "hold",
      title: t,
      read: "Physical VLCC fixture spike (≈$400k+/day) — HOLD. Rates are the reality check vs Polymarket.",
      source: item.source,
      link: item.link || null,
      detectedAt: now,
    };
  }

  const feePct = feePctLeak(t);
  if (feePct != null) {
    const action: DealAlarmAction = feePct > 0 ? "trim" : "buy";
    return {
      id: fingerprint("fee_pct_leak", `${feePct}_${t}`, fpKey),
      kind: "fee_pct_leak",
      severity: "critical",
      action,
      title: t,
      read:
        feePct > 0
          ? `Fee leak ~${feePct}% — market prices deal as "real". TRIM aggressively.`
          : "Fee leak ~0% (US wins structure) — Iran likely rejects. BUY/HOLD dip.",
      source: item.source,
      link: item.link || null,
      detectedAt: now,
    };
  }

  if (usBlink(t)) {
    return {
      id: fingerprint("us_blink", t, fpKey),
      kind: "us_blink",
      severity: "critical",
      action: "trim",
      title: t,
      read: "US BLINK — sanctions/blockade/frozen-funds capitulation before final text. TRIM aggressively; war premium evaporates.",
      source: item.source,
      link: item.link || null,
      detectedAt: now,
    };
  }

  if (khameneiRejection(t)) {
    return {
      id: fingerprint("khamenei_rejection", t, fpKey),
      kind: "khamenei_rejection",
      severity: "critical",
      action: "buy",
      title: t,
      read: "Khamenei REJECTS draft — deal dead. BUY/HOLD the dip; geo risk premium re-prices hard.",
      source: item.source,
      link: item.link || null,
      detectedAt: now,
    };
  }

  if (omanBacksOut(t)) {
    return {
      id: fingerprint("oman_backs_out", t, fpKey),
      kind: "oman_backs_out",
      severity: "critical",
      action: "buy",
      title: t,
      read: "Oman mediation collapse / talks stalled — BUY calls. Diplomatic pathway narrows.",
      source: item.source,
      link: item.link || null,
      detectedAt: now,
    };
  }

  if (iranDealBreakdown(t)) {
    return {
      id: fingerprint("deal_breakdown", t, fpKey),
      kind: "deal_breakdown",
      severity: "critical",
      action: "hold",
      title: t,
      read: "Iran cutting US messaging / may block Hormuz — deal path souring; HOLD/BUY stubs.",
      source: item.source,
      link: item.link || null,
      detectedAt: now,
    };
  }

  // —— Core Hormuz deal classifiers ——
  if (
    !HORMUZ_CTX_RE.test(t) &&
    !pezeshkianSpeech(t) &&
    !khameneiSign(t) &&
    !usAccepts(t) &&
    !usRejects(t)
  ) {
    return null;
  }

  const hasFee = FEE_RE.test(t);
  const noFee = NO_FEE_RE.test(t);
  const signed = signedDeal(t);
  const reject = usRejects(t);
  const accept = usAccepts(t);

  if (khameneiSign(t) || (signed && /Khamenei|Supreme\s+Leader/i.test(t))) {
    const pending = /awaits?|pending|awaiting|draft|reportedly/i.test(t);
    const kind: DealAlarmKind = pending
      ? "khamenei_sign"
      : noFee
        ? "deal_signed_no_fee"
        : hasFee
          ? "deal_signed_with_fee"
          : "khamenei_sign";
    const action: DealAlarmAction =
      kind === "deal_signed_no_fee"
        ? "trim"
        : kind === "deal_signed_with_fee"
          ? "hold"
          : "watch";
    return {
      id: fingerprint(kind, t, fpKey),
      kind,
      severity: pending ? "warn" : "critical",
      action,
      title: t,
      read:
        action === "trim"
          ? "Khamenei/signature + no-fee lean — TRIM bias into open (stubs at risk)."
          : action === "hold"
            ? "Khamenei/signature + fee/toll language — HOLD stubs; US may still reject."
            : pending
              ? "Draft awaits Khamenei approval — not signed yet. Watch for fee % / rejection."
              : "Khamenei signature chatter — READ FEE LANGUAGE in first sentence before acting.",
      source: item.source,
      link: item.link || null,
      detectedAt: now,
    };
  }

  if (signed) {
    const kind: DealAlarmKind = noFee
      ? "deal_signed_no_fee"
      : hasFee
        ? "deal_signed_with_fee"
        : "deal_signed_unclear";
    const action: DealAlarmAction =
      kind === "deal_signed_no_fee"
        ? "trim"
        : kind === "deal_signed_with_fee"
          ? "hold"
          : "watch";
    return {
      id: fingerprint(kind, t, fpKey),
      kind,
      severity: "critical",
      action,
      title: t,
      read:
        action === "trim"
          ? "Hormuz deal signed/finalized without fee language — TRIM / gap-down risk for $46c."
          : action === "hold"
            ? "Hormuz deal + fee/toll in headline — HOLD stubs until US accept/reject clears."
            : "Deal/joint-statement without clear fee text — WATCH; fee % leak decides Trim vs Buy.",
      source: item.source,
      link: item.link || null,
      detectedAt: now,
    };
  }

  if (reject) {
    return {
      id: fingerprint("us_rejects_fee", t, fpKey),
      kind: "us_rejects_fee",
      severity: "critical",
      action: "hold",
      title: t,
      read: "US reject of fee/toll/deal — HOLD lottery stubs despite Polymarket deal %.",
      source: item.source,
      link: item.link || null,
      detectedAt: now,
    };
  }

  if (accept) {
    const soft = /appears?\s+ready|may\s+accept|could\s+accept|signals?\s+openness/i.test(
      t,
    );
    return {
      id: fingerprint("us_accepts_deal", t, fpKey),
      kind: "us_accepts_deal",
      severity: soft ? "warn" : "critical",
      action: "trim",
      title: t,
      read: soft
        ? "Soft US-accept lean — TRIM bias forming; wait for hard accept / US blink on sanctions."
        : "US accept/endorse of Hormuz deal — TRIM bias; open may gap FRO/$46c down.",
      source: item.source,
      link: item.link || null,
      detectedAt: now,
    };
  }

  if (pezeshkianSpeech(t)) {
    return {
      id: fingerprint("pezeshkian_speech", t, fpKey),
      kind: "pezeshkian_speech",
      severity: "warn",
      action: "watch",
      title: t,
      read: "Pezeshkian address/announcement — stay ready for fee language / US blink.",
      source: item.source,
      link: item.link || null,
      detectedAt: now,
    };
  }

  // Fee/toll dispute: hard refuse/reject/% only — suppress soft FT/Spectator commentary.
  if (hasFee && isSoftFeeCommentary(t) && !isHardFeeDispute(t)) {
    return null;
  }
  if (
    hasFee &&
    isHardFeeDispute(t) &&
    /deal|agreement|Hormuz|Oman|corridor|Iran|refuse|reject|fee|toll/i.test(t)
  ) {
    return {
      id: fingerprint("fee_dispute", t, fpKey),
      kind: "fee_dispute",
      severity: "warn",
      action: "hold",
      title: t,
      read: "Fee/toll dispute still live — Hold stubs; wait for exact fee % leak.",
      source: item.source,
      link: item.link || null,
      detectedAt: now,
    };
  }

  return null;
}

function levelFromEvents(
  events: DealAlarmEvent[],
  warRiskRegime: string,
): { level: DealAlarmLevel; actionBias: DealAlarmState["actionBias"]; read: string } {
  const hasRed = events.some((e) => e.action === "red");
  const hasBuy = events.some(
    (e) => e.action === "buy" && e.severity === "critical",
  );
  const hasTrim = events.some(
    (e) => e.action === "trim" && e.severity === "critical",
  );
  const hasHold = events.some(
    (e) => e.action === "hold" && e.severity === "critical",
  );
  const hasWatch = events.some((e) => e.severity !== "info");

  if (hasRed) {
    return {
      level: "red",
      actionBias: "red",
      read: "RED — Bataan course correction (treat as L1 TRUE). Sprint may be in progress without AIS SOG.",
    };
  }
  if (hasBuy && !hasTrim) {
    return {
      level: "buy",
      actionBias: "buy",
      read: "BUY bias — Khamenei rejection and/or Oman mediation collapse. Geo premium re-prices.",
    };
  }
  if (hasTrim && !hasHold && !hasBuy) {
    return {
      level: "trim",
      actionBias: "trim",
      read: "TRIM bias — US blink / fee>0 leak / fee-free accept path. War premium at risk.",
    };
  }
  if (hasHold || (hasTrim && hasBuy)) {
    return {
      level: "hold",
      actionBias: "hold",
      read: "HOLD bias — conflicting deal signals or US reject / physical rates. Prefer text over Polymarket.",
    };
  }
  if (hasTrim) {
    return {
      level: "trim",
      actionBias: "trim",
      read: "TRIM lean present — confirm fee % / US blink before acting into open.",
    };
  }
  if (warRiskRegime === "spike_chatter" && hasWatch) {
    return {
      level: "hold",
      actionBias: "hold",
      read: "War-risk spike + deal watch — Hold stubs; underwriters disagree with Polymarket.",
    };
  }
  if (hasWatch) {
    return {
      level: "watch",
      actionBias: "watch",
      read: "Deal + blind-spot watch armed. Waiting for signature / fee % / US blink / Bataan move.",
    };
  }
  if (warRiskRegime === "spike_chatter") {
    return {
      level: "watch",
      actionBias: "hold",
      read: "War-risk insurance spike with no fresh signature — soft Hold vs deal-hope tape.",
    };
  }
  return {
    level: "quiet",
    actionBias: "none",
    read: "No fresh deal / blind-spot trigger. Polling continues (US blink · Khamenei reject · Bataan · Oman · fee% · VLCC · Black Sea).",
  };
}

function buildChecklist(events: DealAlarmEvent[], bataanMoved: boolean) {
  // Only fresh events reach `events` (recency gate). Soft warn alone does not
  // arm P0/P1 forever — require critical. P2 (VLCC / Black Sea) may arm on warn.
  const hasCritical = (kind: DealAlarmKind) =>
    events.some((e) => e.kind === kind && e.severity === "critical");
  const hasFresh = (kind: DealAlarmKind) => events.some((e) => e.kind === kind);
  return [
    {
      id: "us_blink",
      label: "US Blink (sanctions/blockade capitulation)",
      priority: "p0" as const,
      status: hasCritical("us_blink") ? ("armed" as const) : ("quiet" as const),
      action: "TRIM",
    },
    {
      id: "khamenei_rejection",
      label: "Khamenei Rejection",
      priority: "p0" as const,
      status: hasCritical("khamenei_rejection")
        ? ("armed" as const)
        : ("quiet" as const),
      action: "BUY/HOLD",
    },
    {
      id: "bataan_course",
      label: "Bataan Course Correction (pre-AIS L1)",
      priority: "p0" as const,
      status: bataanMoved || hasCritical("bataan_course")
        ? ("armed" as const)
        : ("quiet" as const),
      action: "TREAT AS L1 / RED",
    },
    {
      id: "oman_backs_out",
      label: "Oman Backs Out",
      priority: "p1" as const,
      status: hasCritical("oman_backs_out")
        ? ("armed" as const)
        : ("quiet" as const),
      action: "BUY calls",
    },
    {
      id: "fee_pct_leak",
      label: "Deal Text Leak (fee %)",
      priority: "p1" as const,
      status: hasCritical("fee_pct_leak")
        ? ("armed" as const)
        : ("quiet" as const),
      action: "TRIM if >0% · BUY if 0%",
    },
    {
      id: "vlcc_fixture_spike",
      label: "Physical VLCC Fixture Spike",
      priority: "p2" as const,
      status: hasFresh("vlcc_fixture_spike")
        ? ("armed" as const)
        : ("quiet" as const),
      action: "HOLD",
    },
    {
      id: "black_sea_spillover",
      label: "Black Sea / Grain Spillover",
      priority: "p2" as const,
      status: hasFresh("black_sea_spillover")
        ? ("armed" as const)
        : ("quiet" as const),
      action: "HOLD",
    },
  ];
}

export function getLatestDealAlarm(): DealAlarmState | null {
  return latestState;
}

export async function evaluateDealAlarm(): Promise<DealAlarmState> {
  const now = new Date().toISOString();
  const sources: DealAlarmState["sources"] = {
    news: "ok",
    telegram: "ok",
    warRisk: "ok",
    fro: "ok",
    bataan: "ok",
  };

  const queries = [
    'Tasnim OR "Oman News Agency" OR ONA (Hormuz OR deal OR agreement OR "joint statement" OR fee OR toll OR stalled OR disapprov)',
    "(Pezeshkian OR Khamenei) (Hormuz OR deal OR fee OR toll OR sign OR reject OR disapprov OR address OR speech)",
    '(Trump OR "White House" OR "State Department" OR Washington) (sanctions relief OR blockade OR "frozen funds" OR accept OR reject OR concede) (Iran OR Hormuz OR Oman)',
    '"joint statement" OR "final agreement" OR "transit fee" OR "passage fee" OR "%" (Hormuz OR Oman) (fee OR toll OR deal)',
    "(TradeWinds OR \"Lloyd's List\" OR Splash OR VLCC) (fixture OR charter OR TCE OR 400,000 OR $400)",
    '("Black Sea" OR "grain corridor" OR "grain deal") (merchant OR freighter OR "cargo ship" OR port OR Odesa OR Odessa OR suspend OR collapse OR sunk OR struck OR damaged OR closure)',
    'Oman (stalled OR "no further talks" OR "technical disagreements" OR mediation) (Hormuz OR Iran)',
  ];

  const [newsBatches, tgItems, warRiskItems, fro, bataanStamp] =
    await Promise.all([
      Promise.all(
        queries.map(async (q, idx) => {
          try {
            const items = await fetchGoogleNewsRss(q, 7);
            const tags = [
              "tasnim/ona",
              "leader",
              "us_blink",
              "fee_pct",
              "vlcc",
              "black_sea",
              "oman",
            ];
            return items.map((i) => ({ ...i, source: tags[idx] ?? "news" }));
          } catch {
            sources.news = "partial";
            return [] as NewsItem[];
          }
        }),
      ),
      fetchTelegramHits().then((items) => {
        if (items.length === 0) sources.telegram = "partial";
        return items;
      }),
      fetchGoogleNewsRss(
        '("war risk" OR "shipping insurance" OR Marsh) (Hormuz OR tanker OR Strait)',
        8,
      )
        .then((items) => items.map((i) => ({ ...i, source: "warRisk" })))
        .catch(() => {
          sources.warRisk = "error";
          return [] as NewsItem[];
        }),
      getStockQuote("FRO").catch(() => {
        sources.fro = "error";
        return null;
      }),
      fetchBataanStamp().then((s) => {
        if (s.error) sources.bataan = "error";
        else if (s.lat == null) sources.bataan = "partial";
        return s;
      }),
    ]);

  const seenTitle = new Set<string>();
  const pool: NewsItem[] = [];
  for (const batch of [...newsBatches, tgItems]) {
    for (const item of batch) {
      const key = item.title.toLowerCase();
      if (seenTitle.has(key)) continue;
      seenTitle.add(key);
      pool.push(item);
    }
  }

  const nowMs = Date.parse(now);
  const events: DealAlarmEvent[] = [];
  const eventIds = new Set<string>();
  const blackSeaCooldown = blackSeaKindCooldownMs();
  for (const item of pool) {
    const fpKey = item.link?.trim() || item.title;
    const cid = contentKey(item.title, fpKey);
    // Recency uses earliest-known pub for this content (Google may re-date old wires).
    if (!isDealItemFresh(item, nowMs, item.title, cid)) continue;
    const ev = classifyItem(item, now);
    if (!ev || eventIds.has(ev.id)) continue;
    // Kind cooldown: routine Black Sea rewrites must not re-arm HOLD every few hours.
    if (ev.kind === "black_sea_spillover") {
      if (
        lastBlackSeaFireMs != null &&
        nowMs - lastBlackSeaFireMs < blackSeaCooldown
      ) {
        continue;
      }
      lastBlackSeaFireMs = nowMs;
    }
    eventIds.add(ev.id);
    events.push(ev);
  }

  // —— Bataan course correction vs pack stamp (26.10N, 50.50E) ——
  const baseline = BATAAN_BASELINE;
  if (
    bataanStamp.lat != null &&
    bataanStamp.lon != null &&
    bataanBaseline == null
  ) {
    bataanBaseline = { lat: bataanStamp.lat, lon: bataanStamp.lon };
  }
  let bataanMoved = false;
  let bataanRead =
    bataanStamp.lat == null || bataanStamp.lon == null
      ? "Bataan not in IRONSIGHT naval layer — open MarineTraffic and mark SOG/lat manually."
      : `Bataan stamp ${bataanStamp.lat.toFixed(2)}N, ${bataanStamp.lon.toFixed(2)}E (${bataanStamp.status ?? "?"} · ${bataanStamp.region ?? "?"}) vs pack baseline ${baseline.lat.toFixed(2)}N, ${baseline.lon.toFixed(2)}E.`;

  if (bataanStamp.lat != null && bataanStamp.lon != null) {
    const dLat = bataanStamp.lat - baseline.lat;
    const dLon = bataanStamp.lon - baseline.lon;
    const northSprint =
      bataanStamp.lat >= BATAAN_NORTH_LAT || dLat >= BATAAN_MOVE_DEG;
    const westSprint =
      bataanStamp.lon <= BATAAN_WEST_LON || dLon <= -BATAAN_MOVE_DEG;
    if (northSprint || westSprint) {
      bataanMoved = true;
      bataanRead = `Bataan MOVED Δlat=${dLat.toFixed(2)} Δlon=${dLon.toFixed(2)} → ${bataanStamp.lat.toFixed(2)}N, ${bataanStamp.lon.toFixed(2)}E (north≥${BATAAN_NORTH_LAT} or west≤${BATAAN_WEST_LON}). Treat as L1 / RED even without AIS SOG.`;
      const ev: DealAlarmEvent = {
        id: fingerprint(
          "bataan_course",
          `${bataanStamp.lat.toFixed(2)},${bataanStamp.lon.toFixed(2)}`,
        ),
        kind: "bataan_course",
        severity: "critical",
        action: "red",
        title: `USS Bataan course correction @ ${bataanStamp.lat.toFixed(2)}N, ${bataanStamp.lon.toFixed(2)}E`,
        read: bataanRead,
        source: "IRONSIGHT ships",
        link: "https://www.marinetraffic.com/en/ais/index/search/all?keyword=BATAAN",
        detectedAt: now,
      };
      if (!eventIds.has(ev.id)) {
        events.push(ev);
        eventIds.add(ev.id);
      }
    }
  }

  const spikeHints = warRiskItems.filter((i) =>
    /spike|soar|rise|severe|premium|Marsh|insurance\s+costs?/i.test(i.title),
  );
  let warRiskRegime = "quiet";
  if (spikeHints.length >= 2) warRiskRegime = "spike_chatter";
  else if (spikeHints.length === 1) warRiskRegime = "mixed";
  else if (warRiskItems.length > 0) warRiskRegime = "quiet";
  else warRiskRegime = "unknown";

  if (
    previousWarRisk != null &&
    previousWarRisk !== "spike_chatter" &&
    warRiskRegime === "spike_chatter"
  ) {
    const title = spikeHints[0]?.title ?? "War-risk insurance spike (Hormuz)";
    const ev: DealAlarmEvent = {
      id: fingerprint("war_risk_spike", title),
      kind: "war_risk_spike",
      severity: "warn",
      action: "hold",
      title,
      read: "War-risk regime flipped to spike — Hold stubs; underwriters pricing talks collapse.",
      source: "warRisk",
      link: spikeHints[0]?.link || null,
      detectedAt: now,
    };
    if (!eventIds.has(ev.id)) {
      events.push(ev);
      eventIds.add(ev.id);
    }
  }
  previousWarRisk = warRiskRegime;

  const froPrice = fro?.price ?? null;
  const froChangePct = fro?.changePercent ?? null;
  if (
    froChangePct != null &&
    previousFroChange != null &&
    Math.abs(froChangePct - previousFroChange) >= 2.5 &&
    Math.abs(froChangePct) >= 3
  ) {
    const title = `FRO ${froChangePct >= 0 ? "+" : ""}${froChangePct.toFixed(2)}% move (was ${previousFroChange.toFixed(2)}%)`;
    const ev: DealAlarmEvent = {
      id: fingerprint(
        "fro_gap",
        `${froChangePct.toFixed(1)}_${now.slice(0, 13)}`,
      ),
      kind: "fro_gap",
      severity: "warn",
      action: froChangePct <= -3 ? "trim" : "watch",
      title,
      read:
        froChangePct <= -3
          ? "FRO dumping hard — check US blink / fee-free deal leak before chasing."
          : "FRO sharp move — cross-check Tasnim/ONA/Telegram for deal text.",
      source: "yahoo",
      link: null,
      detectedAt: now,
    };
    if (!eventIds.has(ev.id)) events.push(ev);
  }
  if (froChangePct != null) previousFroChange = froChangePct;

  events.sort((a, b) => {
    const rank = (s: DealAlarmSeverity) =>
      s === "critical" ? 0 : s === "warn" ? 1 : 2;
    return rank(a.severity) - rank(b.severity);
  });

  const feeHits = events.filter((e) => /fee|toll/i.test(e.title)).length;
  const dealHits = events.filter((e) =>
    /deal|agreement|signed|joint/i.test(e.title),
  ).length;
  let stateMediaRegime = "quiet";
  if (feeHits > 0 && dealHits > 0) stateMediaRegime = "fee_dispute_live";
  else if (feeHits > 0) stateMediaRegime = "no_deal_fees";
  else if (dealHits > 0) stateMediaRegime = "deal_announced";

  const { level, actionBias, read } = levelFromEvents(events, warRiskRegime);
  const checklist = buildChecklist(events, bataanMoved);

  const state: DealAlarmState = {
    evaluatedAt: now,
    level,
    read,
    actionBias,
    events: events.slice(0, 28),
    warRiskRegime,
    stateMediaRegime,
    froPrice,
    froChangePct,
    bataan: {
      lat: bataanStamp.lat,
      lon: bataanStamp.lon,
      baselineLat: baseline.lat,
      baselineLon: baseline.lon,
      status: bataanStamp.status,
      region: bataanStamp.region,
      moved: bataanMoved,
      read: bataanRead,
    },
    checklist,
    links: [
      { label: "Tasnim", href: "https://www.tasnimnews.com/en" },
      { label: "Oman News Agency", href: "https://omannews.gov.om/eng" },
      {
        label: "MarineTraffic · Bataan",
        href: "https://www.marinetraffic.com/en/ais/index/search/all?keyword=BATAAN",
      },
      {
        label: "Google · fee % / sanctions",
        href: `https://news.google.com/search?q=${encodeURIComponent("Hormuz fee OR toll OR sanctions relief OR Khamenei")}&hl=en-US&gl=US&ceid=US:en`,
      },
      { label: "TradeWinds", href: "https://www.tradewindsnews.com/" },
      { label: "t.me/SaberinFa", href: "https://t.me/SaberinFa" },
    ],
    sources,
  };

  latestState = state;
  return state;
}

export function startDealAlarmPolling(intervalMs = DEAL_ALARM_POLL_MS): void {
  if (pollTimer) return;
  const tick = () => {
    if (evalInFlight) return;
    evalInFlight = true;
    void evaluateDealAlarm()
      .then((s) => {
        const armed = s.checklist.filter((c) => c.status === "armed").length;
        console.log(
          `[tradehole] deal-alarm ${s.level} action=${s.actionBias} events=${s.events.length} blindspots=${armed}/7 bataan=${s.bataan.moved ? "MOVED" : "still"} @ ${s.evaluatedAt}`,
        );
      })
      .catch((err) => {
        console.warn("[tradehole] deal-alarm eval failed:", err);
      })
      .finally(() => {
        evalInFlight = false;
      });
  };
  tick();
  pollTimer = setInterval(tick, intervalMs);
}

export function stopDealAlarmPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** Headline classifier entry for smoke / unit checks (assumes fresh / no recency). */
export function classifyDealHeadline(title: string): DealAlarmEvent | null {
  return classifyItem(
    { title, link: "", pubDate: new Date().toISOString(), source: "test" },
    new Date().toISOString(),
  );
}

/** Recency + classify — for smoke tests with explicit pubDate. */
export function classifyDealHeadlineWithDate(
  title: string,
  pubDate: string,
  link = "",
): DealAlarmEvent | null {
  const now = new Date().toISOString();
  const item: NewsItem = { title, link, pubDate, source: "test" };
  if (!isDealItemFresh(item, Date.parse(now), title)) return null;
  return classifyItem(item, now);
}

export {
  usAccepts,
  usRejects,
  usBlink,
  normalizeDealTitle,
  iranDealBreakdown,
  isStaleIranMessagingHormuzReprint,
  isDealItemFresh,
  isSoftFeeCommentary,
  blackSeaSpillover,
  contentKey,
  dealNewsWindowHours,
};

export function dealAlarmMarkdown(state: DealAlarmState | null): string {
  if (!state) return "## Deal / fee / signature + blind-spot alarm\n(unavailable)";
  return [
    "## Deal / fee / signature + 7 blind-spot alarms",
    `Level: **${state.level.toUpperCase()}** · actionBias=${state.actionBias} · warRisk=${state.warRiskRegime} · stateMedia~${state.stateMediaRegime}`,
    state.read,
    `FRO $${state.froPrice ?? "—"} (${state.froChangePct != null ? `${state.froChangePct >= 0 ? "+" : ""}${state.froChangePct.toFixed(2)}%` : "—"})`,
    "",
    "### Blind-spot checklist",
    "| Alarm | Priority | Status | Action |",
    "| --- | --- | --- | --- |",
    ...state.checklist.map(
      (c) =>
        `| ${c.label} | ${c.priority} | **${c.status}** | ${c.action} |`,
    ),
    "",
    "### Bataan pre-AIS",
    state.bataan.read,
    "",
    "| Kind | Action | Severity | Title |",
    "| --- | --- | --- | --- |",
    ...state.events
      .slice(0, 14)
      .map(
        (e) =>
          `| ${e.kind} | **${e.action}** | ${e.severity} | ${e.title.replace(/\|/g, "/")} |`,
      ),
    "",
    ...state.events.slice(0, 10).flatMap((e) => [
      `- **${e.kind}** (${e.action}/${e.severity}): ${e.read}`,
      `  ${e.title}${e.link ? ` · ${e.link}` : ""}`,
    ]),
    "Portals:",
    ...state.links.map((l) => `- ${l.label}: ${l.href}`),
    "",
    "> The 5-Lock watches the war. These alarms watch the deal. The trade is the gap between the two.",
  ].join("\n");
}
