/**
 * DeepSeek-first AI pack layer (tradehole_pack_v3).
 * Brief + events timeline + contradiction + catalysts + diff vs yesterday.
 */
import type { DecisionFootprint } from "./analytics/decisionFootprint";
import type { MarketSurprise } from "./analytics/marketSurprise";
import type { TheaterWatch } from "./theaterWatch";
import type { DealAlarmState } from "./dealAlarm";
import type { IntelAlarmState } from "./intelAlarm";
import type { ChokepointTransitsReport } from "./analytics/chokepointTransits";
import type { BdtiReport } from "./analytics/bdti";
import type { PackScore } from "./packScore";
import type { NarrativeMatrix, EvidenceItem } from "./packEvidence";
import { classifyOutletFamily } from "./packEvidence";
import {
  getPriorIntelDailySnapshot,
  type IntelDailyRow,
} from "./intelDailySnapshot";

export const PACK_SCHEMA_VERSION = "tradehole_pack_v3";

export type Freshness = {
  observedAt: string;
  asOf: string | null;
  lagHours: number | null;
  recycleScore: number;
};

export type CanonicalEvent = {
  id: string;
  type: string;
  ts: string;
  title: string;
  detail?: string;
  url?: string;
  source?: string;
  sourceFamily: string;
  confidence: "low" | "med" | "high";
  freshness: Freshness;
  tags?: string[];
};

export type Contradiction = {
  asOf: string;
  marketSays: string;
  realitySays: string;
  edges: Array<{
    id: string;
    label: string;
    realityPct: number | null;
    marketPct: number | null;
    edgePp: number | null;
    confidence: string;
  }>;
  falsifiers: string[];
  bookImplication: string;
};

export type Catalyst = {
  id: string;
  label: string;
  window: string;
  whatToWatch: string;
  armed: boolean;
  triggered: boolean;
  lastEvidence: string | null;
  bullishForFroIf: string;
};

export type PackDiff = {
  asOf: string;
  priorDay: string | null;
  priorTs: string | null;
  footprint: { from: number | null; to: number | null; delta: number | null };
  packScore: { from: number | null; to: number | null; delta: number | null };
  surpriseEdges: Array<{
    id: string;
    from: number | null;
    to: number | null;
    delta: number | null;
  }>;
  bullets: string[];
};

export type AiPackV3 = {
  schemaVersion: typeof PACK_SCHEMA_VERSION;
  generatedAt: string;
  symbol: string;
  briefMarkdown: string;
  contradiction: Contradiction;
  catalysts: Catalyst[];
  events: CanonicalEvent[];
  eventsJsonl: string;
  packDiff: PackDiff;
  deepseekPrompt: string;
};

function lagHours(asOf: string | null | undefined, nowMs: number): number | null {
  if (!asOf) return null;
  const t = Date.parse(asOf);
  if (!Number.isFinite(t)) return null;
  return Math.round(((nowMs - t) / 3_600_000) * 10) / 10;
}

function freshness(
  asOf: string | null | undefined,
  observedAt: string,
  recycleScore = 0,
): Freshness {
  return {
    observedAt,
    asOf: asOf ?? null,
    lagHours: lagHours(asOf, Date.parse(observedAt)),
    recycleScore,
  };
}

function eventId(type: string, key: string): string {
  const slug = key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 48);
  return `${type}:${slug}`;
}

export type AiBriefInput = {
  symbol: string;
  generatedAt: string;
  footprint: DecisionFootprint | null;
  surprise: MarketSurprise | null;
  theater: TheaterWatch | null;
  deal: DealAlarmState | null;
  intel: IntelAlarmState | null;
  chokepoints: ChokepointTransitsReport | null;
  bdti: BdtiReport | null;
  packScore: PackScore | null;
  narrativeMatrix: NarrativeMatrix | null;
  evidenceIndex: EvidenceItem[] | null;
  froPrice?: number | null;
  froChangePct?: number | null;
  focus46?: {
    bid?: number | null;
    ask?: number | null;
    last?: number | null;
    volume?: number | null;
  } | null;
  telegramPostCount?: number;
  gaps?: string[];
};

