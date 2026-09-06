/**
 * Strategic / political-intel soft pressure layer (Mossad, Iran doctrine,
 * IDF recovery assessments, US–IL intel gap). Soft elevated only — never
 * High-go peers alone.
 */

export type StrategicPressureId =
  | "mossad_shakeup"
  | "iran_offensive"
  | "idf_recovery_stun"
  | "us_il_intel_gap"
  | "mou_deadline_chatter";

export type StrategicPressureHit = {
  id: StrategicPressureId;
  lit: boolean;
  status: "quiet" | "warm" | "hot";
  read: string;
  evidence: string[];
  weight: number;
};

const WINDOW_MS = 72 * 60 * 60 * 1000;

function fresh(
  items: Array<{ title: string; pubDate?: string | null }>,
  nowMs: number,
): Array<{ title: string; pubDate?: string | null }> {
  return items.filter((i) => {
    if (!i.pubDate) return true;
    const t = Date.parse(i.pubDate);
    if (!Number.isFinite(t)) return true;
    return nowMs - t <= WINDOW_MS;
  });
}

function match(
  items: Array<{ title: string; pubDate?: string | null }>,
  re: RegExp,
): string[] {
  return items.filter((i) => re.test(i.title)).map((i) => i.title);
}

/** Mossad firings / failed Iran regime-change / destabilization plan. */
export const MOSSAD_SHAKEUP_RE =
  /Mossad.{0,60}(fir(ed|ing)|dismiss|oust|shake.?up|resign|purged?)|heads?\s+of\s+(the\s+)?(Intelligence\s+Directorate|Iran\s+Division)|failed\s+(regime[- ]change|destabili[sz]e|Iran\s+plan)|Ahmadinejad.{0,40}(install|leader|president|replace)|Kurdish.{0,50}(northwest|Iran).{0,50}(uprising|invade|incursion|minorit)|regime[- ]change.{0,40}Iran|Iran\s+Division.{0,30}(fir|dismiss)/i;

/** Iran offensive doctrine / take operations into enemy territory. */
export const IRAN_OFFENSIVE_RE =
  /offensive\s+doctrine|Naqdi|into\s+enemy\s+territory|protracted\s+confrontation|hardline\s+commander|IRGC.{0,40}(offensive|abroad|aggress)|drones?.{0,40}(US\s+naval|Persian\s+Gulf|surveill)|violating\s+(Emirati|UAE)\s+ships?/i;

/** IDF stunned / Iran rapid recovery / missile production rebuilt / 2027 restore. */
export const IDF_RECOVERY_RE =
  /(IDF|Israel).{0,50}(stunned|shocked|surprised).{0,40}(Iran|recover)|Iran.{0,50}(rapid|fast|fully).{0,40}(recover|rebuild|restor)|missile\s+production.{0,30}(restor|rebuild)|strategy\s+is\s+failing|after\s+(October\s+2024|June\s+2025)\s+strikes|pre[- ]war\s+(status|capability|strength)|mid[- ]?2027|by\s+2027.{0,40}(restor|recover|rebuild)|military\s+will\s+be\s+fully\s+restored/i;

/** US skeptical of Israeli intel / Israel may act alone. */
export const US_IL_GAP_RE =
  /(U\.?S\.?|Washington|Trump).{0,50}(skeptic|doubt|dismiss).{0,40}(Israel|Mossad|intel)|Israel.{0,30}(go\s+alone|act\s+alone|without\s+(the\s+)?U\.?S)|Secret\s+Service.{0,40}(Trump|Air\s+Force\s+One)|shoulder[- ]to[- ]air.{0,40}(Trump|plane)/i;

/**
 * Hormuz MOU / Sunday diplomacy clock — PAST (Aug 2026).
 * LIVE scoring DISABLED; regex kept for archive / false-positive tests only.
 */
export const MOU_DEADLINE_ARM_ENABLED = false as const;

/**
 * Hormuz MOU / deadline diplomacy clock (historical matcher).
 * Require Hormuz/strait/transit-fee/deadline context — bare "MOU" matches
 * substrings like "AutonoMOUs" / "MOUrning" and must never soft/HOT alone.
 */
export const MOU_DEADLINE_RE =
  /\b(?:Hormuz|Strait\s+of\s+Hormuz)\b.{0,80}(?:\bMOU\b|memorandum\s+of\s+understanding|deadline|Sunday|transit[- ]?fee|deal\s+window|agreement)|(?:\bMOU\b|memorandum\s+of\s+understanding).{0,80}\b(?:Hormuz|Strait\s+of\s+Hormuz|Iran|Trump|US[-–]?Iran)\b|(?:Hormuz|Iran).{0,50}(?:transit[- ]?fee|Sunday\s+deadline|diplomacy\s+deadline)/i;

