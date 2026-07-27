import { getOptionsChain, getStockQuote, type OptionsChain } from "./market";
import { getPhysicalMarkets, type PhysicalMarkets } from "./physical";
import { getVolatilityReport, type VolatilityReport } from "./volatility";

const IRONSIGHT_BASE = process.env.IRONSIGHT_URL ?? "http://localhost:3170";

export type CrackSpreads = {
  gasolineCrackUsdPerBbl: number | null;
  heatingOilCrackUsdPerBbl: number | null;
  rbob: number | null;
  heatingOil: number | null;
  wti: number | null;
  note: string;
};

export type OptionsSmartMoney = {
  nearestExpiry: string | null;
  putCallVolumeRatio: number | null;
  putCallOiRatio: number | null;
  totalCallVolume: number;
  totalPutVolume: number;
  totalCallOi: number;
  totalPutOi: number;
  otmCallVolumeNearFocus: number;
  focusStrike: number;
  ivTermSlope: number | null;
  ivTermNote: string;
  unusualNotes: string[];
};

export type OsintPacket = {
  ironsightOnline: boolean;
  ships: unknown;
  flightsSample: unknown;
  polymarket: unknown;
  news: unknown;
  strikes: unknown;
  fires: unknown;
  telegramSample: unknown;
  regionalAlerts: unknown;
  targetedNews: Record<string, unknown>;
};

export type DecisionIntel = {
  generatedAt: string;
  physical: PhysicalMarkets;
  crackSpreads: CrackSpreads;
  optionsSmartMoney: OptionsSmartMoney;
  volatility: VolatilityReport;
  osint: OsintPacket;
  gaps: string[];
  decisionHints: string[];
};

async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await p };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function fetchNewsRss(query: string): Promise<{
  query: string;
  items: { title: string; link: string; pubDate: string }[];
}> {
  const url =
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { "User-Agent": "Tradehole/0.1" },
  });
  if (!res.ok) throw new Error(`RSS HTTP ${res.status}`);
  const xml = await res.text();
  const items: { title: string; link: string; pubDate: string }[] = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  for (const block of blocks.slice(0, 8)) {
    const title =
      block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ??
      block.match(/<title>(.*?)<\/title>/)?.[1] ??
      "";
    const link = block.match(/<link>(.*?)<\/link>/)?.[1] ?? "";
    const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? "";
    if (title) items.push({ title, link, pubDate });
  }
  return { query, items };
}

export async function getCrackSpreads(): Promise<CrackSpreads> {
  const [rb, ho, cl] = await Promise.all([
    getStockQuote("RB=F"),
    getStockQuote("HO=F"),
    getStockQuote("CL=F"),
  ]);
  const rbob = rb.price;
  const heatingOil = ho.price;
  const wti = cl.price;
  // Futures quoted $/gallon → *42 for $/bbl crack vs WTI
  const gasolineCrackUsdPerBbl =
    rbob != null && wti != null ? rbob * 42 - wti : null;
  const heatingOilCrackUsdPerBbl =
    heatingOil != null && wti != null ? heatingOil * 42 - wti : null;
  return {
    gasolineCrackUsdPerBbl,
    heatingOilCrackUsdPerBbl,
    rbob,
    heatingOil,
    wti,
    note:
      "Approx crack = product futures ($/gal)*42 − WTI ($/bbl). Rising cracks = refined-product scarcity (first domino).",
  };
}

function sumVol(rows: { volume: number | null }[]): number {
  return rows.reduce((a, r) => a + (r.volume ?? 0), 0);
}

function sumOi(rows: { openInterest: number | null }[]): number {
  return rows.reduce((a, r) => a + (r.openInterest ?? 0), 0);
}

