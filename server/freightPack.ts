/**
 * Max VLCC / freight block for Export ALL + OSINT pack.
 * Aggregates BDTI, TD3C reprint, peers, oil curves, deep links, honesty gaps.
 */
import { fetchBdtiSeries, type BdtiReport } from "./analytics/bdti";
import {
  chokepointTransitsMarkdown,
  fetchChokepointTransits,
  type ChokepointTransitsReport,
} from "./analytics/chokepointTransits";
import {
  shippingIndustryMarkdown,
  fetchShippingIndustry,
  type ShippingIndustryReport,
} from "./analytics/shippingIndustry";
import {
  getPhysicalMarkets,
  type PhysicalMarkets,
  type FreightDeepLink,
  FREIGHT_DEEP_LINKS,
} from "./physical";
import { getEnergyQuotes } from "./market";
import { buildTheaterWatch, type TheaterWatch } from "./theaterWatch";

type EnergySnap = Awaited<ReturnType<typeof getEnergyQuotes>>;

export type FreightMaxPack = {
  generatedAt: string;
  markdown: string;
  json: Record<string, unknown>;
};

function fmtUsd(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function linkLines(links: FreightDeepLink[]): string[] {
  return links.map((l) =>
    l.note ? `- ${l.label}: ${l.href} — ${l.note}` : `- ${l.label}: ${l.href}`,
  );
}

export function freightMaxMarkdown(input: {
  physical: PhysicalMarkets | null;
  bdti: BdtiReport | null;
  theater: TheaterWatch | null;
  energy: EnergySnap | null;
  physicalError?: string | null;
  bdtiError?: string | null;
  chokepoints?: ChokepointTransitsReport | null;
  chokepointsError?: string | null;
  shippingIndustry?: ShippingIndustryReport | null;
  shippingIndustryError?: string | null;
}): string {
  const { physical, bdti, theater, energy } = input;
  const td = physical?.vlccTd3c ?? null;
  const brent = physical?.brent ?? null;
  const lines: string[] = [];

  lines.push(`# VLCC / Freight MAX · ${new Date().toISOString()}`);
  lines.push("");
  lines.push(
    "Max free data Tradehole can assemble for VLCC/freight reasoning. Not live Baltic FFA. Not TI Fixture App scrape. Includes IMF PortWatch daily chokepoint transits + Frontline/peer IR headlines.",
  );
  lines.push("");

  lines.push("## TD3C (ME Gulf → China, Baltic weekly reprint)");
  if (td) {
    lines.push(`Route: ${td.route}`);
    lines.push(
      `WS **${td.worldscale ?? "—"}** · TCE **${fmtUsd(td.tceUsdPerDay)}/day**`,
    );
    lines.push(
      `asOf: ${td.asOfLabel ?? "—"} (${td.asOfIso ?? "—"}) · lag **${td.lagDays ?? "—"}d** (~${td.lagHours ?? "—"}h)`,
    );
    lines.push(
      `source: ${td.sourceTitle ?? "—"} · ${td.sourceUrl ?? "—"} · discovery=${td.discoveryMethod ?? "—"} · candidatesTried=${td.candidatesTried}`,
    );
    if (td.excerpt) lines.push(`excerpt: ${td.excerpt}`);
    lines.push(td.note);
    if (td.relatedRoutes.length) {
      lines.push("### Related VLCC routes (same reprint)");
      for (const r of td.relatedRoutes) {
        lines.push(
          `- ${r.code} (${r.label}): WS ${r.worldscale ?? "—"} · TCE ${fmtUsd(r.tceUsdPerDay)}/day`,
        );
      }
    }
    if (td.periodCharter) {
      lines.push("### Period / time-charter context (Baltic assessment)");
      lines.push(
        `1y: ${fmtUsd(td.periodCharter.oneYearUsdPerDay)}/day · 3y: ${fmtUsd(td.periodCharter.threeYearUsdPerDay)}/day`,
      );
      if (td.periodCharter.excerpt) lines.push(td.periodCharter.excerpt);
      lines.push(td.periodCharter.note);
    } else {
      lines.push(
        "### Period / time-charter context: (not parsed from this reprint — check Fearnleys / TI Fixture App manually)",
      );
    }
  } else {
    lines.push(`(unavailable${input.physicalError ? `: ${input.physicalError}` : ""})`);
  }
  lines.push("");

  lines.push("## BDTI daily series (StockQ public proxy)");
  if (bdti) {
    lines.push(
      `Latest: **${bdti.latest?.value ?? "—"}** @ ${bdti.latest?.date ?? "—"} · prev ${bdti.prev?.value ?? "—"}`,
    );
    lines.push(
      `d/d ${fmtPct(bdti.changePct1d)} · 5d ${fmtPct(bdti.changePct5d)} · structuralBias=${bdti.structuralBias}`,
    );
    lines.push(bdti.biasNote);
    lines.push(bdti.note);
    lines.push(`source: ${bdti.sourceUrl}`);
    if (td?.worldscale != null && bdti.latest?.value != null) {
      lines.push("");
      lines.push("### TD3C vs BDTI (honesty)");
      lines.push(
        `BDTI is a dirty-tanker composite index (near-daily StockQ reprint). TD3C is a single Baltic VLCC route assessment from a **weekly** public reprint (lag ${td.lagDays ?? "?"}d). They are related but not interchangeable — do not treat BDTI moves as live TD3C WS.`,
      );
      lines.push(
        `Current pairing: BDTI ${bdti.latest.value} (${bdti.latest.date}) vs TD3C WS ${td.worldscale} / TCE ${fmtUsd(td.tceUsdPerDay)}/d (as-of ${td.asOfLabel}).`,
      );
    }
    lines.push("");
    lines.push("### BDTI daily table (last ~60 sessions)");
    lines.push("| date | BDTI | Δ vs prior |");
    lines.push("| --- | ---: | ---: |");
    const pts = bdti.points.slice(-60);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const prev = i > 0 ? pts[i - 1] : null;
      const dlt =
        prev && prev.value > 0
          ? (((p.value - prev.value) / prev.value) * 100).toFixed(2) + "%"
          : "—";
      lines.push(`| ${p.date} | ${p.value} | ${dlt} |`);
    }
  } else {
    lines.push(`(unavailable${input.bdtiError ? `: ${input.bdtiError}` : ""})`);
  }
  lines.push("");

  lines.push(
    chokepointTransitsMarkdown(
      input.chokepoints ?? null,
      input.chokepointsError,
    ),
  );
  lines.push("");

  lines.push(
    shippingIndustryMarkdown(
      input.shippingIndustry ?? null,
      input.shippingIndustryError,
    ),
  );
  lines.push("");

  lines.push("## Oil curves / physical Brent (already in pack)");
  if (theater) {
    lines.push(
      `WTI: ${theater.wtiCurve.near.label} ${fmtUsd(theater.wtiCurve.near.price, 2)} → ${theater.wtiCurve.far.label} ${fmtUsd(theater.wtiCurve.far.price, 2)} · spread ${fmtUsd(theater.wtiCurve.spread, 2)} · **${theater.wtiCurve.regime}**`,
    );
    lines.push(theater.wtiCurve.read);
    lines.push(
      `Brent: ${theater.brentCurve.near.label} ${fmtUsd(theater.brentCurve.near.price, 2)} → ${theater.brentCurve.far.label} ${fmtUsd(theater.brentCurve.far.price, 2)} · spread ${fmtUsd(theater.brentCurve.spread, 2)} · **${theater.brentCurve.regime}**`,
    );
    lines.push(theater.brentCurve.read);
    lines.push(
      `HO/RB: **${theater.productCurves.regime}** — ${theater.productCurves.read}`,
    );
  }
  if (energy) {
    lines.push(
      `Energy quotes: Diesel HO ${fmtUsd(energy.heatingOil?.price, 3)}/gal · WTI ${fmtUsd(energy.wti?.price, 2)} (${fmtPct(energy.wti?.changePercent)}) · Brent fut ${fmtUsd(energy.brent?.price, 2)} (${fmtPct(energy.brent?.changePercent)})${
        energy.dieselCrackUsdPerBbl != null
          ? ` · HO–WTI crack ${fmtUsd(energy.dieselCrackUsdPerBbl, 2)}/bbl`
          : ""
      }`,
    );
  }
  if (brent) {
    lines.push(
      `EIA Europe Brent Spot: ${fmtUsd(brent.eiaEuropeBrentSpot.price, 2)} as-of ${brent.eiaEuropeBrentSpot.asOf ?? "—"} · spot−futures ${fmtUsd(brent.spotMinusFutures, 2)}`,
    );
    lines.push(brent.eiaEuropeBrentSpot.note);
  }
  lines.push("");

  lines.push("## Peers vs FRO");
  if (theater?.peers) {
    for (const r of theater.peers.rows) {
      lines.push(
        `- ${r.symbol} (${r.label}): ${fmtUsd(r.price, 2)} (${fmtPct(r.changePct)})`,
      );
    }
    lines.push(theater.peers.read);
  } else {
    lines.push("(peers unavailable)");
  }
  lines.push("");

  lines.push("## FRO realized TCE notes");
  lines.push(
    "Tradehole does **not** currently ingest Frontline fleet TCE / time-charter-equivalent earnings from filings. Baltic standard VLCC round-trip TCE on TD3C is an index vessel — not FRO's book.",
  );
  lines.push(
    "For realized/guidance TCE: open Frontline IR (https://www.frontline.bm/) latest earnings release / 6-K and paste figures manually into the receiving LLM.",
  );
  lines.push("");

  lines.push("## Bleeding-edge deep links (do not scrape TI Fixture App)");
  lines.push(...linkLines(td?.deepLinks?.length ? td.deepLinks : FREIGHT_DEEP_LINKS));
  lines.push("");

  lines.push("## Honesty gaps");
  const gaps = [
    ...(td?.honestyGaps ?? []),
    ...(physical?.caveats ?? []),
    "No free live Baltic FFA curve (TD3C Q3/Q4 contango/backwardation requires license).",
    "BDTI StockQ is a public proxy reprint — not official Baltic.",
    input.chokepoints?.hormuz.latest
      ? "✅ IMF PortWatch daily Hormuz/Bab/Cape transit counts (lagged ~3–7d) — not live MarineTraffic AIS."
      : "❌ IMF PortWatch chokepoint transits unavailable this run — MarineTraffic deep links only.",
    "Commercial AIS waiting-list / laden-ballast scrapes still require a license.",
    input.shippingIndustry?.frontline.length
      ? "✅ Frontline/peer headlines via Google News + IR deep links (TCE figures not PDF-parsed)."
      : "Frontline IR headlines thin this run — open frontline.bm manually.",
  ];
  for (const g of [...new Set(gaps)]) lines.push(`- ${g}`);
  lines.push("");

  return lines.join("\n");
}