/** Reject naval-academy / shrine / training noise that Google sometimes mixes in. */
export const MOU_DEADLINE_REJECT_RE =
  /naval\s+academy|autonomous\s+systems?|summer\s+training|holy\s+shrine|Imam\s+Hussein|Karbala|\bmourning\b|robotics|integrates?.{0,30}training/i;

const MOU_DEADLINE_DISABLED_READ =
  "Hormuz MOU / Sunday diplomacy deadline is PAST — arm DISABLED. Do not watch Sunday window or light soft wake on MOU chatter.";

export function classifyStrategicPressure(
  items: Array<{ title: string; pubDate?: string | null }>,
  nowMs = Date.now(),
): StrategicPressureHit[] {
  const pool = fresh(items, nowMs);

  const specs: Array<{
    id: StrategicPressureId;
    re: RegExp;
    reject?: RegExp;
    weight: number;
    quiet: string;
    warm: (n: number) => string;
    hot: (n: number) => string;
  }> = [
    {
      id: "mossad_shakeup",
      re: MOSSAD_SHAKEUP_RE,
      weight: 10,
      quiet: "No fresh Mossad shakeup / failed regime-change plan chatter ≤72h.",
      warm: (n) =>
        `Mossad/intel shakeup or failed Iran plan chatter (${n}) — political desperation overlay; not a kinetic go gate.`,
      hot: (n) =>
        `Elevated Mossad shakeup / regime-change failure sample (${n}) — Bibi pressure soft wake; still need AER HOT + peer.`,
    },
    {
      id: "iran_offensive",
      re: IRAN_OFFENSIVE_RE,
      weight: 8,
      quiet: "No fresh Iran 'offensive doctrine' / enemy-territory ops chatter ≤72h.",
      warm: (n) =>
        `Iran offensive-doctrine / abroad-ops language (${n}) — soft risk-calculus shift; not High-go.`,
      hot: (n) =>
        `Strong Iran offensive-doctrine sample (${n}) — may strike/respond harder; corroborate; not High-go alone.`,
    },
    {
      id: "idf_recovery_stun",
      re: IDF_RECOVERY_RE,
      weight: 8,
      quiet: "No fresh IDF 'stunned by Iran recovery' / missile rebuild assessments ≤72h.",
      warm: (n) =>
        `IDF/Israel recovery-stun or Iran rebuild chatter (${n}) — strategic pressure soft wake.`,
      hot: (n) =>
        `Elevated 'Iran recovering fast / strategy failing' sample (${n}) — escalation pressure; not a go gate.`,
    },
    {
      id: "us_il_intel_gap",
      re: US_IL_GAP_RE,
      weight: 8,
      quiet: "No fresh US–IL intel gap / Israel-alone / Trump AF1 threat chatter ≤72h.",
      warm: (n) =>
        `US skeptical of IL intel or Israel-alone / AF1-threat chatter (${n}) — coordination soft watch.`,
      hot: (n) =>
        `Elevated US–IL gap / alone-path sample (${n}) — Israel may move with less US cover; not High-go alone.`,
    },
    {
      id: "mou_deadline_chatter",
      re: MOU_DEADLINE_RE,
      reject: MOU_DEADLINE_REJECT_RE,
      weight: 6,
      quiet: MOU_DEADLINE_DISABLED_READ,
      warm: () => MOU_DEADLINE_DISABLED_READ,
      hot: () => MOU_DEADLINE_DISABLED_READ,
    },
  ];

  return specs.map((s) => {
    if (s.id === "mou_deadline_chatter" && !MOU_DEADLINE_ARM_ENABLED) {
      return {
        id: s.id,
        lit: false,
        status: "quiet" as const,
        weight: s.weight,
        read: MOU_DEADLINE_DISABLED_READ,
        evidence: [] as string[],
      };
    }
    const hits = match(pool, s.re).filter(
      (t) => !(s.reject && s.reject.test(t)),
    );
    const status: "quiet" | "warm" | "hot" =
      hits.length >= 2 ? "hot" : hits.length >= 1 ? "warm" : "quiet";
    return {
      id: s.id,
      lit: status !== "quiet",
      status,
      weight: s.weight,
      read:
        status === "hot"
          ? s.hot(hits.length)
          : status === "warm"
            ? s.warm(hits.length)
            : s.quiet,
      evidence: hits.slice(0, 5),
    };
  });
}
