import { buildLlmDossier } from "../dossier";
import { buildHistoryDigest } from "./digest";
import {
  focusContractCsv,
  optionBandCsv,
  queryAlertsSince,
  queryFlowEvents,
  queryHeatmap,
  stockCsv,
} from "./query";
import {
  buildStrategyIntel,
  strategyIntelMarkdown,
} from "../analytics/strategyIntel";
import { buildTheaterWatch } from "../theaterWatch";
import { getPhysicalMarkets, FREIGHT_DEEP_LINKS } from "../physical";
import { getEnergyQuotes } from "../market";
import {
  collectAllIronsightLinks,
  collectIronsightFullDump,
} from "../ironsightLinks";
import {
  evaluateIntelAlarm,
  getLatestIntelAlarm,
  intelAlarmMarkdown,
  setIntelAlarmManual,
  type IntelAlarmState,
} from "../intelAlarm";
import {
  evaluateDealAlarm,
  getLatestDealAlarm,
  dealAlarmMarkdown,
} from "../dealAlarm";
import {
  buildDecisionFootprint,
  decisionFootprintMarkdown,
} from "../analytics/decisionFootprint";
import {
  buildMarketSurprise,
  marketSurpriseMarkdown,
} from "../analytics/marketSurprise";
import { buildOsintPack } from "../osintPack";
import { fetchBdtiSeries } from "../analytics/bdti";
import { freightMaxMarkdown } from "../freightPack";
import { packSchemaV3Json, PACK_SCHEMA_VERSION } from "../aiBrief";

const IRONSIGHT_URL = process.env.IRONSIGHT_URL ?? "http://localhost:3170";

const README_FOR_AI = `# Tradehole EVERYTHING pack (unified AI dump)

**Schema:** \`tradehole_pack_v3\` · optimized for **DeepSeek** / external LLM quick deep analysis.

## What this is
One clipboard/ZIP dump of **everything Tradehole can see right now** for Frontline (FRO):
live broker marks/holdings, options, physical oil/freight, theater OSINT signals,
**full uncapped IRONSIGHT panel dump**, local SQLite history, and strategy intel.

## Parse order (for receiving LLM / DeepSeek)
0. **\`AI_BRIEF.md\`** — START HERE (≤~3k tokens). Contradiction · edges · physical falsifiers · book · catalysts · gaps.
0a. **\`DEEPSEEK_PROMPT.txt\`** — paste as system/user instructions
0b. **\`contradiction.json\`** · **\`catalysts.json\`** · **\`events.jsonl\`** · **\`pack_diff.json\`** · **\`pack_meta.json\`** / **\`pack_schema.json\`**
0c. **Decision Footprint** (\`decision_footprint.json\`) + **Market Surprise** (\`market_surprise.json\`)
0d. **Physical:** \`chokepoint_transits.json\` · \`bdti_daily.json\` · \`02_VLCC_FREIGHT_MAX.*\`
1. \`01_OSINT_7BUCKET.md\` — full 7-bucket paste (includes AI_BRIEF prepended)
1b. \`02_VLCC_FREIGHT_MAX.md\` (+ \`.json\`) — TD3C + daily BDTI + PortWatch + Frontline/peer IR
1b2. \`bdti_daily.json\` · \`chokepoint_transits.json\` · \`shipping_industry.json\`
1c. \`telegram_channel_dump.json\` — two-pass live public Telegram dump
1d. \`pack_score.json\` + \`evidence_index.json\` + \`narrative_matrix.json\`
1e. \`ironsight_flights.json\` / alerts / strikes / regional / polymarket
2. \`00_THEATER_5CHECK.md\` — Decision Footprint + Market Surprise + Hormuz AIS (Layer-3 manual) + BDTI + peers + WTI/Brent + Polymarket
   + **war-risk insurance news** + **Oman/Iran state-media / fee dispute** + **HO/RB product calendars**
   + **Kharg/Pickaxe 4-signal cluster** + **Bataan ghost tracking (7 footprints)** + **Bibi Spoiler (Rome / Shekel / IDF ground)**
   + **§ Ultimate 5-Lock Intel Alarm** + **§ Deal / fee / signature overnight alarm**
3. \`fro_holdings.json\` / dossier 0a — multi-account book
4. \`strategy_intel.md\` + \`strategy_intel.json\` — ΔOI / IV Rank / GEX
5. \`history_digest.md\` + heatmap / alerts — local memory
6. \`ironsight_full_dump.json\` — uncapped raw panels (prefer ZIP)
7. CSVs / flow_events for path dependency

## DeepSeek rules
- Never invent live AIS, Baltic FFA, or Platts Dated Brent.
- Respect \`freshness.lagHours\` on PortWatch / TD3C / BDTI.
- Polymarket high deal % ≠ fee-free deal — check fee_dispute / 6 demands.
- Default book: HOLD Sep $46c lottery vs soft deal rhetoric.
- Scenario **title** ≠ trade signal — follow froGuidance / action lines. Soft OSINT (1 tanker, DIP warm, empty NAV AIS, hex-watch K35R ≠ E-6) is NOT High-go / Doomsday / buy-ask.
- Book qty = sum Sep $46c across ALL accounts (Rollover + Roth + Robinhood); a 0× account ≠ flat.
- Rome next: September — walkout / spoiler-path-live / delegation-returning classifier is **DISABLED** (PAST). Do not invent a Rome walkout clock. Residual Bibi = Shekel / Natanz–Fordow / Gaza–Lebanon ground.
- L2 E-6B: require type E6 / TACAMO callsign — hex AE041D typed K35R = NOISY / not confirmed Mercury.

## Units
- IV: broker decimal (0.56 ≈ 56%)
- BDTI: StockQ public proxy (not Baltic FFA)
- AIS: cannot be scraped free — user posture from Theater watch localStorage is included when provided
- HO/RB: $/gal; positive front−2nd = backwardation (product tightness)
- USD/ILS (\`ILS=X\`): Shekel stress toward ~4.00 = cabinet/strike risk
- Frontline plc is a foreign private issuer → almost no SEC Form 4s (use 6-K / 13D)

## IRONSIGHT size note
Clipboard text truncates large IRONSIGHT JSON with a pointer to ZIP files.
\`ironsight_full_dump.json\` + \`ironsight_links.json\` in the ZIP are the full uncapped dump.

## How to reason (12–24h exit timing)
1. Treat multi-account FRO equity + $46c as one book.
1b. **Decision Footprint (primary):** 0–100 additive stack (Tier1 diplomatic door-slams · Tier2 execution/FX · Tier3 market). Bands: 0–30 diplomacy alive · 31–50 deteriorating · 51–70 decision being made · 71–90 execution prep · 91–100 imminent ≤12h. ≥2 Tier1 lit → decisionMade bump (not auto 5-Lock RED). Commercial-only (war-risk+fee) cannot print 91 without Shekel/oil/NOTAM/aerial. AIS is **not** in the formula.
1c. **Market Surprise:** Edge = Reality% − Market% (pp) on Hormuz disruption, fee-free/blink TRIM, FRO $46c lottery, Bibi/Shekel spoiler. Positive edge = market underprices. Transparent contributions; confidence low|med|high when a side is thin.
2. AIS (Layer-3 gap): anchored/loitering = deal hope; Cape diversion = long-war / bullish freight; normal transit = Strait open. Manual deep-link only — do not wait on AIS before reading Decision Footprint / Market Surprise.
3. WTI/Brent backwardation = physical tightness; front-crash/back-hold = short-term blip.
4. **War-risk insurance spike** in news (next 12h) = underwriters pricing talks collapse → Hold all 3 despite high Polymarket deal %.
5. **State media text > Polymarket %**: Oman deal without fee language → Trim more; Iran "no deal without fees" + US reject → Hold.
6. **HO=F / RB=F calendars**: backwardation eroding fast → Hormuz reopen priced downstream; firm backwardation → physical tightness still real (supports FRO).
7. **Kharg/Pickaxe ARG tell**: Bataan (LHD-5) ≥15 kts toward Strait = assault imminent; anchored Bahrain = 24–48h delay. Boxer (LHD-4) also moving in Gulf/Red Sea = two-ARG / full invasion prep; only idle Bataan = tit-for-tat. Pair with E-6B airborne + IRGC dispersal + Cape diversion.
7b. **Bataan ghost tracking**: Stop hunting L1 AIS first. Watch NOTAM/TFR sky seals, aerial tanker/AWACS orbits, Florida/SSGN going dark, USNS UNREP sprint, Cape + war-risk canary, IRGC dispersal, NAVWARN operating box. Formation **tight/forming** while Bataan is AIS-dark = sprint posture.
7c. **Deal / fee / signature + 7 blind-spot alarms**: Overnight watch for Tasnim/ONA/Pezeshkian/Khamenei + US accept/reject, plus **US Blink** (sanctions/blockade capitulation→TRIM), **Khamenei Rejection** (→BUY), **Bataan course correction** (lat/lon leave stamp→treat as L1 RED), **Oman backs out** (→BUY), **fee % leak** (>0→TRIM, 0%→BUY), **VLCC fixture >~$400k** (→HOLD), **Black Sea/grain spillover** (→HOLD). Text beats Polymarket %.
8. **§ Ultimate 5-Lock Intel Alarm**: **Critical three-lock** (L1 Bataan ∧ L2 E-6B ∧ L3 IRGC) → RED even without L4/L5. **Full 5-lock** → RED (12–24h). **Bibi secondary** (Shekel spike: USD/ILS ≥3.85 band ~3.9–4.0 OR ≥3.6 with d/d ≥+1.5%; **OR** fresh corroborated Natanz/Fordow strike news ≤48h with ≥2 same-day sources; recycled war-wave reprints excluded): alone → ≥YELLOW; + any 2 locks → RED. Else 3–4 without three-lock → YELLOW; ≤2 without Bibi → posturing. Locks = Bataan sprint · E-6B · IRGC pulse · NAVWARN · Cape VLCC. Prefer mechanics; Bibi FX/nuclear-news is the intentional exception.
9. **Bibi Spoiler**: Residual path is Shekel spike (~3.85–4.0), fresh Natanz/Fordow strike news, or Gaza/Lebanon ground — **not** Rome walkout. Rome next round is **September**; live walkout / spoiler-path-live classifier is **DISABLED**. Ignore Sde Teiman "walkout" pollution. Hold lottery stubs as low-cost insurance vs Shekel/nuclear-news/ground only.
10. Peers moving with FRO = macro; FRO diverging = idiosyncratic.
`;