export async function getOptionsSmartMoney(
  symbol = "FRO",
  focusStrike = 46,
): Promise<OptionsSmartMoney> {
  const chain = await getOptionsChain(symbol);
  const callVol = sumVol(chain.calls);
  const putVol = sumVol(chain.puts);
  const callOi = sumOi(chain.calls);
  const putOi = sumOi(chain.puts);

  const otmCallVolumeNearFocus = chain.calls
    .filter((c) => c.strike >= focusStrike - 1)
    .reduce((a, c) => a + (c.volume ?? 0), 0);

  // Term structure: nearest vs later ATM IV
  const expiries = chain.expirationDates.slice(0, 4);
  const atmIvs: number[] = [];
  for (const expiry of expiries) {
    try {
      const c: OptionsChain =
        expiry === chain.selectedExpiry
          ? chain
          : await getOptionsChain(symbol, expiry);
      const spot = c.underlyingPrice;
      if (spot == null) continue;
      const call = c.calls.reduce((best, row) =>
        Math.abs(row.strike - spot) < Math.abs(best.strike - spot) ? row : best,
      );
      if (call.impliedVolatility != null) atmIvs.push(call.impliedVolatility);
    } catch {
      /* skip */
    }
  }

  let ivTermSlope: number | null = null;
  let ivTermNote = "Need ≥2 expiries";
  if (atmIvs.length >= 2) {
    ivTermSlope = atmIvs[0] - atmIvs[atmIvs.length - 1];
    ivTermNote =
      ivTermSlope > 0.02
        ? "Near-term ATM IV ABOVE longer-dated — market pricing imminent crisis (backwardation in vol)."
        : ivTermSlope < -0.02
          ? "Near-term ATM IV BELOW longer-dated — calmer front, risk further out."
          : "Flat-ish IV term structure across nearby expiries.";
  }

  const unusualNotes: string[] = [];
  if (callVol > 0 && putVol / Math.max(1, callVol) < 0.5) {
    unusualNotes.push(
      `Put/Call volume ratio ${(putVol / callVol).toFixed(2)} — call-heavy tape on ${chain.selectedExpiry}.`,
    );
  }
  if (otmCallVolumeNearFocus >= 100) {
    unusualNotes.push(
      `Meaningful volume in ≥$${focusStrike} calls on ${chain.selectedExpiry}: ${otmCallVolumeNearFocus} contracts.`,
    );
  }
  // Check Sep focus expiry if present
  const sep = chain.expirationDates.find((d) => d.startsWith("2026-09"));
  if (sep) {
    try {
      const sepChain = await getOptionsChain(symbol, sep);
      const focus = sepChain.calls.find((c) => Math.abs(c.strike - focusStrike) < 0.01);
      if (focus) {
        unusualNotes.push(
          `Focus contract ${focus.contractSymbol}: vol=${focus.volume ?? 0}, OI=${focus.openInterest ?? 0}, IV=${
            focus.impliedVolatility != null
              ? `${(focus.impliedVolatility * 100).toFixed(1)}%`
              : "n/a"
          }, last=${focus.lastPrice ?? "n/a"}.`,
        );
      }
    } catch {
      /* ignore */
    }
  }

  return {
    nearestExpiry: chain.selectedExpiry,
    putCallVolumeRatio: callVol > 0 ? putVol / callVol : null,
    putCallOiRatio: callOi > 0 ? putOi / callOi : null,
    totalCallVolume: callVol,
    totalPutVolume: putVol,
    totalCallOi: callOi,
    totalPutOi: putOi,
    otmCallVolumeNearFocus,
    focusStrike,
    ivTermSlope,
    ivTermNote,
    unusualNotes,
  };
}