export async function buildFreightMaxPack(): Promise<FreightMaxPack> {
  const generatedAt = new Date().toISOString();
  const [physicalS, bdtiS, theaterS, energyS, chokeS, shipS] = await Promise.all([
    getPhysicalMarkets()
      .then((v) => ({ ok: true as const, value: v }))
      .catch((e) => ({ ok: false as const, error: String(e) })),
    fetchBdtiSeries()
      .then((v) => ({ ok: true as const, value: v }))
      .catch((e) => ({ ok: false as const, error: String(e) })),
    buildTheaterWatch()
      .then((v) => ({ ok: true as const, value: v }))
      .catch((e) => ({ ok: false as const, error: String(e) })),
    getEnergyQuotes()
      .then((v) => ({ ok: true as const, value: v }))
      .catch((e) => ({ ok: false as const, error: String(e) })),
    fetchChokepointTransits()
      .then((v) => ({ ok: true as const, value: v }))
      .catch((e) => ({ ok: false as const, error: String(e) })),
    fetchShippingIndustry()
      .then((v) => ({ ok: true as const, value: v }))
      .catch((e) => ({ ok: false as const, error: String(e) })),
  ]);

  const physical = physicalS.ok ? physicalS.value : null;
  const bdti = bdtiS.ok ? bdtiS.value : null;
  const theater = theaterS.ok ? theaterS.value : null;
  const energy = energyS.ok ? energyS.value : null;
  const chokepoints = chokeS.ok ? chokeS.value : null;
  const shippingIndustry = shipS.ok ? shipS.value : null;

  const markdown = freightMaxMarkdown({
    physical,
    bdti,
    theater,
    energy,
    physicalError: physicalS.ok ? null : physicalS.error,
    bdtiError: bdtiS.ok ? null : bdtiS.error,
    chokepoints,
    chokepointsError: chokeS.ok ? null : chokeS.error,
    shippingIndustry,
    shippingIndustryError: shipS.ok ? null : shipS.error,
  });

  const json = {
    generatedAt,
    td3c: physical?.vlccTd3c ?? null,
    eiaBrent: physical?.brent ?? null,
    physicalCaveats: physical?.caveats ?? null,
    bdti: bdti
      ? {
          latest: bdti.latest,
          prev: bdti.prev,
          changePct1d: bdti.changePct1d,
          changePct5d: bdti.changePct5d,
          structuralBias: bdti.structuralBias,
          biasNote: bdti.biasNote,
          sourceUrl: bdti.sourceUrl,
          note: bdti.note,
          points: bdti.points,
        }
      : { error: bdtiS.ok ? null : bdtiS.error },
    chokepointTransits: chokepoints ?? { error: chokeS.ok ? null : chokeS.error },
    shippingIndustry: shippingIndustry ?? {
      error: shipS.ok ? null : shipS.error,
    },
    peers: theater?.peers ?? null,
    wtiCurve: theater?.wtiCurve ?? null,
    brentCurve: theater?.brentCurve ?? null,
    productCurves: theater?.productCurves ?? null,
    energyQuotes: energy,
    froRealizedTce: {
      available: false,
      note: "Not auto-ingested from PDFs. Use Frontline IR filings for fleet TCE / guidance; headlines included above.",
      irUrl: "https://www.frontline.bm/",
    },
    sources: {
      physical: physicalS.ok ? "ok" : "error",
      bdti: bdtiS.ok ? "ok" : "error",
      theater: theaterS.ok ? "ok" : "error",
      energy: energyS.ok ? "ok" : "error",
      chokepoints: chokeS.ok ? "ok" : "error",
      shippingIndustry: shipS.ok ? "ok" : "error",
    },
  };

  return { generatedAt, markdown, json };
}