function buildContradiction(input: AiBriefInput): Contradiction {
  const s = input.surprise;
  const edges =
    s?.theses.map((t) => ({
      id: t.id,
      label: t.label,
      realityPct: t.realityPct,
      marketPct: t.marketPct,
      edgePp: t.edgePp,
      confidence: t.confidence,
    })) ?? [];
  const fee = edges.find((e) => e.id === "fee_free_blink");
  const hormuz = edges.find((e) => e.id === "hormuz_disruption");
  const lottery = edges.find((e) => e.id === "fro_46c_lottery");
  const polyCf = input.theater?.polymarket.ceasefire?.yesPct;
  const polyH = input.theater?.polymarket.hormuz?.yesPct;
  const h = input.chokepoints?.hormuz.latest;
  const lit = (input.footprint?.signals ?? [])
    .filter((x) => x.lit)
    .map((x) => x.id);

  const marketSays = `Polymarket ceasefire-ish ~${polyCf ?? "—"}%; Hormuz-normal ~${polyH ?? "—"}%; fee-free/blink market ${fee?.marketPct ?? "—"}%. Tape prices peace dividend / deal hope.`;
  const realitySays = `Decision Footprint ${input.footprint?.score ?? "—"} (${input.footprint?.band ?? "?"}) lit=[${lit.join(", ") || "none"}]. Hormuz PortWatch ${h ? `${h.date}: ${h.nTotal} total / ${h.nTanker} tanker` : "n/a"}. War-risk=${input.theater?.warRiskInsurance.regime ?? "?"}. BDTI=${input.bdti?.latest?.value ?? "—"}.`;

  const falsifiers: string[] = [];
  if (h && h.nTanker === 0)
    falsifiers.push(
      `PortWatch Hormuz ${h.date}: 0 tankers (lagged) — contradicts reopen hope`,
    );
  if (fee && fee.edgePp != null && fee.edgePp <= -50)
    falsifiers.push(
      `Fee-free edge ${fee.edgePp}pp — market far ahead of Reality on blink/TRIM path`,
    );
  if (lit.includes("fee_dispute"))
    falsifiers.push("Fee dispute / 6-demands path lit — not fee-free deal");
  if (lit.includes("israel_unilateral"))
    falsifiers.push("Israel unilateral planning lit (contingent, not go-order)");
  if (input.theater?.warRiskInsurance.regime === "spike_chatter")
    falsifiers.push("War-risk insurance spike_chatter");
  if (lottery && lottery.edgePp != null && lottery.edgePp > 10)
    falsifiers.push(
      `FRO Sep $46c lottery underpriced (edge +${lottery.edgePp}pp)`,
    );

  return {
    asOf: input.generatedAt,
    marketSays,
    realitySays,
    edges,
    falsifiers,
    bookImplication:
      "HOLD FRO Sep $46c lottery stubs vs Poly deal hope unless fee-free / OFAC lift / Hormuz-normal prints for real. Do not TRIM on soft deal rhetoric. Aug short-dated OTM = separate dead lottery sleeve.",
  };
}

