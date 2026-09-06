export type StockQuote = {
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  bid: number | null;
  ask: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  volume: number | null;
  marketCap: number | null;
  currency: string | null;
  shortName: string | null;
  marketState: string | null;
  /** Extended-hours (pre/post) last when available. */
  extendedPrice: number | null;
  extendedChange: number | null;
  extendedChangePercent: number | null;
  extendedSession: "pre" | "post" | null;
  extendedAsOf: string | null;
  source: string;
  fetchedAt: string;
};

export type OptionContract = {
  contractSymbol: string;
  strike: number;
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  change: number | null;
  percentChange: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
  inTheMoney: boolean | null;
  type: "call" | "put";
};

export type OptionsChain = {
  symbol: string;
  underlyingPrice: number | null;
  expirationDates: string[];
  selectedExpiry: string | null;
  calls: OptionContract[];
  puts: OptionContract[];
  source: string;
  fetchedAt: string;
};

export type OptionsChainSlice = {
  expiry: string;
  calls: OptionContract[];
  puts: OptionContract[];
  source: string;
  fetchedAt: string;
  error?: string;
};

export type OptionsChainsAll = {
  symbol: string;
  underlyingPrice: number | null;
  expirationDates: string[];
  chains: OptionsChainSlice[];
  fetchedAt: string;
  primarySource: string;
  feedSources: string[];
};

export type PositionRow = {
  symbolDescription: string;
  symbol: string;
  quantity: number;
  pricePaid: number | null;
  marketValue: number | null;
  totalCost: number | null;
  totalGain: number | null;
  totalGainPct: number | null;
  daysGain: number | null;
  daysGainPct: number | null;
  typeCode: string | null;
  /** E*TRADE vs external (Robinhood, etc.). */
  broker?: string | null;
  brokerTag?: string | null;
  externalId?: string | null;
  mark?: number | null;
  bid?: number | null;
  ask?: number | null;
  expiry?: string | null;
  strike?: number | null;
  callPut?: "call" | "put" | null;
};