const FOCUS = {
  expiry: "2026-09-18",
  strike: 46,
  type: "call" as const,
};

export type AiPackFile = { name: string; content: string; mediaType: string };

export type AiPackResult = {
  symbol: string;
  generatedAt: string;
  text: string;
  byteLength: number;
  files: AiPackFile[];
};

export type EverythingPackOpts = {
  aisStatus?: string | null;
  aisNote?: string | null;
  /** Per-hull ARG posture: unknown | sprinting | loitering | anchored */
  bataanStatus?: string | null;
  bataanNote?: string | null;
  boxerStatus?: string | null;
  boxerNote?: string | null;
  newYorkStatus?: string | null;
  newYorkNote?: string | null;
  /** @deprecated prefer per-hull; kept for older clients */
  amphibStatus?: string | null;
  amphibNote?: string | null;
  irgcStatus?: string | null;
  irgcNote?: string | null;
  capeStatus?: string | null;
  capeNote?: string | null;
  /** Manual Rome talks posture: unknown | ongoing | walkout | disarmament_demand | concluded */
  romeStatus?: string | null;
  romeNote?: string | null;
  /** 5-Lock Ultimate Intel Alarm manual fields */
  bataanSog?: string | number | null;
  bataanCourse?: string | number | null;
  bataanLat?: string | number | null;
  bataanLon?: string | number | null;
  boxerSog?: string | number | null;
  boxerCourse?: string | number | null;
  boxerLat?: string | number | null;
  boxerLon?: string | number | null;
  newYorkSog?: string | number | null;
  newYorkCourse?: string | number | null;
  newYorkLat?: string | number | null;
  newYorkLon?: string | number | null;
  vlccDivertCount?: string | number | null;
  navwarnForce?: string | boolean | null;
  irgcForce?: string | boolean | null;
  capeForce?: string | boolean | null;
  intelAlarmNote?: string | null;
};

function settle<T>(
  p: Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  return p
    .then((value) => ({ ok: true as const, value }))
    .catch((err) => ({ ok: false as const, error: String(err) }));
}

function hullStatus(
  opts: EverythingPackOpts | undefined,
  key: "bataan" | "boxer" | "newYork",
): { status: string; note: string } {
  let status = "unknown";
  let note = "(no manual note)";
  if (key === "bataan") {
    status =
      opts?.bataanStatus?.trim() ||
      opts?.amphibStatus?.trim() ||
      "unknown";
    note =
      opts?.bataanNote?.trim() ||
      opts?.amphibNote?.trim() ||
      "(no manual note)";
  } else if (key === "boxer") {
    status = opts?.boxerStatus?.trim() || "unknown";
    note = opts?.boxerNote?.trim() || "(no manual note)";
  } else {
    status = opts?.newYorkStatus?.trim() || "unknown";
    note = opts?.newYorkNote?.trim() || "(no manual note)";
  }
  return { status, note };
}

