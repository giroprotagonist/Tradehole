/**
 * Layer-2 lite: narrative source matrix + evidence index for AI export.
 */

export type EvidenceItem = {
  id: string;
  cluster: string;
  title: string;
  url?: string;
  source?: string;
  family: OutletFamily;
  at?: string;
};

export type OutletFamily =
  | "wire_west"
  | "state_iran"
  | "state_il"
  | "centcom_us"
  | "telegram_osint"
  | "other";

const FAMILY_RULES: Array<{ family: OutletFamily; re: RegExp }> = [
  {
    family: "wire_west",
    re: /\b(reuters|ap\b|associated press|afp|bloomberg|wsj|ft\b|bbc|guardian|nytimes|new york times|al jazeera|france 24|dw\b)\b/i,
  },
  {
    family: "state_iran",
    re: /\b(tasnim|presstv|press tv|fars|irna|tehran times|isna|mehr|defapress|sepah|saber|fotros)\b/i,
  },
  {
    family: "state_il",
    re: /\b(haaretz|times of israel|toi|jpost|jerusalem post|ynet|n12|kan|idf|i24)\b/i,
  },
  {
    family: "centcom_us",
    re: /\b(centcom|pentagon|white house|treasury|ofac|state department|us navy|cooper)\b/i,
  },
  {
    family: "telegram_osint",
    re: /\b(t\.me|telegram|osint613|rnintel|alsaa|bint jbeil|rybar|cradle|osint defender)\b/i,
  },
];

export function classifyOutletFamily(
  source: string,
  title: string,
): OutletFamily {
  const blob = `${source} ${title}`;
  for (const rule of FAMILY_RULES) {
    if (rule.re.test(blob)) return rule.family;
  }
  return "other";
}

const CLUSTER_RES: Array<{ id: string; re: RegExp }> = [
  {
    id: "fee_dispute",
    re: /\b(fee|toll|no[- ]?fees?|demands?|six conditions?|6 demands?|compensation|sanctions)\b/i,
  },
  {
    id: "israel_unilateral",
    re: /\b(unilateral|go[- ]it[- ]alone|alone|go alone|channel\s*13|netanyahu.*alone|alone.*iran)\b/i,
  },
  {
    id: "hormuz_closure",
    re: /\b(hormuz|strait|blockade|reopen|closed|closure|VLCC|war[- ]?risk)\b/i,
  },
];

export function clusterForTitle(title: string): string | null {
  for (const c of CLUSTER_RES) {
    if (c.re.test(title)) return c.id;
  }
  return null;
}

export type NarrativeMatrix = {
  asOf: string;
  clusters: Array<{
    id: string;
    byFamily: Record<string, string[]>;
    agreementHint: string;
  }>;
};

export function buildNarrativeMatrix(
  items: Array<{ title: string; source?: string; url?: string }>,
): NarrativeMatrix {
  const buckets = new Map<string, Map<OutletFamily, string[]>>();
  for (const c of CLUSTER_RES) {
    buckets.set(c.id, new Map());
  }
  for (const item of items) {
    const cluster = clusterForTitle(item.title);
    if (!cluster) continue;
    const fam = classifyOutletFamily(item.source ?? "", item.title);
    const map = buckets.get(cluster)!;
    const list = map.get(fam) ?? [];
    if (list.length < 8) {
      list.push(item.title.slice(0, 180));
      map.set(fam, list);
    }
  }

  const clusters = [...buckets.entries()].map(([id, byFam]) => {
    const families = [...byFam.keys()];
    const west = byFam.has("wire_west");
    const iran = byFam.has("state_iran");
    const il = byFam.has("state_il");
    let agreementHint = "thin / single-family";
    if (west && iran) agreementHint = "west+iran both speaking — check overlap vs spin";
    if (west && il) agreementHint = "west+IL overlap";
    if (iran && il) agreementHint = "adversary narratives both lit — high attention";
    if (families.length >= 3) agreementHint = "multi-family (≥3) — strongest agreement signal";
    const byFamily: Record<string, string[]> = {};
    for (const [k, v] of byFam) byFamily[k] = v;
    return { id, byFamily, agreementHint };
  });

  return { asOf: new Date().toISOString(), clusters };
}

export function buildEvidenceIndex(opts: {
  footprintContributions?: Array<{
    id?: string;
    label?: string;
    title?: string | null;
    detail?: string;
    points?: number;
  }>;
  surpriseTheses?: Array<{
    id: string;
    label?: string;
    contributions?: Array<{
      id?: string;
      label?: string;
      detail?: string;
      points?: number;
    }>;
  }>;
  telegram?: Array<{ channel: string; text: string; link: string; time: string }>;
  news?: Array<{ source: string; title: string; link: string; pubDate?: string }>;
}): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  let n = 0;
  const push = (item: Omit<EvidenceItem, "id" | "family"> & { family?: OutletFamily }) => {
    n += 1;
    out.push({
      id: `ev-${n}`,
      family:
        item.family ??
        classifyOutletFamily(item.source ?? "", item.title),
      ...item,
    });
  };

  for (const c of opts.footprintContributions ?? []) {
    const title = (c.title || c.detail || c.label || c.id || "footprint").slice(0, 240);
    push({
      cluster: "decision_footprint",
      title,
      source: c.id ?? "footprint",
    });
  }

  for (const t of opts.surpriseTheses ?? []) {
    for (const c of t.contributions ?? []) {
      push({
        cluster: `surprise:${t.id}`,
        title: (c.detail || c.label || c.id || t.id).slice(0, 240),
        source: c.id ?? t.id,
      });
    }
  }

  for (const p of (opts.telegram ?? []).slice(0, 60)) {
    if (!p.text) continue;
    const cluster = clusterForTitle(p.text) ?? "telegram";
    push({
      cluster,
      title: p.text.slice(0, 200),
      url: p.link || undefined,
      source: p.channel,
      at: p.time,
      family: "telegram_osint",
    });
  }

  for (const i of (opts.news ?? []).slice(0, 40)) {
    const cluster = clusterForTitle(i.title) ?? "news";
    push({
      cluster,
      title: i.title.slice(0, 200),
      url: i.link || undefined,
      source: i.source,
      at: i.pubDate,
    });
  }

  return out;
}

export function narrativeMatrixMarkdown(matrix: NarrativeMatrix): string {
  const lines = [
    "## Narrative matrix (Layer-2 lite)",
    "Where families agree is often the signal. Groups: wire_west · state_iran · state_il · centcom_us · telegram_osint · other",
    "",
  ];
  for (const c of matrix.clusters) {
    const famCount = Object.keys(c.byFamily).length;
    if (famCount === 0) {
      lines.push(`### ${c.id}`);
      lines.push("- (no hits in current pack sample)");
      lines.push("");
      continue;
    }
    lines.push(`### ${c.id}`);
    lines.push(`Agreement hint: ${c.agreementHint}`);
    for (const [fam, titles] of Object.entries(c.byFamily)) {
      lines.push(`- **${fam}** (${titles.length}):`);
      for (const t of titles.slice(0, 4)) lines.push(`  - ${t}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