export type ExternalPosition = {
  id: string;
  broker: string;
  symbol: string;
  expiry: string;
  strike: number;
  callPut: "call" | "put";
  quantity: number;
  avgCost: number;
  boughtAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExternalPositionsBook = {
  positions: ExternalPosition[];
  marked: PositionRow[];
  totals: {
    marketValue: number;
    totalCost: number;
    totalGain: number;
    daysGain: number;
  };
  storePath: string;
  fetchedAt: string;
};

export type EtradeAccount = {
  accountIdKey: string;
  accountId?: string;
  accountName?: string;
  accountDesc?: string;
  accountMode?: string;
  accountStatus?: string;
  accountType?: string;
};

export type PortfolioSection = {
  accountIdKey: string;
  accountId?: string | null;
  accountDesc?: string | null;
  accountType?: string | null;
  accountMode?: string | null;
  positions: PositionRow[];
  totals: {
    marketValue: number;
    totalCost: number;
    totalGain: number;
    daysGain: number;
  };
  stale?: boolean;
  warnings?: string[];
};

export type Portfolio = {
  accountIdKey: string;
  accountId?: string | null;
  accountDesc?: string | null;
  accountType?: string | null;
  accountMode?: string | null;
  positions: PositionRow[];
  /** Present for the combined full-portfolio view — one block per included account. */
  sections?: PortfolioSection[];
  totals: {
    marketValue: number;
    totalCost: number;
    totalGain: number;
    daysGain: number;
  };
  /** Selected-account E*TRADE positions only (Robinhood is a separate account). */
  etradeTotals?: {
    marketValue: number;
    totalCost: number;
    totalGain: number;
    daysGain: number;
  };
  /** Present when viewing Robinhood; otherwise unused (RH no longer merged into ET). */
  externalTotals?: {
    marketValue: number;
    totalCost: number;
    totalGain: number;
    daysGain: number;
  };
  /** Count of Robinhood rows when viewing the Robinhood account. */
  externalCount?: number;
  /** Server clock when this portfolio payload was built. */
  fetchedAt?: string;
  stale?: boolean;
  cachedAt?: string | null;
  warnings?: string[];
};

export type TermPoint = {
  expiry: string;
  dte: number;
  atmIv: number | null;
  callIv: number | null;
  putIv: number | null;
};

export type SmilePoint = {
  strike: number;
  callIv: number | null;
  putIv: number | null;
  moneyness: number | null;
};

export type VolatilityReport = {
  symbol: string;
  spot: number | null;
  selectedExpiry: string | null;
  dte: number | null;
  atmIv: number | null;
  atmCallIv: number | null;
  atmPutIv: number | null;
  atmStrike: number | null;
  skew: number | null;
  skewNote: string;
  hv20: number | null;
  hv30: number | null;
  ivMinusHv20: number | null;
  ivRank: number | null;
  ivPercentile: number | null;
  snapshotCount: number;
  snapshotDays: number;
  positionFocus: {
    strike: number;
    type: "call" | "put";
    expiry: string | null;
    iv: number | null;
    moneyness: number | null;
    contractSymbol: string | null;
  } | null;
  termStructure: TermPoint[];
  smile: SmilePoint[];
  fetchedAt: string;
};

export type PhysicalMarkets = {
  brent: {
    eiaEuropeBrentSpot: {
      price: number | null;
      asOf: string | null;
      source: string;
      note: string;
    };
    brentFutures: StockQuote | null;
    spotMinusFutures: number | null;
    wtiFutures: StockQuote | null;
  };
  vlccTd3c: {
    worldscale: number | null;
    tceUsdPerDay: number | null;
    asOfLabel: string | null;
    asOfIso?: string | null;
    lagHours?: number | null;
    lagDays?: number | null;
    sourceUrl: string | null;
    sourceTitle: string | null;
    excerpt: string | null;
    route: string;
    note: string;
    relatedRoutes?: Array<{
      code: string;
      label: string;
      worldscale: number | null;
      tceUsdPerDay: number | null;
      excerpt: string | null;
    }>;
    periodCharter?: {
      oneYearUsdPerDay: number | null;
      threeYearUsdPerDay: number | null;
      excerpt: string | null;
      note: string;
    } | null;
    deepLinks?: Array<{ label: string; href: string; note?: string }>;
    discoveryMethod?: string | null;
    candidatesTried?: number;
    honestyGaps?: string[];
  };
  fetchedAt: string;
  caveats: string[];
  fromCache?: boolean;
  stale?: boolean;
  error?: string | null;
};

export type DecisionFootprint = {
  score: number;
  band:
    | "diplomacy_alive"
    | "talks_deteriorating"
    | "decision_being_made"
    | "execution_prep"
    | "imminent";
  statusLabel: string;
  decisionMade: boolean;
  diplomaticLit: number;
  executionLit: number;
  marketLit: number;
  signals: Array<{
    id: string;
    tier: 1 | 2 | 3;
    label: string;
    lit: boolean;
    weight: number;
    points: number;
    detail: string;
    at: string | null;
    source: string;
  }>;
  verdict: string;
  nextTriggers: string[];
  gaps: string[];
  rulesSummary: string[];
  capped: boolean;
  capReason: string | null;
  asOf: string;
  inputs: {
    theaterAt: string | null;
    dealAt: string | null;
    intelAt: string | null;
  };
  stale?: boolean;
  fromCache?: boolean;
  servedAgeMs?: number;
  rebuilding?: boolean;
  degradedReason?: string | null;
};

export type FroCatalystStatus =
  | "hot"
  | "warm"
  | "quiet"
  | "unknown"
  | "bearish";

export type FroCatalystRegime =
  | "stall"
  | "forming"
  | "physical_confirm"
  | "catastrophe"
  | "deal_crush";

export type FroPhysicalGap =
  | "confirmed"
  | "lagging"
  | "diverging"
  | "unknown";

export type FroBookAction = "hold" | "trim" | "watch" | "add";

export type FroCatalystReport = {
  asOf: string;
  regime: FroCatalystRegime;
  regimeLabel: string;
  verdict: string;
  bookAction: FroBookAction;
  bookSummary: string;
  physicalGap: FroPhysicalGap;
  physicalGapRead: string;
  catalysts: Array<{
    id: string;
    label: string;
    status: FroCatalystStatus;
    read: string;
    metric: string | null;
    bookHint: FroBookAction;
    source: string;
    lit: boolean;
    priority: number;
  }>;
  watchNext: string[];
  actionMap: Array<{ trigger: string; action: string }>;
  gaps: string[];
  inputs: {
    hormuzDate: string | null;
    hormuzTotal: number | null;
    hormuzTanker: number | null;
    /** Calendar lag of PortWatch Hormuz print — optional on older payloads. */
    hormuzLagDays?: number | null;
    td3cWs: number | null;
    td3cLagDays: number | null;
    bdti5dPct: number | null;
    dealLevel: string | null;
    ceasefireYesPct: number | null;
    froLotteryEdgePp: number | null;
    portwatchLagNote: string;
    bdtiDate?: string | null;
    bdtiLagDays?: number | null;
    td3cAsOf?: string | null;
    ttFlowMbpd?: number | null;
    ttFlowHormuzMbpd?: number | null;
    ttFlowDate?: string | null;
    ttFlowLagDays?: number | null;
    ttFlowWindow?: string | null;
    td34Ws?: number | null;
    td34Tce?: number | null;
  };
  stale?: boolean;
  fromCache?: boolean;
  servedAgeMs?: number;
  rebuilding?: boolean;
  degradedReason?: string | null;
};

export type MarketSurprise = {
  theses: Array<{
    id: string;
    label: string;
    question: string;
    realityPct: number | null;
    marketPct: number | null;
    edgePp: number | null;
    confidence: "low" | "med" | "high";
    verdictKind: "market_underprices" | "aligned" | "market_ahead" | "unknown";
    verdict: string;
    contributions: Array<{
      id: string;
      side: "reality" | "market";
      label: string;
      delta: number;
      lit: boolean;
      detail: string;
      source: string;
    }>;
    gaps: string[];
    marketSource: string | null;
    realitySource: string;
  }>;
  asOf: string;
  notes: string[];
  rulesSummary: string[];
  inputs: {
    theaterAt: string | null;
    dealAt: string | null;
    intelAt: string | null;
    footprintScore: number | null;
  };
  stale?: boolean;
  fromCache?: boolean;
  servedAgeMs?: number;
  rebuilding?: boolean;
  degradedReason?: string | null;
};

/** Israel Strike Pre-Launch Tells (DeepSeek AER/NAV/ELEC/DIP/POL + EXEC Shekel lagging confirmation). */
export type IsraelStrikeTellStatus =
  | "hot"
  | "warm"
  | "quiet"
  | "unknown"
  | "manual";

export type IsraelStrikeScenario =
  | "high_confidence_go"
  | "medium_confidence"
  | "false_flag"
  | "silence_only"
  | "quiet"
  | "unknown";

export type AerialFeedStatus = "ok" | "failed" | "dark" | "degraded";

export type Nav01Posture =
  | "not_set"
  | "loitering_cyprus"
  | "quiet"
  | "ais_dark_suspected";

export type IsraelStrikeManualState = {
  version: 1;
  nav01: {
    posture: Nav01Posture;
    note: string;
    navyCount: number | null;
    navyThreshold: number;
    updatedAt: string | null;
  };
};

/** Named Mideast kinetic pin — approx, not official geometry. Not an AER-01 gate. */
export type MideastTargetRole = "kinetic" | "context" | "corridor" | "support";
export type MideastTargetCountry =
  | "syria"
  | "lebanon"
  | "iraq"
  | "iran"
  | "israel"
  | "jordan"
  | "gulf"
  | "yemen";

export type MideastTarget = {
  id: string;
  label: string;
  country: MideastTargetCountry;
  role: MideastTargetRole;
  lat: number;
  lon: number;
  radiusKm: number;
  aliases: string[];
  note: string;
};

export type KineticActor = "israel" | "us" | "iran" | "unknown";

export type KineticClassification = {
  title: string;
  pubDate: string | null;
  link: string | null;
  confirmed: boolean;
  conjecture: boolean;
  targets: MideastTarget[];
  actor: KineticActor | null;
};

export type KineticRewindHit = {
  assetKey: string;
  kind: string;
  label: string | null;
  lat: number;
  lon: number;
  ts: string;
  distKm: number;
  trackDeg: number | null;
  gsKt: number | null;
  altFt: number | null;
  corridorTell: boolean;
  source: string | null;
};

export type KineticStamp = {
  targetId: string;
  targetLabel: string;
  eventAt: string;
  confirmedByNews: true;
  headline: string;
  note: string;
  stampedAt: string;
  source: "manual" | "auto";
  link: string | null;
};

export type KineticRewindReport = {
  asOf: string;
  honesty: string;
  notHighGo: true;
  aer01Untouched: true;
  event: {
    target: MideastTarget;
    eventAt: string | null;
    timeKnown: boolean;
    headline: string | null;
    link: string | null;
    actor: KineticActor | null;
    source: "news" | "manual" | "query";
    confirmedByNews: boolean;
  } | null;
  window: { from: string; to: string };
  hits: KineticRewindHit[];
  corridorTells: KineticRewindHit[];
  archiveOk: boolean;
  classified: KineticClassification[];
  stamps: KineticStamp[];
  targets: MideastTarget[];
  read: string;
};

export type CyprusAisCategory = "military" | "tanker" | "interest" | "other";

export type CyprusAisVessel = {
  mmsi: string;
  name: string;
  shipType: number | null;
  shipTypeLabel: string;
  category: CyprusAisCategory;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  updatedAt: string;
};

export type CyprusAisSnapshot = {
  enabled: boolean;
  status: "disabled" | "connecting" | "live" | "stale" | "error" | "empty";
  source: "aisstream";
  error: string | null;
  asOf: string | null;
  messageCount: number;
  totalInBox: number;
  militaryCount: number;
  tankerCount: number;
  interestCount: number;
  navyLikeCount: number;
  vessels: CyprusAisVessel[];
  bbox: {
    latMin: number;
    latMax: number;
    lonMin: number;
    lonMax: number;
  };
  note: string;
  /** Seconds waiting while connecting / empty-grace (UI honesty). */
  statusAgeSec?: number | null;
};

export type IsraelStrikeTell = {
  id: string;
  category:
    | "AER"
    | "NAV"
    | "ELEC"
    | "DIP"
    | "POL"
    | "GO"
    | "EXEC"
    | "PIKUD"
    | "CYBER"
    | "FIRMS"
    | "STRAT";
  label: string;
  lookFor: string;
  sourceHint: string;
  nominalConfidence: number;
  weight: number;
  status: IsraelStrikeTellStatus;
  lit: boolean;
  points: number;
  read: string;
  evidence: string[];
  links: Array<{ label: string; href: string }>;
  layer: "auto" | "manual";
};

export type IsraelStrikeTells = {
  thesis: string;
  oneLiner: string;
  asOf: string;
  score: number;
  scenario: IsraelStrikeScenario;
  statusLabel: string;
  froGuidance: string;
  autoTrade: false;
  physicalLit: number;
  diplomaticLit: number;
  electronicLit: number;
  politicalLit: number;
  executionLit: number;
  tells: IsraelStrikeTell[];
  gaps: string[];
  nextTriggers: string[];
  rulesSummary: string[];
  inputs: {
    shekelPrice: number | null;
    shekelChangePct: number | null;
    aerialTankersLevant: number | null;
    aerialAwacsLevant: number | null;
    aerialFeedOk: boolean;
    aerialFeedStatus: AerialFeedStatus;
    aerialSampleAgeSec: number | null;
    aerialSampledAt: string | null;
    aerialFromCache: boolean;
    aerialSamples: string[];
    aerialTracks?: Array<{
      hex: string;
      callsign: string;
      kind: "tanker" | "awacs" | "mil";
      acType: string;
      desc?: string;
      lat: number;
      lon: number;
      trackDeg: number | null;
      gsKt: number | null;
      altFt: number | null;
      bearingHint: string;
      trail: Array<{ lat: number; lon: number; at: string }>;
      source?: "adsb.lol" | "opensky";
      inBox?: boolean;
      followed?: boolean;
      followRegion?: string;
      enrolledAt?: string;
      displayState?: "live" | "dark" | "landed" | "followed";
      darkReason?: "descent_rtb" | "emcon_orbit" | "unknown";
      stateDetail?: string;
    }>;
    aerialLastGoodTracks?: Array<{
      hex: string;
      callsign: string;
      kind: "tanker" | "awacs" | "mil";
      acType: string;
      desc?: string;
      lat: number;
      lon: number;
      trackDeg: number | null;
      gsKt: number | null;
      altFt: number | null;
      bearingHint: string;
      trail: Array<{ lat: number; lon: number; at: string }>;
      source?: "adsb.lol" | "opensky";
      inBox?: boolean;
      followed?: boolean;
      followRegion?: string;
      enrolledAt?: string;
      displayState?: "live" | "dark" | "landed" | "followed";
      darkReason?: "descent_rtb" | "emcon_orbit" | "unknown";
      stateDetail?: string;
      ageSec: number;
      lastSeenAt: string;
      stale: true;
    }>;
    mapOverlays?: {
      zones: Array<{
        id: string;
        kind: "notam" | "adsb_box" | "cyprus_ais" | "dip_border" | "nav_watch";
        label: string;
        status: "quiet" | "warm" | "hot" | "unknown" | "info" | "failed";
        latMin: number;
        latMax: number;
        lonMin: number;
        lonMax: number;
        titles?: string[];
      }>;
      points: Array<{
        id: string;
        kind: "ais_vessel";
        label: string;
        category: string;
        lat: number;
        lon: number;
        sog: number | null;
        cog: number | null;
      }>;
      notamStatus: "quiet" | "warm" | "hot";
      notamTitles: string[];
      firmsPoints?: Array<{
        id: string;
        lat: number;
        lon: number;
        box: "hormuz" | "bab" | "israel" | "gaza" | "golan" | "other";
        frp: number | null;
        acqDate: string | null;
        label: string;
      }>;
      firmsNote?: string;
    };
    aerialOtherMil: number | null;
    aerialBoxesOk: string[];
    aerialBoxesFailed: string[];
    aerialError: string | null;
    /** In-memory max tankers/AWACS since process start — awareness only, not a go gate. */
    aerialSessionPeak?: {
      tankers: number;
      awacs: number;
      at: string;
    } | null;
    /** Recent asset state transitions (minute-level). */
    aerialEvents?: Array<{
      id: string;
      at: string;
      hex: string;
      callsign: string;
      kind: "tanker" | "awacs" | "mil";
      acType: string;
      from: "live" | "dark" | "landed" | "followed" | null;
      to: "live" | "dark" | "landed" | "followed";
      detail: string;
      darkReason?: "descent_rtb" | "emcon_orbit" | "unknown";
      ageSec?: number;
    }>;
    aer01Churn?: {
      summary: string;
      live: number;
      dark: number;
      landed: number;
      followed: number;
      prevLive: number | null;
      lastChangeAt: string | null;
    } | null;
    ironsightOnline: boolean;
    intelAt: string | null;
    nav01Posture: Nav01Posture;
    nav01Note: string;
    nav01UpdatedAt: string | null;
    nav01NavyCount: number | null;
    nav01NavyThreshold: number;
    cyprusAis: CyprusAisSnapshot;
    softArms?: Array<{
      id: string;
      lit: boolean;
      status: string;
      read: string;
      evidence: string[];
    }>;
    goLanguageStatus?: "quiet" | "warm" | "hot";
    goLanguageHits?: string[];
  };
  manual: IsraelStrikeManualState;
  stale?: boolean;
  fromCache?: boolean;
  servedAgeMs?: number;
  rebuilding?: boolean;
  degradedReason?: string | null;
};

export type TheaterWatch = {
  fetchedAt: string;
  ais: {
    note: string;
    links: Array<{ label: string; href: string }>;
    readAnchored: string;
    readCapeDiversion: string;
  };
  brentCurve: {
    near: { symbol: string; label: string; price: number | null };
    far: { symbol: string; label: string; price: number | null };
    spread: number | null;
    regime: string;
    read: string;
    source: string;
  };
  wtiCurve: {
    near: {
      symbol: string;
      label: string;
      price: number | null;
      changePct: number | null;
    };
    far: {
      symbol: string;
      label: string;
      price: number | null;
      changePct: number | null;
    };
    spread: number | null;
    regime: string;
    read: string;
    source: string;
  };
  bdti: {
    latest: { date: string; value: number } | null;
    prev: { date: string; value: number } | null;
    changePct1d: number | null;
    changePct5d: number | null;
    risingVsOil: boolean | null;
    read: string;
    sourceUrl: string;
  };
  peers: {
    fro: {
      symbol: string;
      label: string;
      price: number | null;
      changePct: number | null;
    } | null;
    rows: Array<{
      symbol: string;
      label: string;
      price: number | null;
      changePct: number | null;
    }>;
    regime: string;
    read: string;
  };
  polymarket: {
    ceasefire: {
      question: string;
      yesPct: number | null;
      oneDayChange: number | null;
      volume24hr: number | null;
      slug: string | null;
    } | null;
    hormuz: {
      question: string;
      yesPct: number | null;
      oneDayChange: number | null;
      volume24hr: number | null;
      slug: string | null;
    } | null;
    top: Array<{
      question: string;
      yesPct: number | null;
      oneDayChange: number | null;
      volume24hr: number | null;
      slug: string | null;
    }>;
    read: string;
    source: string;
    error?: string;
  };
  insiders: {
    rows: Array<{
      date: string | null;
      insider: string | null;
      title: string | null;
      tradeType: string | null;
      price: string | null;
      qty: string | null;
      value: string | null;
    }>;
    read: string;
    sourceUrl: string;
    error?: string;
  };
  aerial: {
    tankerCount: number;
    awacsCount: number;
    otherMilCount: number;
    regime: string;
    read: string;
    samples: Array<{
      callsign: string;
      type: string;
      aircraftType: string;
      lat: number;
      lon: number;
      altitude: number;
      hex?: string;
      boxId?: string;
      region?: "gulf" | "red_sea_horn" | "iraq_bridge" | "wider";
      stale?: boolean;
      ageSec?: number;
      lastSeenAt?: string;
      followed?: boolean;
    }>;
    source: string;
    boxesOk?: string[];
    boxesFailed?: string[];
    /** Live plotted tracks per ADS-B sample box (watch tile labels). */
    boxTrackCounts?: Record<string, number>;
    widerTheater?: {
      tankerCount: number;
      awacsCount: number;
      otherMilCount: number;
      boxesOk: string[];
      boxesFailed: string[];
      read: string;
    };
    error?: string;
  };
  focus46c: {
    expiry: string;
    strike: number;
    bid: number | null;
    ask: number | null;
    last: number | null;
    volume: number | null;
    openInterest: number | null;
    iv: number | null;
    width: number | null;
    froPrice: number | null;
    oilProxy: number | null;
    regime: string;
    read: string;
    source: string | null;
  };
  warRiskInsurance: {
    query: string;
    items: Array<{ title: string; link: string; pubDate: string }>;
    spikeHints: string[];
    regime: string;
    read: string;
    searchUrl: string;
    source: string;
    error?: string;
  };
  stateMedia: {
    queries: string[];
    items: Array<{
      source: string;
      title: string;
      link: string;
      pubDate: string;
    }>;
    feeDisputeHits: string[];
    dealHits: string[];
    /** US/CENTCOM Hormuz-island kinetic (e.g. Larak) — optional on older payloads. */
    kineticHits?: string[];
    regime: string;
    read: string;
    links: Array<{ label: string; href: string }>;
    source: string;
    error?: string;
  };
  productCurves: {
    heatingOil: {
      root: string;
      label: string;
      near: {
        symbol: string;
        label: string;
        price: number | null;
        changePct: number | null;
      };
      far: {
        symbol: string;
        label: string;
        price: number | null;
        changePct: number | null;
      };
      spread: number | null;
      spreadChangePctApprox: number | null;
      regime: string;
      read: string;
    };
    gasoline: {
      root: string;
      label: string;
      near: {
        symbol: string;
        label: string;
        price: number | null;
        changePct: number | null;
      };
      far: {
        symbol: string;
        label: string;
        price: number | null;
        changePct: number | null;
      };
      spread: number | null;
      spreadChangePctApprox: number | null;
      regime: string;
      read: string;
    };
    regime: string;
    read: string;
    source: string;
  };
  /** Weekend Kharg / amphibious Pickaxe — 4 free OSINT signals. */
  khargPickaxe: {
    thesis: string;
    fetchedAt: string;
    amphibious: {
      context: string;
      decisionTable: Array<{
        ship: string;
        check: string;
        bullishKharg: string;
        bearishDelay: string;
      }>;
      vessels: Array<{
        key: "bataan" | "boxer" | "newYork";
        name: string;
        hull: string;
        role: string;
        mmsiHint: string | null;
        links: Array<{ label: string; href: string }>;
        ironsight: {
          name: string;
          hull: string;
          lat: number;
          lon: number;
          status: string;
          region: string;
          lastReported: string | null;
          sogKt?: number | null;
          courseDeg?: number | null;
          headingDeg?: number | null;
          destination?: string | null;
          stale?: boolean;
          ageSec?: number;
          lastSeenAt?: string;
        } | null;
      }>;
      readOptionA: string;
      readOptionB: string;
      note: string;
      source: string;
      error?: string;
    };
    e6b: {
      airborneCount: number;
      samples: Array<{
        callsign: string;
        aircraftType: string;
        lat: number;
        lon: number;
        altitude: number;
        gs: number | null;
        hex?: string;
        stale?: boolean;
        ageSec?: number;
        lastSeenAt?: string;
      }>;
      regime: string;
      read: string;
      source: string;
      error?: string;
    };
    irgcBoats: {
      items: Array<{
        source: string;
        title: string;
        link: string;
        pubDate: string;
      }>;
      telegramLinks: Array<{ label: string; href: string }>;
      keywordHits: {
        dispersing: string[];
        massingOman: string[];
        reinforcingKharg: string[];
      };
      regime: string;
      read: string;
      source: string;
      error?: string;
    };
    vlccCape: {
      links: Array<{ label: string; href: string }>;
      items: Array<{ title: string; link: string; pubDate: string }>;
      diversionHints: string[];
      regime: string;
      read: string;
      readOptionA: string;
      readOptionB: string;
      source: string;
      error?: string;
    };
  };
  /** Somali-basin / al-Shabaab Cape-route freight watch — never Israel High-go. */
  eastAfricaCape: {
    thesis: string;
    regime: string;
    read: string;
    signals: Array<{
      id: string;
      lit: boolean;
      status: string;
      read: string;
      evidence: string[];
    }>;
    items: Array<{ title: string; link: string; pubDate: string }>;
    links: Array<{ label: string; href: string }>;
    rules: string[];
  };
  /**
   * Ghost footprints before Bataan AIS — air / SSGN / UNREP / canary / IRGC / NAVWARN.
   */
  bataanGhost: {
    thesis: string;
    oneLiner: string;
    fetchedAt: string;
    formationScore: number;
    formationMax: number;
    formationRegime: string;
    read: string;
    signs: Array<{
      id: string;
      label: string;
      lookFor: string;
      sourceHint: string;
      status: string;
      read: string;
      evidence: string[];
      links: Array<{ label: string; href: string }>;
    }>;
  };
  /** Iran / Gulf / Hormuz map overlays — approx FIR boxes + SSGN/CSG when coords. */
  mapOverlays: {
    zones: Array<{
      id: string;
      kind: "notam" | "adsb_box" | "nav_watch" | "ais_box";
      label: string;
      status: "quiet" | "warm" | "hot" | "unknown" | "info" | "failed";
      latMin: number;
      latMax: number;
      lonMin: number;
      lonMax: number;
      titles?: string[];
    }>;
    stamps: Array<{
      id: string;
      kind: "arg" | "ssgn" | "csg" | "naval";
      label: string;
      lat: number;
      lon: number;
      status: string;
      region: string;
      meta?: string;
      lastReported?: string | null;
      sogKt?: number | null;
      courseDeg?: number | null;
      destination?: string | null;
      stale?: boolean;
      ageSec?: number;
      lastSeenAt?: string;
    }>;
    aisPoints?: Array<{
      id: string;
      kind: "ais_vessel";
      label: string;
      category: string;
      lat: number;
      lon: number;
      sog: number | null;
      cog: number | null;
      boxId?: string;
    }>;
    radioHoleStatus: string;
    navwarnStatus: string;
  };
  /** Bibi Spoiler — Rome talks / USD-ILS / IDF Lebanon-border OSINT. */
  bibiSpoiler: {
    thesis: string;
    scenarios: {
      romeTrap: string;
      nuclearBreakout: string;
    };
    tradeImplication: string;
    fetchedAt: string;
    romeTalks: {
      queries: string[];
      items: Array<{
        source: string;
        title: string;
        link: string;
        pubDate: string;
      }>;
      keywordHits: {
        walkout: string[];
        disarmamentPrecondition: string[];
        talksOngoing: string[];
        concluded?: string[];
        calendarGap?: string[];
      };
      regime: string;
      read: string;
      links: Array<{ label: string; href: string }>;
      source: string;
      error?: string;
    };
    shekel: {
      symbol: string;
      price: number | null;
      changePct: number | null;
      threshold: number;
      regime: string;
      read: string;
      source: string;
      error?: string;
    };
    idfGround: {
      items: Array<{
        source: string;
        title: string;
        link: string;
        pubDate: string;
      }>;
      keywordHits: {
        lebaneseBorder: string[];
        gazaFocus: string[];
      };
      regime: string;
      read: string;
      links: Array<{ label: string; href: string }>;
      ironsightOnline: boolean;
      source: string;
      error?: string;
    };
  };
  /** Domestic politics event horizon — judgment overlay, not a fire rule. */
  politicsCalendar?: {
    asOf: string;
    headline: string | null;
    upcoming: Array<{
      id: string;
      label: string;
      date: string;
      kind: string;
      note: string;
      daysUntil: number;
      urgency: "today" | "soon" | "ahead";
    }>;
  };
  /** Attached by /api/theater-watch — primary scored decision aid. */
  decisionFootprint?: DecisionFootprint;
  marketSurprise?: MarketSurprise;
  stale?: boolean;
  fromCache?: boolean;
  servedAgeMs?: number;
  rebuilding?: boolean;
  degradedReason?: string | null;
};

export type EtradeStatus = {
  configured: boolean;
  authorized: boolean;
  env: string;
  authorizedAt: string | null;
  apiBase: string;
};

export type TradingStatus = {
  enabled: boolean;
  previewTtlSeconds: number;
  defaults: {
    symbol: string;
    strike: number;
    expiry: string;
    callPut: "CALL";
    orderAction: "BUY_OPEN";
    quantity: number;
    priceType: "LIMIT";
    orderTerm: string;
    marketSession: string;
  };
};

export type OrderPreview = {
  previewToken: string;
  confirmPhrase: string;
  summary: string;
  previewId: string;
  clientOrderId: string;
  accountIdKey: string;
  totalOrderValue: number | null;
  estimatedCommission: number | null;
  estimatedTotalAmount: number | null;
  symbolDescription: string | null;
  messages: Array<{ type: string; code: number | null; description: string }>;
  expiresAt: string;
  env: string;
};

export type OrderPlaceResult = {
  ok: true;
  orderId: string | null;
  orderType: string | null;
  symbolDescription: string | null;
  summary: string;
  accountIdKey: string;
};

export type BrokerOrder = {
  orderId: string;
  orderType: string | null;
  status: string;
  orderValue: number | null;
  placedTime: string | null;
  executedTime: string | null;
  priceType: string | null;
  limitPrice: number | null;
  stopPrice: number | null;
  stopLimitPrice: number | null;
  offsetValue: number | null;
  orderTerm: string | null;
  marketSession: string | null;
  allOrNone: boolean | null;
  symbol: string | null;
  symbolDescription: string | null;
  osiKey: string | null;
  orderAction: string | null;
  quantity: number | null;
  orderedQuantity: number | null;
  filledQuantity: number | null;
  cancelQuantity: number | null;
  averageExecutionPrice: number | null;
  callPut: string | null;
  strikePrice: number | null;
  expiry: string | null;
  estimatedCommission: number | null;
  estimatedTotalAmount: number | null;
  messages: Array<{ type: string; code: number | null; description: string }>;
  events: Array<{ name: string; dateTime: string | null }>;
};

export type OrdersList = {
  accountIdKey: string;
  orders: BrokerOrder[];
  fetchedAt: string;
};

export type HistoryStatus = {
  enabled: boolean;
  dbPath: string | null;
  error: string | null;
  stockRows: number;
  optionRows: number;
  macroRows: number;
  flowRows: number;
  lastWriteAt: string | null;
  nextWriteAt: string | null;
  lastWriteReason: string | null;
};

export type OsintArchiveStatus = {
  enabled: boolean;
  dbPath: string | null;
  error: string | null;
  assetRows: number;
  zoneRows: number;
  peakRows: number;
  oldestSampleAt: string | null;
  newestSampleAt: string | null;
  newestPeakAt: string | null;
  lastWriteAt: string | null;
  lastWriteReason: string | null;
  dbBytes: number | null;
  sampleRetentionDays: number;
  peakRetentionDays: number;
  bounds?: {
    latMin: number;
    latMax: number;
    lonMin: number;
    lonMax: number;
  };
};

export type OsintArchiveSample = {
  ts: string;
  assetKey: string;
  kind: string;
  lat: number;
  lon: number;
  altFt: number | null;
  gsKt: number | null;
  trackDeg: number | null;
  label: string | null;
  source: string | null;
  region: string | null;
  stale: boolean;
  payload: unknown | null;
};

export type OsintArchiveZone = {
  ts: string;
  zoneId: string;
  kind: string;
  label: string | null;
  status: string;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  payload: unknown | null;
};

export type OsintArchivePeak = {
  ts: string;
  tankers: number;
  awacs: number;
  otherMil: number;
  feedStatus: string | null;
  source: string | null;
};

export type OsintArchivePlaybackFrame = {
  at: string;
  from: string;
  to: string;
  samples: OsintArchiveSample[];
  zones: OsintArchiveZone[];
};

export type NewsReaderStage = "all" | "ingest" | "extract" | "summarize";

export type NewsReaderCounts = {
  pending: number;
  extracted: number;
  summarized: number;
  failed: number;
  total: number;
};

export type NewsReaderJob = {
  id: string;
  running: boolean;
  stage: NewsReaderStage;
  limit: number | null;
  summarizeLimit?: number | null;
  telegramMode: string;
  model: string | null;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  error: string | null;
  logTail: string;
  command: string[];
};

export type NewsReaderStatus = {
  ok: boolean;
  repoRoot: string;
  venvOk: boolean;
  pythonPath: string | null;
  dbPath: string | null;
  dbExists: boolean;
  counts: NewsReaderCounts;
  lastUpdatedAt: string | null;
  ollama: {
    up: boolean;
    host: string;
    model: string;
    models: string[];
    error: string | null;
  };
  job: NewsReaderJob | null;
  telethonConfigured: boolean;
};

export type NewsReaderRegionPack = {
  id: string;
  label: string;
  short: string;
  layers: string;
};

export type NewsReaderArticleSummary = {
  key_points: string[];
  primary_topic: string;
  sentiment: string;
  importance_score: number;
};

export type NewsReaderArticle = {
  id: number;
  url: string;
  title: string | null;
  source: string | null;
  source_type: string;
  channel_id: string | null;
  published_at: string | null;
  status: string;
  extraction_tier: string | null;
  error: string | null;
  updated_at: string;
  summary: NewsReaderArticleSummary | null;
};

declare global {
  interface Window {
    tradehole?: {
      getApiBase: () => Promise<string>;
      getRuntimeInfo?: () => Promise<{
        packaged: boolean;
        buildTime: string;
        version: string;
        mode: "dev" | "packaged";
      }>;
      loadTokens: () => Promise<{
        accessToken: string;
        accessTokenSecret: string;
      } | null>;
      saveTokens: (tokens: {
        accessToken: string;
        accessTokenSecret: string;
      }) => Promise<boolean>;
      clearTokens: () => Promise<boolean>;
      openExternal: (url: string) => Promise<void>;
      writeClipboard?: (text: string) => Promise<boolean>;
      alertOrderFill?: (urgent?: boolean) => Promise<void>;
    };
  }
}

export type TradeProposal = {
  id: string;
  asOf: string;
  book: "lottery";
  action: "hold" | "trim" | "watch" | "add" | "none";
  contract: {
    symbol: string;
    expiry: string;
    strike: number;
    callPut: "call" | "put";
  };
  quantity: number;
  orderAction: "BUY_OPEN" | "SELL_CLOSE" | null;
  accountHint: "etrade" | "robinhood" | "either";
  reasons: string[];
  invalidation: string;
  sources: Record<string, string | undefined>;
  gates: {
    ok: boolean;
    blockedBy: string[];
    spreadPct: number | null;
    width: number | null;
    inRth: boolean;
    debitToday: number;
  };
  conflict: boolean;
  status:
    | "open"
    | "accepted"
    | "rejected"
    | "snoozed"
    | "expired"
    | "accepted_manual";
  limitPriceHint: number | null;
};

export type TradeJournalSummary = {
  decisions: number;
  accepted: number;
  rejected: number;
  snoozed: number;
  acceptedManual: number;
  byAction: Record<string, number>;
  last7dDecisions: number;
  pnlSum: number | null;
  scalpReady: boolean;
};

export type TradeOrderDraft = {
  orderAction: "BUY_OPEN" | "SELL_CLOSE" | "BUY_CLOSE" | "SELL_OPEN";
  quantity: number;
  limitPrice: string;
  proposalId: string;
};

export {};