async function gatherOsint(): Promise<OsintPacket> {
  const base = IRONSIGHT_BASE.replace(/\/$/, "");
  const conflict = "iran-israel";
  const q = `?conflict=${conflict}`;

  const [
    ships,
    flights,
    polymarket,
    news,
    strikes,
    fires,
    telegram,
    regional,
    targeted,
  ] = await Promise.all([
    settle(fetchJson(`${base}/api/ships${q}`)),
    settle(fetchJson(`${base}/api/flights${q}`)),
    settle(fetchJson(`${base}/api/polymarket${q}`)),
    settle(fetchJson(`${base}/api/news${q}`)),
    settle(fetchJson(`${base}/api/strikes${q}`)),
    settle(fetchJson(`${base}/api/fires${q}`)),
    settle(fetchJson(`${base}/api/telegram${q}`)),
    settle(fetchJson(`${base}/api/regional-alerts${q}`)),
    settle(
      Promise.all([
        fetchNewsRss("USS Bataan LHD-5 Amphibious Ready Group"),
        fetchNewsRss("USS New York LPD-21"),
        fetchNewsRss("Kharg Island military OR IRGC OR missile"),
        fetchNewsRss("Strait of Hormuz tanker waiting OR transit OR blockage"),
        fetchNewsRss("war risk insurance Persian Gulf OR Red Sea tanker"),
        fetchNewsRss("VLCC Cape of Good Hope divert OR Bab el-Mandeb"),
        fetchNewsRss("Forward Freight Agreement TD3C OR tanker FFA"),
      ]).then((rows) => Object.fromEntries(rows.map((r) => [r.query, r.items]))),
    ),
  ]);

  const ironsightOnline = [ships, flights, news].some((s) => s.ok);

  // Filter flights/ships for keywords of interest when present
  let flightsSample: unknown = flights.ok ? flights.value : { error: flights.error };
  if (flights.ok && flights.value && typeof flights.value === "object") {
    const f = flights.value as { flights?: unknown[]; military?: number; total?: number };
    const list = Array.isArray(f.flights) ? f.flights : [];
    flightsSample = {
      total: f.total,
      military: f.military,
      sample: list.slice(0, 25),
      note: "Live ADS-B military sample via IRONSIGHT/adsb.lol — not ARG ship AIS.",
    };
  }

  let shipsOut: unknown = ships.ok ? ships.value : { error: ships.error };
  if (ships.ok) {
    shipsOut = {
      ...(typeof ships.value === "object" && ships.value ? ships.value : {}),
      note:
        "IRONSIGHT naval layer is curated static OSINT positions (warships often dark on AIS) — not live commercial tanker AIS.",
    };
  }

  return {
    ironsightOnline,
    ships: shipsOut,
    flightsSample,
    polymarket: polymarket.ok ? polymarket.value : { error: polymarket.error },
    news: news.ok ? news.value : { error: news.error },
    strikes: strikes.ok ? strikes.value : { error: strikes.error },
    fires: fires.ok ? fires.value : { error: fires.error },
    telegramSample: telegram.ok
      ? (() => {
          const v = telegram.value as { posts?: unknown[] };
          return {
            count: Array.isArray(v.posts) ? v.posts.length : 0,
            posts: Array.isArray(v.posts) ? v.posts.slice(0, 20) : [],
          };
        })()
      : { error: telegram.error },
    regionalAlerts: regional.ok ? regional.value : { error: regional.error },
    targetedNews: targeted.ok ? targeted.value : { error: targeted.error },
  };
}

export async function buildDecisionIntel(symbol = "FRO"): Promise<DecisionIntel> {
  const [physical, crackSpreads, optionsSmartMoney, volatility, osint] =
    await Promise.all([
      getPhysicalMarkets(),
      getCrackSpreads(),
      getOptionsSmartMoney(symbol, 46),
      getVolatilityReport(symbol, {
        focusStrike: 46,
        focusType: "call",
        focusExpiry: "2026-09-18",
      }),
      gatherOsint(),
    ]);

  const gaps = [
    "Platts Dated Brent (true Dtd) — licensed; using EIA Europe Brent Spot vs BZ=F as proxy.",
    "Baltic official live TD3C / FFA curves — paid Baltic Data Services; using public weekly reprints + news for FFA mentions.",
    "Intraday war-risk insurance premium tape — broker/insurer proprietary; tracking via news RSS only.",
    "Live AIS laden/ballast Hormuz waiting list & Cape diversions — needs MarineTraffic/Signal Ocean/etc.; IRONSIGHT ships are static warship OSINT + news for reroutes.",
    "USS Bataan (LHD-5) / USS New York (LPD-21) real-time ARG tracks — warships often AIS-dark; using news + IRONSIGHT naval/flights layers.",
  ];

  const decisionHints: string[] = [
    "Treat physical VLCC TD3C + crack spreads + Hormuz/Kharg OSINT as leading; equity IV and futures often lag.",
    physical.vlccTd3c.worldscale != null && physical.vlccTd3c.worldscale > 200
      ? `TD3C at WS ${physical.vlccTd3c.worldscale} / TCE $${physical.vlccTd3c.tceUsdPerDay?.toLocaleString() ?? "?"} — physical tanker market already extreme.`
      : "Monitor TD3C for physical stress prints.",
    crackSpreads.gasolineCrackUsdPerBbl != null
      ? `Gasoline crack ≈ $${crackSpreads.gasolineCrackUsdPerBbl.toFixed(2)}/bbl; heating-oil crack ≈ $${
          crackSpreads.heatingOilCrackUsdPerBbl?.toFixed(2) ?? "?"
        }/bbl.`
      : "Crack spreads unavailable.",
    optionsSmartMoney.ivTermNote,
    ...optionsSmartMoney.unusualNotes,
    osint.ironsightOnline
      ? "IRONSIGHT feeds online — ships/flights/news/polymarket/telegram included."
      : "IRONSIGHT offline — start npm run osint for theater OSINT in this packet.",
  ];

  return {
    generatedAt: new Date().toISOString(),
    physical,
    crackSpreads,
    optionsSmartMoney,
    volatility,
    osint,
    gaps,
    decisionHints,
  };
}
