/**
 * East Africa / Somali-basin Cape-route watch.
 * Freight thesis only — never an Israel High-go peer.
 *
 * Idea: Bab el-Mandeb is the northern choke; Somali-coast attacks can
 * reprice the Cape *route* via war-risk even without a strike at the Cape.
 * A headline is not Cape-closed. Sunday/Monday Bibi timing is not a fire rule.
 */

export type EastAfricaSignalId =
  | "maritime_claim"
  | "houthi_transfer"
  | "puntland_base"
  | "somali_vlcc"
  | "joint_statement";

export type EastAfricaSignal = {
  id: EastAfricaSignalId;
  lit: boolean;
  status: "quiet" | "warm" | "hot";
  read: string;
  evidence: string[];
};

export type EastAfricaCapeState = {
  thesis: string;
  regime: "quiet" | "watch" | "forming" | "hot" | "unknown";
  read: string;
  signals: EastAfricaSignal[];
  items: Array<{ title: string; link: string; pubDate: string }>;
  links: Array<{ label: string; href: string }>;
  rules: string[];
};

const WINDOW_MS = 72 * 60 * 60 * 1000;

export const EAST_AFRICA_RSS_QUERIES = [
  '(al-Shabaab OR "al Shabaab" OR Harakat) (maritime OR "anti-ship" OR drone OR tanker OR VLCC OR missile OR naval OR coast)',
  '(Houthi OR "Ansar Allah") (al-Shabaab OR Somalia) (weapon OR train OR drone OR transfer OR alliance OR statement)',
  '(Bosaso OR Puntland OR Kismayo OR Hobyo) (AFRICOM OR "U.S." OR US OR tanker OR VLCC OR attack OR base)',
];

export const EAST_AFRICA_SIGNAL_LABELS: Record<EastAfricaSignalId, string> = {
  maritime_claim: "Maritime / anti-ship claim",
  houthi_transfer: "Houthi ↔ al-Shabaab transfer",
  puntland_base: "Puntland / Bosaso US footprint",
  somali_vlcc: "Somali-basin VLCC / tanker",
  joint_statement: "Houthi–al-Shabaab joint statement",
};

/** Capability / sea-attack language — inland drone/missile hits do not count. */
export const MARITIME_CLAIM_RE =
  /(al-?Shabaab|Harakat).{0,120}(maritime|anti[- ]?ship|naval|coastal|USV|suicide\s+boat|(drone|UAV|missile).{0,40}(ship|tanker|VLCC|vessel|coast|naval|maritime))|Somali.{0,60}(anti[- ]?ship|maritime\s+drone|naval\s+attack)/i;

export const HOUTHI_TRANSFER_RE =
  /(Houthi|Ansar\s*Allah).{0,120}(al-?Shabaab)|(al-?Shabaab).{0,120}(Houthi|Ansar\s*Allah|Yemen)/i;

export const PUNTLAND_BASE_RE =
  /(Bosaso|Puntland).{0,80}(AFRICOM|U\.?S\.?|US\s+(base|forces|troops|military)|American)|(AFRICOM|U\.?S\.?\s+(base|forces)).{0,80}(Bosaso|Puntland|Somalia)/i;

export const SOMALI_VLCC_RE =
  /(VLCC|tanker|oil\s+tanker|merchant\s+ship).{0,90}(Somali|Kismayo|Hobyo|Mogadishu|Puntland|Indian\s+Ocean)|(al-?Shabaab).{0,70}(tanker|VLCC|hijack|struck|attacked.{0,20}ship)/i;

export const JOINT_STATEMENT_RE =
  /(Houthi|Ansar\s*Allah).{0,50}(al-?Shabaab).{0,50}(joint|statement|alliance|coordinat|pact)|(al-?Shabaab).{0,50}(Houthi|Ansar).{0,50}(joint|statement|alliance)/i;

export const EAST_AFRICA_LINKS: Array<{ label: string; href: string }> = [
  {
    label: "MarineTraffic · Somali basin",
    href: "https://www.marinetraffic.com/en/ais/home/centerx:48.5/centery:2.0/zoom:6",
  },
  {
    label: "MarineTraffic · Kismayo approaches",
    href: "https://www.marinetraffic.com/en/ais/home/centerx:42.55/centery:-0.38/zoom:8",
  },
  {
    label: "TankerMap (no signup)",
    href: "https://tankermap.com/oil-tanker-tracker",
  },
  {
    label: "Google · al-Shabaab maritime",
    href: `https://news.google.com/search?q=${encodeURIComponent("al-Shabaab maritime tanker Somalia")}&hl=en-US&gl=US&ceid=US:en`,
  },
];

export const EAST_AFRICA_RULES = [
  "Freight / Cape-route watch only — never an Israel High-go peer (AER≥3 + physical peer still required for go).",
  "A Somali-basin attack is an underwriter-path thesis (war-risk may reprice the East Africa/Cape *route*) — not automatic Cape-closed.",
  "Bibi Sunday/Monday strike timing is overlay chatter, not a fire rule.",
  "No live Somali AIS scrape — TankerMap / MT are Layer-3 eyeballs.",
];

function fresh<T extends { title: string; pubDate?: string | null }>(
  items: T[],
  nowMs: number,
): T[] {
  return items.filter((i) => {
    if (!i.pubDate) return true;
    const t = Date.parse(i.pubDate);
    if (!Number.isFinite(t)) return true;
    return nowMs - t <= WINDOW_MS;
  });
}

function hits(
  items: Array<{ title: string }>,
  re: RegExp,
): string[] {
  return items.filter((i) => re.test(i.title)).map((i) => i.title);
}