function khargMarkdown(
  watch: Awaited<ReturnType<typeof buildTheaterWatch>>,
  opts?: EverythingPackOpts,
): string {
  const k = watch.khargPickaxe;
  const irgcStatus = opts?.irgcStatus?.trim() || "unknown";
  const irgcNote = opts?.irgcNote?.trim() || "(no manual IRGC note)";
  const capeStatus = opts?.capeStatus?.trim() || "unknown";
  const capeNote = opts?.capeNote?.trim() || "(no manual Cape note)";

  const vesselLines = k.amphibious.vessels.flatMap((v) => {
    const manual = hullStatus(opts, v.key);
    return [
      `### ${v.name} (${v.hull}) — ${v.role}`,
      `Manual posture: **${manual.status}** — ${manual.note}`,
      ...(v.ironsight
        ? [
            `IRONSIGHT stamp: ${v.ironsight.status} @ ${v.ironsight.lat.toFixed(2)},${v.ironsight.lon.toFixed(2)} (${v.ironsight.region})`,
          ]
        : ["IRONSIGHT stamp: (not in naval layer)"]),
      ...v.links.map((l) => `- ${l.label}: ${l.href}`),
    ];
  });

  const decisionMd = [
    "| Ship | Check | Bullish Kharg | Bearish delay |",
    "| --- | --- | --- | --- |",
    ...k.amphibious.decisionTable.map(
      (r) =>
        `| ${r.ship} | ${r.check} | ${r.bullishKharg} | ${r.bearishDelay} |`,
    ),
  ];

  return [
    "## 9. Kharg / Pickaxe tactical cluster (4 free signals)",
    k.thesis,
    "",
    "### 9a. Amphibious ARG tell (Bataan LHD-5 · Boxer LHD-4 · New York LPD-21)",
    k.amphibious.context,
    "",
    "**Decision table**",
    ...decisionMd,
    "",
    k.amphibious.note,
    k.amphibious.readOptionA,
    k.amphibious.readOptionB,
    ...vesselLines,
    k.amphibious.error ? `Error: ${k.amphibious.error}` : "",
    "",
    "### 9b. E-6B Mercury (Doomsday posture)",
    `Airborne: **${k.e6b.airborneCount}** · regime=${k.e6b.regime}`,
    k.e6b.read,
    ...k.e6b.samples.map(
      (s) =>
        `- ${s.callsign} ${s.aircraftType} @ ${s.lat.toFixed(2)},${s.lon.toFixed(2)} alt ${s.altitude}${s.gs != null ? ` · ${s.gs} kts` : ""}`,
    ),
    k.e6b.error ? `Error: ${k.e6b.error}` : "",
    "",
    "### 9c. IRGC fast-boat / coastal dispersal",
    `Auto regime: **${k.irgcBoats.regime}** · Manual: **${irgcStatus}** — ${irgcNote}`,
    k.irgcBoats.read,
    ...k.irgcBoats.telegramLinks.map((l) => `- ${l.label}: ${l.href}`),
    ...(k.irgcBoats.keywordHits.dispersing.length
      ? [
          "Dispersal hits:",
          ...k.irgcBoats.keywordHits.dispersing.map((t) => `- ${t}`),
        ]
      : []),
    ...(k.irgcBoats.keywordHits.massingOman.length
      ? [
          "Gulf of Oman massing hits:",
          ...k.irgcBoats.keywordHits.massingOman.map((t) => `- ${t}`),
        ]
      : []),
    ...(k.irgcBoats.keywordHits.reinforcingKharg.length
      ? [
          "Reinforce Kharg hits:",
          ...k.irgcBoats.keywordHits.reinforcingKharg.map((t) => `- ${t}`),
        ]
      : []),
    ...k.irgcBoats.items.slice(0, 8).map((i) => `- [${i.source}] ${i.title}`),
    "",
    "### 9d. VLCC Cape diversion",
    `Auto regime: **${k.vlccCape.regime}** · Manual: **${capeStatus}** — ${capeNote}`,
    k.vlccCape.read,
    k.vlccCape.readOptionA,
    k.vlccCape.readOptionB,
    ...k.vlccCape.links.map((l) => `- ${l.label}: ${l.href}`),
    ...(k.vlccCape.diversionHints.length
      ? [
          "Diversion headlines:",
          ...k.vlccCape.diversionHints.map((t) => `- ${t}`),
        ]
      : []),
    ...k.vlccCape.items.slice(0, 6).map((i) => `- ${i.title}`),
    "",
    "### 9d2. East Africa / Somali-basin Cape route (freight watch — not High-go)",
    ...(watch.eastAfricaCape
      ? [
          watch.eastAfricaCape.thesis,
          `Regime: **${watch.eastAfricaCape.regime}**`,
          watch.eastAfricaCape.read,
          ...watch.eastAfricaCape.signals.map(
            (s) => `- ${s.id}: ${s.status}${s.lit ? ` — ${s.read}` : ""}`,
          ),
          ...watch.eastAfricaCape.signals.flatMap((s) =>
            s.evidence.slice(0, 2).map((e) => `  - ${e}`),
          ),
          ...watch.eastAfricaCape.rules.map((r) => `- ${r}`),
          ...watch.eastAfricaCape.links.map((l) => `- ${l.label}: ${l.href}`),
          ...watch.eastAfricaCape.items.slice(0, 6).map((i) => `- ${i.title}`),
        ]
      : ["(east Africa Cape watch unavailable)"]),
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function bataanGhostMarkdown(
  watch: Awaited<ReturnType<typeof buildTheaterWatch>>,
): string {
  const g = watch.bataanGhost;
  const table = [
    "| Sign | Status | Look for | Source |",
    "| --- | --- | --- | --- |",
    ...g.signs.map(
      (s) =>
        `| ${s.label} | **${s.status}** | ${s.lookFor} | ${s.sourceHint} |`,
    ),
  ];
  const detailBlocks = g.signs.flatMap((s) => [
    `### ${s.label} — **${s.status}**`,
    s.read,
    ...(s.evidence.length
      ? ["Evidence:", ...s.evidence.slice(0, 5).map((e) => `- ${e}`)]
      : ["Evidence: (none in free sample)"]),
    ...s.links.map((l) => `- ${l.label}: ${l.href}`),
    "",
  ]);

  return [
    "## 9e. Bataan ghost tracking (pre-AIS footprints)",
    g.thesis,
    "",
    `Formation: **${g.formationRegime.toUpperCase()}** · score ${g.formationScore}/${g.formationMax}`,
    g.read,
    g.oneLiner,
    "",
    "**12h checklist**",
    ...table,
    "",
    ...detailBlocks,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function bibiSpoilerMarkdown(
  watch: Awaited<ReturnType<typeof buildTheaterWatch>>,
  opts?: EverythingPackOpts,
): string {
  const b = watch.bibiSpoiler;
  const romeStatus = opts?.romeStatus?.trim() || "sept_next";
  const romeNote = opts?.romeNote?.trim() || "(no manual Rome note)";

  return [
    "## 10. Bibi Spoiler (Rome calendar · Shekel · IDF ground)",
    b.thesis,
    "",
    "**Scenarios**",
    `1. Rome Trap — ${b.scenarios.romeTrap}`,
    `2. Nuclear breakout excuse — ${b.scenarios.nuclearBreakout}`,
    "",
    "**FRO trade implication:** Rome next: September — walkout arm DISABLED. Not a same-day binary. Hold stubs vs Shekel / Natanz–Fordow / Gaza–Lebanon ground only — never Rome walkout timing.",
    "",
    "### 10a. Rome Israel–Lebanon calendar (walkout OFF)",
    `Auto regime: **calendar_gap** (forced) · Manual: **${romeStatus}** — ${romeNote}`,
    b.romeTalks.read,
    "Do **not** invent a Rome walkout clock. Prior walkout / delegation-returning / spoiler-path-live classifier is PAST.",
    ...(b.romeTalks.keywordHits.calendarGap?.length
      ? [
          "Calendar-gap / September notes:",
          ...b.romeTalks.keywordHits.calendarGap.map((t) => `- ${t}`),
        ]
      : []),
    ...(b.romeTalks.keywordHits.disarmamentPrecondition.length
      ? [
          "Disarmament-precondition hits (background only — not live Rome walkout):",
          ...b.romeTalks.keywordHits.disarmamentPrecondition.map(
            (t) => `- ${t}`,
          ),
        ]
      : []),
    "Portals:",
    ...b.romeTalks.links.map((l) => `- ${l.label}: ${l.href}`),
    ...b.romeTalks.items.slice(0, 8).map((i) => `- [${i.source}] ${i.title}`),
    b.romeTalks.error ? `Error: ${b.romeTalks.error}` : "",
    "",
    "### 10b. Shekel (USD/ILS)",
    `Symbol: ${b.shekel.symbol} · price **${b.shekel.price?.toFixed(4) ?? "—"}** · d/d ${b.shekel.changePct?.toFixed(2) ?? "—"}% · threshold ~${b.shekel.threshold.toFixed(2)} · regime=**${b.shekel.regime}**`,
    b.shekel.read,
    b.shekel.error ? `Error: ${b.shekel.error}` : "",
    "",
    "### 10c. IDF ground / Lebanon border (IRONSIGHT + news)",
    `Regime: **${b.idfGround.regime}** · IRONSIGHT ${b.idfGround.ironsightOnline ? "online" : "offline (degraded)"}`,
    b.idfGround.read,
    ...(b.idfGround.keywordHits.lebaneseBorder.length
      ? [
          "Lebanon-border hits:",
          ...b.idfGround.keywordHits.lebaneseBorder
            .slice(0, 6)
            .map((t) => `- ${t}`),
        ]
      : []),
    ...(b.idfGround.keywordHits.gazaFocus.length
      ? [
          "Gaza-focus hits:",
          ...b.idfGround.keywordHits.gazaFocus.slice(0, 4).map((t) => `- ${t}`),
        ]
      : []),
    "Links:",
    ...b.idfGround.links.map((l) => `- ${l.label}: ${l.href}`),
    ...b.idfGround.items.slice(0, 8).map((i) => `- [${i.source}] ${i.title}`),
    b.idfGround.error ? `Error: ${b.idfGround.error}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function theaterMarkdown(
  watch: Awaited<ReturnType<typeof buildTheaterWatch>>,
  ais?: EverythingPackOpts,
  intelAlarm?: IntelAlarmState | null,
  dealAlarm?: Awaited<ReturnType<typeof evaluateDealAlarm>> | null,
  decisionFootprint?: Awaited<ReturnType<typeof buildDecisionFootprint>> | null,
  marketSurprise?: Awaited<ReturnType<typeof buildMarketSurprise>> | null,
): string {
  const status = ais?.aisStatus?.trim() || "unknown";
  const note = ais?.aisNote?.trim() || "(no manual AIS note provided)";
  const aisRead =
    status === "anchored"
      ? watch.ais.readAnchored
      : status === "cape"
        ? watch.ais.readCapeDiversion
        : status === "normal"
          ? "VLCCs moving normally through the Strait — no clear loitering or Cape diversion signal."
          : "AIS posture not set — optional Layer-3 mark; Decision Footprint + Market Surprise are primary.";

  const peerLines = watch.peers.rows
    .map(
      (r) =>
        `- ${r.symbol} (${r.label}): $${r.price ?? "—"} (${r.changePct != null ? `${r.changePct.toFixed(2)}%` : "—"})`,
    )
    .join("\n");

  const polyTop = watch.polymarket.top
    .slice(0, 6)
    .map((m) => `- ${m.yesPct ?? "—"}% · ${m.question}`)
    .join("\n");

  return [
    `# Theater 5-check · ${watch.fetchedAt}`,
    "",
    decisionFootprintMarkdown(decisionFootprint ?? null),
    "",
    marketSurpriseMarkdown(marketSurprise ?? null),
    "",
    "## Hormuz VLCCs (manual AIS · Layer-3 gap)",
    `Status: **${status}**`,
    `Note: ${note}`,
    `Read: ${aisRead}`,
    "Links:",
    ...watch.ais.links.map((l) => `- ${l.label}: ${l.href}`),
    "",
    "## 2. BDTI",
    `Latest: ${watch.bdti.latest?.value ?? "—"} @ ${watch.bdti.latest?.date ?? "—"}`,
    `d/d: ${watch.bdti.changePct1d?.toFixed(2) ?? "—"}% · 5d: ${watch.bdti.changePct5d?.toFixed(2) ?? "—"}%`,
    `Rising vs soft oil: ${watch.bdti.risingVsOil == null ? "—" : watch.bdti.risingVsOil ? "YES" : "no"}`,
    watch.bdti.read,
    "",
    "## 3. Peers vs FRO",
    peerLines,
    watch.peers.read,
    "",
    "## 4. WTI calendar (front vs Dec '26)",
    `${watch.wtiCurve.near.label}: $${watch.wtiCurve.near.price ?? "—"} (${watch.wtiCurve.near.changePct?.toFixed(2) ?? "—"}%)`,
    `${watch.wtiCurve.far.label}: $${watch.wtiCurve.far.price ?? "—"} (${watch.wtiCurve.far.changePct?.toFixed(2) ?? "—"}%)`,
    `Spread: $${watch.wtiCurve.spread?.toFixed(2) ?? "—"} · regime=${watch.wtiCurve.regime}`,
    watch.wtiCurve.read,
    "",
    "## 4b. Brent calendar (Sep−Dec '26)",
    `${watch.brentCurve.near.label}: $${watch.brentCurve.near.price ?? "—"}`,
    `${watch.brentCurve.far.label}: $${watch.brentCurve.far.price ?? "—"}`,
    `Spread: $${watch.brentCurve.spread?.toFixed(2) ?? "—"} · regime=${watch.brentCurve.regime}`,
    watch.brentCurve.read,
    "",
    "## 5. Polymarket",
    watch.polymarket.ceasefire
      ? `Ceasefire-ish: ${watch.polymarket.ceasefire.yesPct ?? "—"}% — ${watch.polymarket.ceasefire.question}`
      : "Ceasefire-ish: —",
    watch.polymarket.hormuz
      ? `Hormuz: ${watch.polymarket.hormuz.yesPct ?? "—"}% — ${watch.polymarket.hormuz.question}`
      : "Hormuz: —",
    watch.polymarket.read,
    polyTop,
    "",
    "## 6. War-risk insurance (news)",
    `Regime: **${watch.warRiskInsurance.regime}**`,
    watch.warRiskInsurance.read,
    `Search: ${watch.warRiskInsurance.searchUrl}`,
    ...(watch.warRiskInsurance.spikeHints.length
      ? ["Spike-ish headlines:", ...watch.warRiskInsurance.spikeHints.map((t) => `- ${t}`)]
      : ["(no spike-keyword headlines in top RSS)"]),
    ...watch.warRiskInsurance.items.slice(0, 6).map((i) => `- ${i.title}`),
    "",
    "## 7. Oman / Iran state media (deal text vs Polymarket)",
    `Regime: **${watch.stateMedia.regime}**`,
    watch.stateMedia.read,
    ...(watch.stateMedia.feeDisputeHits.length
      ? ["Fee-dispute hits:", ...watch.stateMedia.feeDisputeHits.map((t) => `- ${t}`)]
      : []),
    ...(watch.stateMedia.dealHits.length
      ? ["Deal-ish hits:", ...watch.stateMedia.dealHits.slice(0, 5).map((t) => `- ${t}`)]
      : []),
    "Portals:",
    ...watch.stateMedia.links.map((l) => `- ${l.label}: ${l.href}`),
    ...watch.stateMedia.items.slice(0, 8).map((i) => `- [${i.source}] ${i.title}`),
    "",
    "## 8. Refined product calendars (HO / RB front vs 2nd)",
    `Regime: **${watch.productCurves.regime}**`,
    watch.productCurves.read,
    `HO: ${watch.productCurves.heatingOil.near.label} $${watch.productCurves.heatingOil.near.price ?? "—"} (${watch.productCurves.heatingOil.near.changePct?.toFixed(2) ?? "—"}%) → ${watch.productCurves.heatingOil.far.label} $${watch.productCurves.heatingOil.far.price ?? "—"} · spread $${watch.productCurves.heatingOil.spread?.toFixed(4) ?? "—"}/gal · ${watch.productCurves.heatingOil.regime}`,
    watch.productCurves.heatingOil.read,
    `RB: ${watch.productCurves.gasoline.near.label} $${watch.productCurves.gasoline.near.price ?? "—"} (${watch.productCurves.gasoline.near.changePct?.toFixed(2) ?? "—"}%) → ${watch.productCurves.gasoline.far.label} $${watch.productCurves.gasoline.far.price ?? "—"} · spread $${watch.productCurves.gasoline.spread?.toFixed(4) ?? "—"}/gal · ${watch.productCurves.gasoline.regime}`,
    watch.productCurves.gasoline.read,
    "",
    khargMarkdown(watch, ais),
    "",
    bataanGhostMarkdown(watch),
    "",
    bibiSpoilerMarkdown(watch, ais),
    "",
    intelAlarmMarkdown(intelAlarm ?? null),
    "",
    dealAlarmMarkdown(dealAlarm ?? null),
    "",
    "## Bonus · Gulf aerial / Sep $46c / Insiders",
    `Aerial tankers: ${watch.aerial.tankerCount} · AWACS ${watch.aerial.awacsCount} · regime=${watch.aerial.regime}`,
    watch.aerial.read,
    `Sep $46c bid $${watch.focus46c.bid ?? "—"} · ask $${watch.focus46c.ask ?? "—"} · vol ${watch.focus46c.volume ?? "—"} · OI ${watch.focus46c.openInterest ?? "—"} · regime=${watch.focus46c.regime}`,
    watch.focus46c.read,
    watch.insiders.read,
    `OpenInsider: ${watch.insiders.sourceUrl}`,
  ].join("\n");
}

/**
 * Unified mega-pack: dossier + history + strategy + holdings + theater OSINT
 * + full IRONSIGHT dump + physical/energy. Optional AIS / Pickaxe posture from UI.
 */
export async function buildAiPack(
  symbolRaw = "FRO",
  opts: EverythingPackOpts = {},
): Promise<AiPackResult> {
  const symbol = symbolRaw.toUpperCase();

  const [
    dossierS,
    intelS,
    theaterS,
    physicalS,
    energyS,
    ironsightS,
    ironsightDumpS,
    osintS,
    bdtiS,
  ] = await Promise.all([
    settle(buildLlmDossier(symbol)),
    settle(buildStrategyIntel(symbol)),
    settle(buildTheaterWatch()),
    settle(getPhysicalMarkets()),
    settle(getEnergyQuotes()),
    settle(collectAllIronsightLinks(IRONSIGHT_URL)),
    settle(collectIronsightFullDump(IRONSIGHT_URL)),
    settle(buildOsintPack(symbol, opts)),
    settle(fetchBdtiSeries()),
  ]);

  const digest = (() => {
    try {
      return buildHistoryDigest(symbol);
    } catch (err) {
      return `ERROR history digest: ${String(err)}`;
    }
  })();

  const heatmap = (() => {
    try {
      return {
        symbol,
        expiry: FOCUS.expiry,
        ...queryHeatmap({ symbol, expiry: FOCUS.expiry }),
      };
    } catch (err) {
      return { error: String(err) };
    }
  })();

  const alerts = (() => {
    try {
      return {
        symbol,
        alerts: queryAlertsSince({ symbol, limit: 50 }),
      };
    } catch (err) {
      return { error: String(err) };
    }
  })();

  const focusCsv = focusContractCsv({
    symbol,
    expiry: FOCUS.expiry,
    strike: FOCUS.strike,
    type: FOCUS.type,
    days: 30,
  });
  const bandCsv = optionBandCsv({ symbol, days: 7 });
  const undCsv = stockCsv({ symbol, days: 30 });
  const flow = queryFlowEvents({ symbol, days: 30, limit: 200 });

  const dossierText = dossierS.ok
    ? dossierS.value.text
    : `ERROR dossier: ${dossierS.error}`;
  const dossierGeneratedAt = dossierS.ok
    ? dossierS.value.generatedAt
    : new Date().toISOString();
  const positionSummary = dossierS.ok
    ? dossierS.value.positionSummary ?? null
    : null;

  const strategyMd = intelS.ok
    ? strategyIntelMarkdown(intelS.value)
    : `ERROR strategy intel: ${intelS.error}`;
  const strategyJson = intelS.ok
    ? JSON.stringify(intelS.value, null, 2)
    : JSON.stringify({ error: intelS.error }, null, 2);
  const gexCsv = intelS.ok ? intelS.value.gexCsv : "ERROR";

  // Sync 5-Lock manual fields from Export ALL opts into the alarm evaluator.
  if (
    opts.bataanSog != null ||
    opts.bataanCourse != null ||
    opts.bataanLat != null ||
    opts.bataanLon != null ||
    opts.boxerLat != null ||
    opts.boxerLon != null ||
    opts.newYorkLat != null ||
    opts.newYorkLon != null ||
    opts.vlccDivertCount != null ||
    opts.navwarnForce != null ||
    opts.irgcForce != null ||
    opts.capeForce != null ||
    opts.intelAlarmNote != null
  ) {
    setIntelAlarmManual({
      bataanSog: opts.bataanSog as number | null,
      bataanCourse: opts.bataanCourse as number | null,
      bataanLat: opts.bataanLat as number | null,
      bataanLon: opts.bataanLon as number | null,
      boxerSog: opts.boxerSog as number | null,
      boxerCourse: opts.boxerCourse as number | null,
      boxerLat: opts.boxerLat as number | null,
      boxerLon: opts.boxerLon as number | null,
      newYorkSog: opts.newYorkSog as number | null,
      newYorkCourse: opts.newYorkCourse as number | null,
      newYorkLat: opts.newYorkLat as number | null,
      newYorkLon: opts.newYorkLon as number | null,
      vlccDivertCount: opts.vlccDivertCount as number | null,
      navwarnForce: opts.navwarnForce as boolean | null,
      irgcForce: opts.irgcForce as boolean | null,
      capeForce: opts.capeForce as boolean | null,
      note: opts.intelAlarmNote ?? null,
    });
  }

  let intelAlarm: IntelAlarmState | null = getLatestIntelAlarm();
  try {
    intelAlarm = await evaluateIntelAlarm();
  } catch (err) {
    console.warn("[tradehole] intel-alarm for export failed:", err);
  }

  let dealAlarm = getLatestDealAlarm();
  try {
    dealAlarm = await evaluateDealAlarm();
  } catch (err) {
    console.warn("[tradehole] deal-alarm for export failed:", err);
  }

  let decisionFootprint: Awaited<
    ReturnType<typeof buildDecisionFootprint>
  > | null = null;
  try {
    decisionFootprint = await buildDecisionFootprint({
      theater: theaterS.ok ? theaterS.value : null,
      deal: dealAlarm,
      intel: intelAlarm,
    });
  } catch (err) {
    console.warn("[tradehole] decision-footprint for export failed:", err);
  }

  let marketSurprise: Awaited<
    ReturnType<typeof buildMarketSurprise>
  > | null = null;
  try {
    marketSurprise = await buildMarketSurprise({
      theater: theaterS.ok ? theaterS.value : null,
      deal: dealAlarm,
      intel: intelAlarm,
      footprint: decisionFootprint,
    });
  } catch (err) {
    console.warn("[tradehole] market-surprise for export failed:", err);
  }

  const theaterMd = theaterS.ok
    ? theaterMarkdown(
        theaterS.value,
        opts,
        intelAlarm,
        dealAlarm,
        decisionFootprint,
        marketSurprise,
      )
    : `ERROR theater watch: ${theaterS.error}`;
  const theaterJson = theaterS.ok
    ? JSON.stringify(
        {
          ...theaterS.value,
          decisionFootprint,
          marketSurprise,
          dealFeeSignatureAlarm: dealAlarm,
          manualAis: {
            status: opts.aisStatus ?? "unknown",
            note: opts.aisNote ?? null,
          },
          manualKhargPickaxe: {
            bataan: {
              status: opts.bataanStatus ?? opts.amphibStatus ?? "unknown",
              note: opts.bataanNote ?? opts.amphibNote ?? null,
            },
            boxer: {
              status: opts.boxerStatus ?? "unknown",
              note: opts.boxerNote ?? null,
            },
            newYork: {
              status: opts.newYorkStatus ?? "unknown",
              note: opts.newYorkNote ?? null,
            },
            irgcStatus: opts.irgcStatus ?? "unknown",
            irgcNote: opts.irgcNote ?? null,
            capeStatus: opts.capeStatus ?? "unknown",
            capeNote: opts.capeNote ?? null,
          },
          manualBibiSpoiler: {
            romeStatus: opts.romeStatus ?? "unknown",
            romeNote: opts.romeNote ?? null,
          },
          ultimateIntelAlarm: intelAlarm,
          manualIntelAlarm: {
            bataanSog: opts.bataanSog ?? null,
            bataanCourse: opts.bataanCourse ?? null,
            bataanLat: opts.bataanLat ?? null,
            bataanLon: opts.bataanLon ?? null,
            boxerSog: opts.boxerSog ?? null,
            boxerCourse: opts.boxerCourse ?? null,
            boxerLat: opts.boxerLat ?? null,
            boxerLon: opts.boxerLon ?? null,
            newYorkSog: opts.newYorkSog ?? null,
            newYorkCourse: opts.newYorkCourse ?? null,
            newYorkLat: opts.newYorkLat ?? null,
            newYorkLon: opts.newYorkLon ?? null,
            vlccDivertCount: opts.vlccDivertCount ?? null,
            navwarnForce: opts.navwarnForce ?? null,
            irgcForce: opts.irgcForce ?? null,
            capeForce: opts.capeForce ?? null,
            note: opts.intelAlarmNote ?? null,
          },
        },
        null,
        2,
      )
    : JSON.stringify({ error: theaterS.error }, null, 2);

  const physicalJson = physicalS.ok
    ? JSON.stringify(physicalS.value, null, 2)
    : JSON.stringify({ error: physicalS.error }, null, 2);
  const energyJson = energyS.ok
    ? JSON.stringify(energyS.value, null, 2)
    : JSON.stringify({ error: energyS.error }, null, 2);

  let ironsightJson = "";
  let ironsightCount = 0;
  if (ironsightS.ok) {
    const payload = ironsightS.value;
    const articles = payload.articles ?? [];
    ironsightCount = payload.count ?? articles.length;
    ironsightJson = JSON.stringify(
      {
        generatedAt: payload.generatedAt,
        sourceBase: payload.sourceBase,
        conflicts: payload.conflicts,
        count: ironsightCount,
        byPanel: payload.byPanel,
        byConflict: payload.byConflict,
        panelStatus: payload.panelStatus,
        note: "Uncapped IRONSIGHT link blast — both theaters. Full raw panels also in ironsight_full_dump.json.",
        truncated: false,
        articles,
      },
      null,
      2,
    );
  } else {
    ironsightJson = JSON.stringify({ error: ironsightS.error }, null, 2);
  }

  const ironsightDumpJson = ironsightDumpS.ok
    ? JSON.stringify(ironsightDumpS.value, null, 2)
    : JSON.stringify({ error: ironsightDumpS.error }, null, 2);

  const heatmapJson = JSON.stringify(heatmap, null, 2);
  const alertsJson = JSON.stringify(alerts, null, 2);

  const holdingsPayload = {
    generatedAt: dossierGeneratedAt,
    symbol,
    note:
      "FRO exposure across every linked E*TRADE account (brokerage, Roth IRA, traditional IRA, etc.).",
    positionSummary,
  };

  const sourcesStatus = {
    dossier: dossierS.ok ? "ok" : "error",
    strategyIntel: intelS.ok ? "ok" : "error",
    theaterWatch: theaterS.ok ? "ok" : "error",
    physical: physicalS.ok ? "ok" : "error",
    energy: energyS.ok ? "ok" : "error",
    bdti: bdtiS.ok ? "ok" : "error",
    ironsightLinks: ironsightS.ok ? "ok" : "error",
    ironsightFullDump: ironsightDumpS.ok ? "ok" : "error",
    osint7Bucket: osintS.ok ? "ok" : "error",
    historyDigest: digest.startsWith("ERROR") ? "error" : "ok",
    historyHeatmap: "error" in heatmap ? "error" : "ok",
    historyAlerts: "error" in alerts ? "error" : "ok",
    ...(osintS.ok
      ? {
          osintSources: osintS.value.sources,
          packScore: osintS.value.packScore ?? null,
          telegramDumpMeta: osintS.value.telegramDumpMeta ?? null,
        }
      : {}),
  };

  const osintMd = osintS.ok
    ? osintS.value.markdown
    : `ERROR osint pack: ${osintS.error}`;

  const freightMd = freightMaxMarkdown({
    physical: physicalS.ok ? physicalS.value : null,
    bdti: bdtiS.ok ? bdtiS.value : null,
    theater: theaterS.ok ? theaterS.value : null,
    energy: energyS.ok ? energyS.value : null,
    physicalError: physicalS.ok ? null : physicalS.error,
    bdtiError: bdtiS.ok ? null : bdtiS.error,
    chokepoints: osintS.ok
      ? ((osintS.value.chokepointTransits as
          | import("../analytics/chokepointTransits").ChokepointTransitsReport
          | undefined) ?? null)
      : null,
    chokepointsError: osintS.ok
      ? osintS.value.sources.chokepoints === "error"
        ? "see OSINT sources"
        : null
      : osintS.error,
    shippingIndustry: osintS.ok
      ? ((osintS.value.shippingIndustry as
          | import("../analytics/shippingIndustry").ShippingIndustryReport
          | undefined) ?? null)
      : null,
    shippingIndustryError: osintS.ok
      ? osintS.value.sources.shippingIndustry === "error"
        ? "see OSINT sources"
        : null
      : osintS.error,
  });

  const freightJson = JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      td3c: physicalS.ok ? physicalS.value.vlccTd3c : { error: physicalS.error },
      eiaBrent: physicalS.ok ? physicalS.value.brent : null,
      physicalCaveats: physicalS.ok ? physicalS.value.caveats : null,
      bdti: bdtiS.ok
        ? {
            latest: bdtiS.value.latest,
            prev: bdtiS.value.prev,
            changePct1d: bdtiS.value.changePct1d,
            changePct5d: bdtiS.value.changePct5d,
            structuralBias: bdtiS.value.structuralBias,
            biasNote: bdtiS.value.biasNote,
            sourceUrl: bdtiS.value.sourceUrl,
            note: bdtiS.value.note,
            points: bdtiS.value.points,
          }
        : { error: bdtiS.error },
      chokepointTransits: osintS.ok
        ? (osintS.value.chokepointTransits ?? null)
        : null,
      shippingIndustry: osintS.ok
        ? (osintS.value.shippingIndustry ?? null)
        : null,
      peers: theaterS.ok ? theaterS.value.peers : null,
      wtiCurve: theaterS.ok ? theaterS.value.wtiCurve : null,
      brentCurve: theaterS.ok ? theaterS.value.brentCurve : null,
      productCurves: theaterS.ok ? theaterS.value.productCurves : null,
      energyQuotes: energyS.ok ? energyS.value : null,
      froRealizedTce: {
        available: false,
        note: "Not auto-ingested from PDFs. Use Frontline IR filings; headlines in shipping_industry.json.",
        irUrl: "https://www.frontline.bm/",
      },
      deepLinks: physicalS.ok
        ? physicalS.value.vlccTd3c.deepLinks
        : FREIGHT_DEEP_LINKS,
    },
    null,
    2,
  );

  const files: AiPackFile[] = [
    { name: "README_FOR_AI.md", content: README_FOR_AI, mediaType: "text/markdown" },
    {
      name: "AI_BRIEF.md",
      content: osintS.ok
        ? (osintS.value.aiPack?.briefMarkdown ??
          "# AI_BRIEF unavailable\n")
        : `# AI_BRIEF error\n${osintS.error}`,
      mediaType: "text/markdown",
    },
    {
      name: "DEEPSEEK_PROMPT.txt",
      content: osintS.ok
        ? (osintS.value.aiPack?.deepseekPrompt ?? "")
        : "",
      mediaType: "text/plain",
    },
    {
      name: "pack_meta.json",
      content: JSON.stringify(
        {
          schemaVersion: PACK_SCHEMA_VERSION,
          symbol,
          generatedAt: new Date().toISOString(),
          packScore: osintS.ok ? osintS.value.packScore ?? null : null,
          entrypoint: "AI_BRIEF.md",
        },
        null,
        2,
      ),
      mediaType: "application/json",
    },
    {
      name: "pack_schema.json",
      content: JSON.stringify(packSchemaV3Json(), null, 2),
      mediaType: "application/json",
    },
    {
      name: "contradiction.json",
      content: JSON.stringify(
        osintS.ok
          ? (osintS.value.aiPack?.contradiction ?? {
              error: "contradiction missing",
            })
          : { error: osintS.error },
        null,
        2,
      ),
      mediaType: "application/json",
    },
    {
      name: "catalysts.json",
      content: JSON.stringify(
        osintS.ok
          ? (osintS.value.aiPack?.catalysts ?? [])
          : { error: osintS.error },
        null,
        2,
      ),
      mediaType: "application/json",
    },
    {
      name: "events.jsonl",
      content: osintS.ok
        ? (osintS.value.aiPack?.eventsJsonl ?? "")
        : `${JSON.stringify({ error: osintS.error })}\n`,
      mediaType: "application/x-ndjson",
    },
    {
      name: "pack_diff.json",
      content: JSON.stringify(
        osintS.ok
          ? (osintS.value.aiPack?.packDiff ?? { error: "pack_diff missing" })
          : { error: osintS.error },
        null,
        2,
      ),
      mediaType: "application/json",
    },
    {
      name: "01_OSINT_7BUCKET.md",
      content: osintMd,
      mediaType: "text/markdown",
    },
    {
      name: "telegram_channel_dump.json",
      content: osintS.ok
        ? JSON.stringify(
            osintS.value.telegramDump ?? {
              error: "telegram dump missing from OSINT pack",
              meta: osintS.value.telegramDumpMeta ?? null,
            },
            null,
            2,
          )
        : JSON.stringify({ error: osintS.error }, null, 2),
      mediaType: "application/json",
    },
    {
      name: "telegram_deep_dump.json",
      content: JSON.stringify(
        osintS.ok
          ? (osintS.value.telegramDeepDump ?? { error: "deep dump missing" })
          : { error: osintS.error },
        null,
        2,
      ),
      mediaType: "application/json",
    },
    {
      name: "telegram_broad_dump.json",
      content: JSON.stringify(
        osintS.ok
          ? (osintS.value.telegramBroadDump ?? { error: "broad dump missing" })
          : { error: osintS.error },
        null,
        2,
      ),
      mediaType: "application/json",
    },
    {
      name: "telegram_ru_light_dump.json",
      content: JSON.stringify(
        osintS.ok
          ? (osintS.value.telegramRuDump ?? { error: "RU light dump missing" })
          : { error: osintS.error },
        null,
        2,
      ),
      mediaType: "application/json",
    },
    {
      name: "ironsight_flights.json",
      content: JSON.stringify(
        osintS.ok
          ? (osintS.value.flights ?? { error: "flights missing" })
          : { error: osintS.error },
        null,
        2,
      ),
      mediaType: "application/json",
    },
    {
      name: "ironsight_alerts.json",
      content: JSON.stringify(
        osintS.ok
          ? (osintS.value.alerts ?? { error: "alerts missing" })
          : { error: osintS.error },
        null,
        2,
      ),
      mediaType: "application/json",
    },
    {
      name: "ironsight_strikes.json",
      content: JSON.stringify(
        osintS.ok
          ? (osintS.value.strikes ?? { error: "strikes missing" })
          : { error: osintS.error },
        null,
        2,
      ),
      mediaType: "application/json",
    },
    {
      name: "ironsight_regional_alerts.json",
      content: JSON.stringify(
        osintS.ok
          ? (osintS.value.regionalAlerts ?? {
              error: "regional alerts missing",
            })
          : { error: osintS.error },
        null,
        2,
      ),
      mediaType: "application/json",
    },
    {
      name: "ironsight_polymarket.json",
      content: JSON.stringify(
        osintS.ok
          ? (osintS.value.polymarketIs ?? { error: "polymarket missing" })
          : { error: osintS.error },
        null,
        2,
      ),
      mediaType: "application/json",
    },
    {
      name: "pack_score.json",
      content: JSON.stringify(
        osintS.ok
          ? (osintS.value.packScore ?? { error: "pack score missing" })
          : { error: osintS.error },
        null,
        2,
      ),
      mediaType: "application/json",
    },
    {
      name: "evidence_index.json",
      content: JSON.stringify(
        osintS.ok
          ? (osintS.value.evidenceIndex ?? [])
          : { error: osintS.error },
        null,
        2,
      ),
      mediaType: "application/json",
    },
    {
      name: "narrative_matrix.json",
      content: JSON.stringify(
        osintS.ok
          ? (osintS.value.narrativeMatrix ?? {
              error: "narrative matrix missing",
            })
          : { error: osintS.error },
        null,
        2,
      ),
      mediaType: "application/json",
    },
    {
      name: "02_VLCC_FREIGHT_MAX.md",
      content: freightMd,
      mediaType: "text/markdown",
    },
    {
      name: "02_VLCC_FREIGHT_MAX.json",
      content: freightJson,
      mediaType: "application/json",
    },
    {
      name: "bdti_daily.json",
      content: JSON.stringify(
        bdtiS.ok
          ? {
              source: bdtiS.value.sourceUrl,
              note: bdtiS.value.note,
              latest: bdtiS.value.latest,
              prev: bdtiS.value.prev,
              changePct1d: bdtiS.value.changePct1d,
              changePct5d: bdtiS.value.changePct5d,
              structuralBias: bdtiS.value.structuralBias,
              points: bdtiS.value.points,
              asOf: bdtiS.value.asOf,
            }
          : { error: bdtiS.error },
        null,
        2,
      ),
      mediaType: "application/json",
    },
    {
      name: "chokepoint_transits.json",
      content: JSON.stringify(
        osintS.ok
          ? (osintS.value.chokepointTransits ?? {
              error: "chokepoints missing from OSINT pack",
            })
          : { error: osintS.error },
        null,
        2,
      ),
      mediaType: "application/json",
    },
    {
      name: "shipping_industry.json",
      content: JSON.stringify(
        osintS.ok
          ? (osintS.value.shippingIndustry ?? {
              error: "shipping industry missing from OSINT pack",
            })
          : { error: osintS.error },
        null,
        2,
      ),
      mediaType: "application/json",
    },
    {
      name: "00_THEATER_5CHECK.md",
      content: theaterMd,
      mediaType: "text/markdown",
    },
    {
      name: "decision_footprint.json",
      content: JSON.stringify(
        decisionFootprint ?? { error: "unavailable" },
        null,
        2,
      ),
      mediaType: "application/json",
    },
    {
      name: "market_surprise.json",
      content: JSON.stringify(
        marketSurprise ?? { error: "unavailable" },
        null,
        2,
      ),
      mediaType: "application/json",
    },
    {
      name: "theater_watch.json",
      content: theaterJson,
      mediaType: "application/json",
    },
    {
      name: "fro_holdings.json",
      content: JSON.stringify(holdingsPayload, null, 2),
      mediaType: "application/json",
    },
    { name: "strategy_intel.md", content: strategyMd, mediaType: "text/markdown" },
    {
      name: "strategy_intel.json",
      content: strategyJson,
      mediaType: "application/json",
    },
    { name: "history_digest.md", content: digest, mediaType: "text/markdown" },
    {
      name: "history_heatmap.json",
      content: heatmapJson,
      mediaType: "application/json",
    },
    {
      name: "history_alerts.json",
      content: alertsJson,
      mediaType: "application/json",
    },
    {
      name: "ironsight_links.json",
      content: ironsightJson,
      mediaType: "application/json",
    },
    {
      name: "ironsight_full_dump.json",
      content: ironsightDumpJson,
      mediaType: "application/json",
    },
    {
      name: "physical_markets.json",
      content: physicalJson,
      mediaType: "application/json",
    },
    {
      name: "energy_quotes.json",
      content: energyJson,
      mediaType: "application/json",
    },
    { name: "dossier.md", content: dossierText, mediaType: "text/markdown" },
    { name: "GEX_by_Strike.csv", content: gexCsv, mediaType: "text/csv" },
    { name: "focus_46c.csv", content: focusCsv, mediaType: "text/csv" },
    { name: "band_options_7d.csv", content: bandCsv, mediaType: "text/csv" },
    { name: "stock_30d.csv", content: undCsv, mediaType: "text/csv" },
    {
      name: "flow_events.json",
      content: JSON.stringify(flow, null, 2),
      mediaType: "application/json",
    },
    {
      name: "sources_status.json",
      content: JSON.stringify(sourcesStatus, null, 2),
      mediaType: "application/json",
    },
  ];

  const holdingsPreview = JSON.stringify(
    {
      froEquityTotalShares: positionSummary?.froEquityTotalShares ?? null,
      froEquityTotalMarketValue:
        positionSummary?.froEquityTotalMarketValue ?? null,
      accountsWithFroCount: positionSummary?.accountsWithFroCount ?? null,
      froHoldingsByAccount: positionSummary?.froHoldingsByAccount ?? null,
      accountsCatalog: positionSummary?.accountsCatalog ?? null,
    },
    null,
    2,
  );

  const dumpMeta = ironsightDumpS.ok
    ? `${ironsightDumpS.value.okCount}/${ironsightDumpS.value.panelCount} panels ok · ${Buffer.byteLength(ironsightDumpJson, "utf8")} bytes`
    : `error: ${ironsightDumpS.error}`;

  const text = [
    `# Tradehole EVERYTHING pack · ${symbol} · ${PACK_SCHEMA_VERSION} · ${new Date().toISOString()}`,
    "",
    "========== AI_BRIEF (DeepSeek entrypoint) ==========",
    osintS.ok
      ? (osintS.value.aiPack?.briefMarkdown ?? "(no brief)")
      : `ERROR: ${osintS.error}`,
    "",
    README_FOR_AI,
    "",
    "========== SOURCES STATUS ==========",
    JSON.stringify(sourcesStatus, null, 2),
    "",
    "========== 01 OSINT 7-BUCKET (paste-ready) ==========",
    osintMd,
    "",
    "========== 02 VLCC / FREIGHT MAX ==========",
    freightMd,
    "",
    "========== 00 THEATER 5-CHECK ==========",
    theaterMd,
    "",
    "========== FRO HOLDINGS (ALL ACCOUNTS) ==========",
    holdingsPreview,
    "",
    "========== STRATEGY INTEL ==========",
    strategyMd,
    "",
    "========== HISTORY DIGEST ==========",
    digest,
    "",
    "========== PHYSICAL MARKETS ==========",
    physicalJson.length > 12_000
      ? `${physicalJson.slice(0, 12_000)}\n… [truncated]`
      : physicalJson,
    "",
    "========== ENERGY QUOTES ==========",
    energyJson,
    "",
    `========== IRONSIGHT LINKS (${ironsightCount} items, full in ZIP) ==========`,
    ironsightJson.length > 40_000
      ? `${ironsightJson.slice(0, 40_000)}\n… [truncated; full uncapped in ZIP ironsight_links.json]`
      : ironsightJson,
    "",
    `========== IRONSIGHT FULL DUMP (${dumpMeta}) ==========`,
    ironsightDumpJson.length > 20_000
      ? `${ironsightDumpJson.slice(0, 20_000)}\n… [truncated; full uncapped in ZIP ironsight_full_dump.json]`
      : ironsightDumpJson,
    "",
    "========== LIVE DOSSIER ==========",
    dossierText,
    "",
    "========== FOCUS 46C CSV (excerpt) ==========",
    focusCsv.split("\n").slice(0, 40).join("\n"),
    focusCsv.split("\n").length > 40
      ? "…(truncated; full file in download bundle)"
      : "",
    "",
    "========== FLOW EVENTS (JSON, last 30d cap) ==========",
    JSON.stringify(flow.slice(0, 40), null, 2),
  ]
    .filter((l) => l !== "")
    .join("\n");

  return {
    symbol,
    generatedAt: new Date().toISOString(),
    text,
    byteLength: Buffer.byteLength(text, "utf8"),
    files,
  };
}

/** Minimal ZIP (store only, no compression) for Electron download. */
export function zipStore(files: Array<{ name: string; content: string }>): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, "utf8");
    const data = Buffer.from(file.content, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    chunks.push(local, data);

    const cen = Buffer.alloc(46 + nameBuf.length);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0, 14);
    cen.writeUInt32LE(crc >>> 0, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);
    nameBuf.copy(cen, 46);
    central.push(cen);

    offset += local.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, end]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