function buildCatalysts(input: AiBriefInput): Catalyst[] {
  const polyCf = input.theater?.polymarket.ceasefire?.yesPct ?? null;
  const unilateral = input.footprint?.signals.find(
    (s) => s.id === "israel_unilateral",
  );
  const fee = input.footprint?.signals.find((s) => s.id === "fee_dispute");
  const ghost = input.theater?.bataanGhost;
  const cape = input.chokepoints?.cape.latest;

  return [
    {
      id: "wh_pool_delay",
      label: "White House press pool non-statement / delay admit",
      window: "12–24h",
      whatToWatch:
        "AP/Reuters pool: Trump/Leavitt asked about imminent deal; deflection or 'still working' = first crack",
      armed: true,
      triggered: false,
      lastEvidence: null,
      bullishForFroIf: "Admission of delay / no deal yet without fee-free text",
    },
    {
      id: "tehran_am_broadcast",
      label: "Iranian state TV morning (PressTV/Tasnim)",
      window: "next Tehran morning (~5–6h from US evening)",
      whatToWatch:
        "Double-down on 6 demands / gloat vs soften on Oman proposals",
      armed: fee?.lit ?? true,
      triggered: false,
      lastEvidence: fee?.detail ?? null,
      bullishForFroIf: "Double-down / demands unchanged / US missed deadline frame",
    },
    {
      id: "poly_aug15_crack",
      label: "Polymarket ceasefire/deal contract drift",
      window: "7d · alert −3pp/hour",
      whatToWatch: `Ceasefire-ish now ~${polyCf ?? "—"}% — watch tick down to ~92–90 on no headline`,
      armed: polyCf != null && polyCf >= 90,
      triggered: false,
      lastEvidence:
        polyCf != null ? `Polymarket ceasefire-ish ${polyCf}%` : null,
      bullishForFroIf: "Smart-money sell of deal probability without soft wire",
    },
    {
      id: "ch13_kan_escalation",
      label: "Channel 13 / Kan defense-source language escalate",
      window: "any · often ~21:00–22:00 Israel",
      whatToWatch:
        "'Preparing' → 'plans to security cabinet' / IDF asset moved forward",
      armed: unilateral?.lit ?? false,
      triggered: false,
      lastEvidence: unilateral?.detail ?? null,
      bullishForFroIf: "Operational plans / asset move (not evergreen ready)",
    },
    {
      id: "logistics_tail_ais",
      label: "USNS / Bataan logistics sprint (manual AIS)",
      window: "12–72h",
      whatToWatch:
        "MarineTraffic: Bataan SOG≥15 toward Strait; USNS oilers toward Gulf; ghost logistics hot",
      armed: (ghost?.formationScore ?? 0) >= 2,
      triggered: false,
      lastEvidence: ghost
        ? `ghost ${ghost.formationRegime} ${ghost.formationScore}/${ghost.formationMax}`
        : null,
      bullishForFroIf: "Physical go-prep while diplomacy expired",
    },
    {
      id: "cape_panic",
      label: "Cape of Good Hope transit spike",
      window: "as PortWatch updates (~3–7d lag)",
      whatToWatch: `Cape latest ${cape ? `${cape.nTotal} @ ${cape.date}` : "n/a"} — panic if sustained ≥120`,
      armed: true,
      triggered: cape != null && cape.nTotal >= 120,
      lastEvidence: cape
        ? `Cape ${cape.date}: ${cape.nTotal} total / ${cape.nTanker} tanker`
        : null,
      bullishForFroIf: "Diversion infrastructure activated (long-war freight)",
    },
  ];
}