function signal(
  id: EastAfricaSignalId,
  titles: string[],
  quiet: string,
  warm: string,
  hot: string,
): EastAfricaSignal {
  const status: EastAfricaSignal["status"] =
    titles.length >= 2 ? "hot" : titles.length >= 1 ? "warm" : "quiet";
  return {
    id,
    lit: status !== "quiet",
    status,
    read: status === "hot" ? hot : status === "warm" ? warm : quiet,
    evidence: titles.slice(0, 4),
  };
}

export function classifyEastAfricaCape(
  items: Array<{ title: string; link?: string; pubDate?: string | null }>,
  nowMs = Date.now(),
): Pick<EastAfricaCapeState, "regime" | "read" | "signals"> {
  const pool = fresh(items, nowMs);
  const signals: EastAfricaSignal[] = [
    signal(
      "maritime_claim",
      hits(pool, MARITIME_CLAIM_RE),
      "No fresh al-Shabaab maritime-capability headlines.",
      "al-Shabaab maritime / anti-ship chatter — prep-phase watch, not Cape-closed.",
      "Repeated al-Shabaab maritime/anti-ship claims — corroborate; still not High-go.",
    ),
    signal(
      "houthi_transfer",
      hits(pool, HOUTHI_TRANSFER_RE),
      "No fresh Houthi↔al-Shabaab transfer/training headlines.",
      "Houthi–al-Shabaab weapons/training chatter — proxy-path watch.",
      "Repeated Houthi–al-Shabaab transfer headlines — coordination watch, not a strike print.",
    ),
    signal(
      "puntland_base",
      hits(pool, PUNTLAND_BASE_RE),
      "No fresh Bosaso / Puntland / AFRICOM base headlines.",
      "US/AFRICOM–Puntland/Bosaso footprint chatter — casus-belli overlay, not go.",
      "Repeated Puntland/Bosaso US-base headlines — overlay only; do not upgrade High-go.",
    ),
    signal(
      "somali_vlcc",
      hits(pool, SOMALI_VLCC_RE),
      "No fresh VLCC/tanker-attack headlines off Somalia.",
      "Tanker/VLCC threat off Somalia in sample — Layer-3 AIS eyeball; not Cape-closed.",
      "Repeated Somali-basin tanker/VLCC attack headlines — underwriter-path HOT; still not Israel High-go.",
    ),
    signal(
      "joint_statement",
      hits(pool, JOINT_STATEMENT_RE),
      "No Houthi–al-Shabaab joint-statement headlines.",
      "Houthi–al-Shabaab joint/alliance language — coordination watch.",
      "Repeated joint Houthi–al-Shabaab statements — operational-planning watch, not go.",
    ),
  ];

  const maritime = signals.find((s) => s.id === "maritime_claim")!;
  const transfer = signals.find((s) => s.id === "houthi_transfer")!;
  const puntland = signals.find((s) => s.id === "puntland_base")!;
  const vlcc = signals.find((s) => s.id === "somali_vlcc")!;
  const joint = signals.find((s) => s.id === "joint_statement")!;
  const litCount = signals.filter((s) => s.lit).length;

  let regime: EastAfricaCapeState["regime"] = "quiet";
  if (vlcc.status === "hot" || (joint.lit && maritime.lit)) regime = "hot";
  else if (
    litCount >= 2 ||
    (maritime.lit && (transfer.lit || puntland.lit))
  )
    regime = "forming";
  else if (litCount >= 1) regime = "watch";

  const read =
    regime === "hot"
      ? `East Africa Cape-route watch HOT — ${vlcc.lit ? "Somali-basin tanker headlines" : "joint + maritime claims"}. Underwriter-path thesis (war-risk may reprice East Africa/Cape route). Not Israel High-go. Not automatic Cape-closed.`
      : regime === "forming"
        ? `East Africa axis forming (${litCount} signals) — Houthi/Shabaab/Puntland cluster. Freight watch; do not treat as Cape-closed or Israel go.`
        : regime === "watch"
          ? `East Africa watch (${signals.filter((s) => s.lit).map((s) => s.id).join(", ")}). Soft freight overlay only.`
          : "No fresh East Africa / al-Shabaab maritime cluster in free RSS (72h). Cape remains a diversion watch via 9d, not a closed artery.";

  return { regime, read, signals };
}

export function emptyEastAfricaCape(error?: string): EastAfricaCapeState {
  const classified = classifyEastAfricaCape([]);
  return {
    thesis:
      "Bab el-Mandeb is the northern choke; a Somali-coast anti-ship hit can reprice the Cape *route* via war-risk. Iran/Houthi/al-Shabaab is a deniable proxy path. Watch, don't invent closure.",
    ...classified,
    regime: error ? "unknown" : classified.regime,
    read: error
      ? `East Africa RSS failed — ${error}. Open Google / TankerMap Somali basin manually.`
      : classified.read,
    items: [],
    links: EAST_AFRICA_LINKS,
    rules: EAST_AFRICA_RULES,
  };
}

export function buildEastAfricaCapeState(
  items: Array<{ title: string; link: string; pubDate: string }>,
  nowMs = Date.now(),
): EastAfricaCapeState {
  const classified = classifyEastAfricaCape(items, nowMs);
  return {
    thesis:
      "Bab el-Mandeb is the northern choke; a Somali-coast anti-ship hit can reprice the Cape *route* via war-risk. Iran/Houthi/al-Shabaab is a deniable proxy path. Watch, don't invent closure.",
    ...classified,
    items: items.slice(0, 12),
    links: EAST_AFRICA_LINKS,
    rules: EAST_AFRICA_RULES,
  };
}