function buildEvents(input: AiBriefInput): CanonicalEvent[] {
  const now = input.generatedAt;
  const out: CanonicalEvent[] = [];
  const push = (e: Omit<CanonicalEvent, "id"> & { id?: string }) => {
    const id =
      e.id ??
      eventId(e.type, `${e.ts}:${e.title}`.slice(0, 80));
    if (out.some((x) => x.id === id)) return;
    out.push({ ...e, id });
  };

  if (input.footprint) {
    for (const s of input.footprint.signals.filter((x) => x.lit)) {
      push({
        type: `df_${s.id}`,
        ts: s.at ?? now,
        title: s.label,
        detail: s.detail,
        source: s.source,
        sourceFamily: classifyOutletFamily(s.source, s.detail),
        confidence: s.points >= 10 ? "high" : "med",
        freshness: freshness(s.at, now, 0),
        tags: ["decision_footprint", s.tier === 1 ? "tier1" : `tier${s.tier}`],
      });
    }
  }

  if (input.surprise) {
    for (const t of input.surprise.theses) {
      if (t.edgePp == null) continue;
      push({
        type: "market_surprise_edge",
        ts: input.surprise.asOf,
        title: `${t.label}: edge ${t.edgePp >= 0 ? "+" : ""}${t.edgePp}pp`,
        detail: t.verdict,
        source: "marketSurprise",
        sourceFamily: "other",
        confidence: t.confidence === "high" ? "high" : t.confidence === "med" ? "med" : "low",
        freshness: freshness(input.surprise.asOf, now, 0),
        tags: ["edge", t.id],
      });
    }
  }

  const h = input.chokepoints?.hormuz.latest;
  if (h) {
    push({
      type: "portwatch_hormuz_day",
      ts: `${h.date}T12:00:00.000Z`,
      title: `Hormuz transits ${h.nTotal} total / ${h.nTanker} tanker`,
      detail: input.chokepoints?.read,
      source: "IMF PortWatch",
      sourceFamily: "other",
      confidence: "high",
      freshness: freshness(
        `${h.date}T12:00:00.000Z`,
        now,
        0,
      ),
      tags: ["physical", "chokepoint", "hormuz"],
    });
  }
  const cape = input.chokepoints?.cape.latest;
  if (cape) {
    push({
      type: "portwatch_cape_day",
      ts: `${cape.date}T12:00:00.000Z`,
      title: `Cape transits ${cape.nTotal} total / ${cape.nTanker} tanker`,
      source: "IMF PortWatch",
      sourceFamily: "other",
      confidence: "high",
      freshness: freshness(`${cape.date}T12:00:00.000Z`, now, 0),
      tags: ["physical", "chokepoint", "cape"],
    });
  }

  if (input.bdti?.latest) {
    push({
      type: "bdti_print",
      ts: `${input.bdti.latest.date}T18:00:00.000Z`,
      title: `BDTI ${input.bdti.latest.value}`,
      detail: input.bdti.biasNote,
      source: input.bdti.sourceUrl,
      sourceFamily: "other",
      confidence: "med",
      freshness: freshness(
        `${input.bdti.latest.date}T18:00:00.000Z`,
        now,
        0,
      ),
      tags: ["freight", "bdti"],
    });
  }

  if (input.theater) {
    push({
      type: "polymarket_snapshot",
      ts: now,
      title: `Poly ceasefire ${input.theater.polymarket.ceasefire?.yesPct ?? "—"}% · Hormuz normal ${input.theater.polymarket.hormuz?.yesPct ?? "—"}%`,
      source: "Polymarket",
      sourceFamily: "other",
      confidence: "high",
      freshness: freshness(now, now, 0),
      tags: ["market", "polymarket"],
    });
    push({
      type: "war_risk_regime",
      ts: now,
      title: `War-risk ${input.theater.warRiskInsurance.regime}`,
      detail: input.theater.warRiskInsurance.read,
      source: "theater.warRiskInsurance",
      sourceFamily: "wire_west",
      confidence:
        input.theater.warRiskInsurance.regime === "spike_chatter"
          ? "med"
          : "low",
      freshness: freshness(now, now, 0),
      tags: ["insurance", "war_risk"],
    });
  }

  for (const e of (input.deal?.events ?? []).slice(0, 12)) {
    push({
      type: `deal_${e.kind}`,
      ts: e.detectedAt ?? now,
      title: e.title.slice(0, 180),
      detail: e.read,
      url: e.link || undefined,
      source: e.source,
      sourceFamily: classifyOutletFamily(e.source, e.title),
      confidence: e.severity === "critical" ? "high" : "med",
      freshness: freshness(e.detectedAt, now, 0),
      tags: ["deal", e.action],
    });
  }

  // Evidence index highlights (fee / unilateral / hormuz)
  for (const ev of (input.evidenceIndex ?? []).slice(0, 40)) {
    if (
      !["fee_dispute", "israel_unilateral", "hormuz_closure", "telegram"].includes(
        ev.cluster,
      ) &&
      !ev.cluster.startsWith("surprise:")
    ) {
      continue;
    }
    push({
      type: `evidence_${ev.cluster}`,
      ts: ev.at || now,
      title: ev.title.slice(0, 180),
      url: ev.url,
      source: ev.source,
      sourceFamily: ev.family,
      confidence: "med",
      freshness: freshness(ev.at, now, 0),
      tags: ["evidence", ev.cluster],
    });
  }

  out.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts) || 0);
  return out.slice(0, 120);
}

function buildPackDiff(
  input: AiBriefInput,
  prior: IntelDailyRow | null,
): PackDiff {
  const toFp = input.footprint?.score ?? null;
  const toPack = input.packScore?.score ?? null;
  const fromFp = prior?.footprintScore ?? null;
  const fromPack = prior?.packScore ?? null;
  const priorEdges = prior?.surpriseEdges ?? [];
  const nowEdges =
    input.surprise?.theses.map((t) => ({
      id: t.id,
      edgePp: t.edgePp,
    })) ?? [];

  const surpriseEdges = nowEdges.map((n) => {
    const p = priorEdges.find((x) => x.id === n.id);
    const from = p?.edgePp ?? null;
    const to = n.edgePp;
    return {
      id: n.id,
      from,
      to,
      delta:
        from != null && to != null
          ? Math.round((to - from) * 10) / 10
          : null,
    };
  });

  const bullets: string[] = [];
  if (fromFp != null && toFp != null) {
    bullets.push(
      `Decision Footprint ${fromFp} → ${toFp} (Δ ${toFp - fromFp >= 0 ? "+" : ""}${toFp - fromFp})`,
    );
  } else if (toFp != null) {
    bullets.push(`Decision Footprint now ${toFp} (no prior day row)`);
  }
  if (fromPack != null && toPack != null) {
    bullets.push(
      `Pack score ${fromPack} → ${toPack} (Δ ${toPack - fromPack >= 0 ? "+" : ""}${toPack - fromPack})`,
    );
  }
  for (const e of surpriseEdges) {
    if (e.delta != null && Math.abs(e.delta) >= 5) {
      bullets.push(
        `Edge ${e.id}: ${e.from} → ${e.to} (Δ ${e.delta >= 0 ? "+" : ""}${e.delta}pp)`,
      );
    }
  }
  const h = input.chokepoints?.hormuz.latest;
  if (h) {
    bullets.push(
      `Hormuz PortWatch ${h.date}: ${h.nTotal}/${h.nTanker} tanker (lagged)`,
    );
  }
  if (!bullets.length) bullets.push("No prior intel_daily_snapshots row to diff.");

  return {
    asOf: input.generatedAt,
    priorDay: prior?.day ?? null,
    priorTs: prior?.ts ?? null,
    footprint: {
      from: fromFp,
      to: toFp,
      delta:
        fromFp != null && toFp != null ? toFp - fromFp : null,
    },
    packScore: {
      from: fromPack,
      to: toPack,
      delta:
        fromPack != null && toPack != null ? toPack - fromPack : null,
    },
    surpriseEdges,
    bullets,
  };
}

function buildBriefMarkdown(
  input: AiBriefInput,
  contradiction: Contradiction,
  catalysts: Catalyst[],
  packDiff: PackDiff,
  eventCount: number,
): string {
  const fro = input.froPrice;
  const focus = input.focus46;
  const lines: string[] = [];
  lines.push(`# AI_BRIEF · ${input.symbol} · ${PACK_SCHEMA_VERSION}`);
  lines.push(`generatedAt: ${input.generatedAt}`);
  lines.push("");
  lines.push("## For DeepSeek / receiving LLM");
  lines.push(
    "Read this file first. Then `contradiction.json`, `catalysts.json`, `events.jsonl`, `market_surprise.json`, `chokepoint_transits.json`. Do not invent live AIS. Prefer evidence URLs. Respect lagHours on physical prints.",
  );
  lines.push(
    "**Title ≠ signal:** Israel Strike scenario titles (e.g. High-confidence go) are labels only — action is froGuidance / HOLD-watch; soft OSINT ≠ buy-the-ask. Book = sum Sep $46c across ALL accounts (Rollover+Roth+Robinhood), not one 0× row. Rome next: September — walkout arm DISABLED; do not invent a Rome walkout clock.",
  );
  lines.push("");
  lines.push("## Contradiction");
  lines.push(`**Market:** ${contradiction.marketSays}`);
  lines.push(`**Reality:** ${contradiction.realitySays}`);
  lines.push("**Falsifiers:**");
  for (const f of contradiction.falsifiers.slice(0, 8)) {
    lines.push(`- ${f}`);
  }
  if (!contradiction.falsifiers.length) lines.push("- (none hard-lit)");
  lines.push("");
  lines.push("## Edges (Reality − Market pp)");
  lines.push("| thesis | reality | market | edge | conf |");
  lines.push("| --- | ---: | ---: | ---: | --- |");
  for (const e of contradiction.edges) {
    lines.push(
      `| ${e.id} | ${e.realityPct ?? "—"} | ${e.marketPct ?? "—"} | ${e.edgePp ?? "—"} | ${e.confidence} |`,
    );
  }
  lines.push("");
  lines.push("## Physical falsifiers");
  const h = input.chokepoints?.hormuz.latest;
  const c = input.chokepoints?.cape.latest;
  lines.push(
    `- Hormuz PortWatch: ${h ? `${h.date} total=${h.nTotal} tanker=${h.nTanker} (lagged ~3–7d)` : "unavailable"}`,
  );
  lines.push(
    `- Cape: ${c ? `${c.date} total=${c.nTotal} tanker=${c.nTanker}` : "unavailable"}`,
  );
  lines.push(
    `- BDTI: ${input.bdti?.latest ? `${input.bdti.latest.value} @ ${input.bdti.latest.date}` : "—"}`,
  );
  lines.push(
    `- War-risk: ${input.theater?.warRiskInsurance.regime ?? "—"} · AIS live scrape: ❌ unknown`,
  );
  lines.push("");
  lines.push("## Book");
  lines.push(contradiction.bookImplication);
  lines.push(
    `Marks: FRO ${fro ?? "—"} (${input.froChangePct != null ? `${input.froChangePct >= 0 ? "+" : ""}${input.froChangePct.toFixed(2)}%` : "—"}) · Sep$46c bid/ask ${focus?.bid ?? "—"}/${focus?.ask ?? "—"} last ${focus?.last ?? "—"} vol ${focus?.volume ?? "—"}`,
  );
  lines.push(
    `DF ${input.footprint?.score ?? "—"} · alarm ${input.intel?.level ?? "—"} · dealBias ${input.deal?.actionBias ?? input.deal?.level ?? "—"} · packScore ${input.packScore?.score ?? "—"}/${input.packScore?.band ?? "?"} · TG posts ~${input.telegramPostCount ?? "—"} · events ${eventCount}`,
  );
  lines.push("");
  lines.push("## Diff vs prior day");
  for (const b of packDiff.bullets) lines.push(`- ${b}`);
  lines.push("");
  lines.push("## Catalysts (12–72h)");
  for (const cata of catalysts) {
    const flag = cata.triggered ? "TRIGGERED" : cata.armed ? "armed" : "idle";
    lines.push(
      `- **${cata.id}** [${flag}] ${cata.label} — ${cata.whatToWatch}${cata.lastEvidence ? ` · evidence: ${cata.lastEvidence.slice(0, 120)}` : ""}`,
    );
  }
  lines.push("");
  lines.push("## Honesty gaps (do not hallucinate)");
  const gaps = (input.gaps ?? []).filter(
    (g) => g.includes("❌") || /license|AIS|Baltic|Platts|FFA/i.test(g),
  );
  for (const g of gaps.slice(0, 8)) lines.push(`- ${g}`);
  if (!gaps.length) {
    lines.push("- ❌ No live commercial AIS scrape");
    lines.push("- ❌ No live Baltic TD3C FFA (license)");
    lines.push("- ❌ No Platts Dated Brent (license)");
  }
  lines.push("");
  lines.push("## Output contract for DeepSeek");
  lines.push(
    "Return: (1) contradiction one-liner (2) total book qty across ALL accounts before any ADD advice (3) top falsifiers (4) which catalysts are closest (5) HOLD/TRIM/ADD with size discipline (6) what would flip the thesis. Cite event ids / URLs when possible. Never treat scenario title alone as go / buy-ask.",
  );
  lines.push("");
  return lines.join("\n");
}

const DEEPSEEK_PROMPT = `You are analyzing a Tradehole Hormuz/FRO intelligence pack (${PACK_SCHEMA_VERSION}).

READ ORDER:
1) AI_BRIEF.md (this brief)
2) contradiction.json
3) catalysts.json
4) events.jsonl (canonical timeline — respect freshness.lagHours)
5) market_surprise.json + decision_footprint.json
6) chokepoint_transits.json + bdti_daily.json
7) Only then optional telegram dumps / ironsight panels

RULES:
- Never invent live AIS positions or Baltic FFA / Platts numbers.
- Prefer multi-family agreement in narrative_matrix over single state-media claim.
- Polymarket high deal % is NOT proof of fee-free deal — check fee_dispute / 6 demands.
- Physical: PortWatch Hormuz near-zero + war-risk spike argues against reopen hope.
- Book default: HOLD Sep $46c lottery vs deal hope unless hard fee-free / OFAC lift.
- Scenario TITLE is not a trade signal — follow froGuidance / action lines. Soft OSINT (1 tanker, DIP warm, empty NAV AIS, hex-watch K35R ≠ E-6) is NOT High-go / Doomsday / buy-ask.
- Positions: sum Sep $46c across ALL accounts (Rollover + Roth + Robinhood). A 0× account row does not mean flat book. Robinhood is separate from E*TRADE.
- Rome next round is September. Live Rome walkout / spoiler-path-live / delegation-returning classifier is DISABLED and PAST. Do not invent a Rome walkout clock. Residual Bibi = Shekel / Natanz–Fordow / Gaza–Lebanon ground.

OUTPUT:
1. Contradiction (market vs reality) in ≤3 sentences
2. Book qty across ALL accounts (before ADD advice)
3. Falsifiers ranked
4. Catalyst watch — which needle is closest in 12–72h
5. Book action: HOLD | TRIM | ADD with rationale
6. What would flip you
`;

export function buildAiPackV3(input: AiBriefInput): AiPackV3 {
  const prior = getPriorIntelDailySnapshot();
  const contradiction = buildContradiction(input);
  const catalysts = buildCatalysts(input);
  const events = buildEvents(input);
  const packDiff = buildPackDiff(input, prior);
  const briefMarkdown = buildBriefMarkdown(
    input,
    contradiction,
    catalysts,
    packDiff,
    events.length,
  );
  const eventsJsonl = events.map((e) => JSON.stringify(e)).join("\n") + "\n";

  return {
    schemaVersion: PACK_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    symbol: input.symbol,
    briefMarkdown,
    contradiction,
    catalysts,
    events,
    eventsJsonl,
    packDiff,
    deepseekPrompt: DEEPSEEK_PROMPT,
  };
}

/** Machine-readable schema stub for ZIP. */
export function packSchemaV3Json(): Record<string, unknown> {
  return {
    schemaVersion: PACK_SCHEMA_VERSION,
    description:
      "Tradehole free intelligence pack optimized for DeepSeek / external LLM quick deep analysis",
    entrypoint: "AI_BRIEF.md",
    files: {
      "AI_BRIEF.md": "≤~3k token executive brief — read first",
      "DEEPSEEK_PROMPT.txt": "System/user prompt stub for DeepSeek",
      "contradiction.json": "Market vs Reality + edges + falsifiers",
      "catalysts.json": "12–72h catalyst watchlist with armed/triggered",
      "events.jsonl": "Canonical timeline (one JSON object per line)",
      "pack_diff.json": "Diff vs prior intel_daily_snapshots day",
      "pack_meta.json": "schemaVersion + generatedAt + symbol",
      "market_surprise.json": "Edge = Reality% − Market%",
      "decision_footprint.json": "0–100 diplomatic/execution/market score",
      "chokepoint_transits.json": "IMF PortWatch Hormuz/Bab/Cape (lagged)",
      "bdti_daily.json": "StockQ BDTI daily proxy",
      "telegram_channel_dump.json": "Two-pass public t.me/s dump",
      "narrative_matrix.json": "Source-family agreement clusters",
      "evidence_index.json": "Clickable evidence rows",
      "pack_score.json": "Free-pack completeness 0–100",
      "sources_status.json": "Per-feed ok|error|partial",
    },
    freshness: {
      observedAt: "ISO when Tradehole observed/exported",
      asOf: "ISO or date of underlying print",
      lagHours: "observedAt − asOf in hours (null if unknown)",
      recycleScore: "0=fresh · higher=likely reprint/evergreen",
    },
    rulesForModel: [
      "Do not invent AIS / Baltic FFA / Platts",
      "Respect lagHours on PortWatch and TD3C",
      "Fee-dispute + 6 demands ≠ fee-free Polymarket deal",
      "Default book HOLD Sep $46c vs soft deal rhetoric",
    ],
  };
}
