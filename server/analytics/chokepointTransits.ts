/**
 * Daily chokepoint vessel transit counts — IMF PortWatch (free ArcGIS, no key).
 * Hormuz = chokepoint6 · Bab el-Mandeb = chokepoint4 · Cape = chokepoint7 (diversion).
 * Reporting lag typically ~3–7 days. Cite IMF PortWatch when republishing.
 */

export type ChokepointDay = {
  date: string;
  nTotal: number;
  nTanker: number;
  nCargo: number;
  nContainer: number;
  nDryBulk: number;
};

export type ChokepointSeries = {
  id: string;
  name: string;
  portid: string;
  latest: ChokepointDay | null;
  prev: ChokepointDay | null;
  changePct7d: number | null;
  avg7d: number | null;
  avg30d: number | null;
  points: ChokepointDay[];
  note: string;
};

export type ChokepointTransitsReport = {
  asOf: string;
  /** Latest Hormuz print date (YYYY-MM-DD) when available — not fetch time. */
  dataAsOf: string | null;
  /** Calendar lag of latest Hormuz print vs today. */
  dataLagDays: number | null;
  source: string;
  portal: string;
  lagNote: string;
  hormuz: ChokepointSeries;
  bab: ChokepointSeries;
  cape: ChokepointSeries;
  read: string;
  deepLinks: Array<{ label: string; href: string }>;
};

const ARCGIS_BASE =
  "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query";

const CHOKEPOINTS = [
  { id: "hormuz", name: "Strait of Hormuz", portid: "chokepoint6" },
  { id: "bab", name: "Bab el-Mandeb Strait", portid: "chokepoint4" },
  { id: "cape", name: "Cape of Good Hope", portid: "chokepoint7" },
] as const;

async function fetchSeries(
  portid: string,
  name: string,
  id: string,
  days = 60,
): Promise<ChokepointSeries> {
  const empty: ChokepointSeries = {
    id,
    name,
    portid,
    latest: null,
    prev: null,
    changePct7d: null,
    avg7d: null,
    avg30d: null,
    points: [],
    note: "IMF PortWatch daily chokepoint transit calls (AIS-derived estimates).",
  };
  try {
    const url =
      `${ARCGIS_BASE}?where=${encodeURIComponent(`portid='${portid}'`)}` +
      `&outFields=date,portid,portname,n_total,n_tanker,n_cargo,n_container,n_dry_bulk` +
      `&orderByFields=date DESC&resultRecordCount=${days}&returnGeometry=false&f=json`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Tradehole/0.2 (personal research; IMF PortWatch)",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      return { ...empty, note: `PortWatch HTTP ${res.status}` };
    }
    const json = (await res.json()) as {
      features?: Array<{ attributes?: Record<string, unknown> }>;
    };
    const points: ChokepointDay[] = [];
    for (const f of json.features ?? []) {
      const a = f.attributes ?? {};
      const date = String(a.date ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      points.push({
        date,
        nTotal: Number(a.n_total ?? 0) || 0,
        nTanker: Number(a.n_tanker ?? 0) || 0,
        nCargo: Number(a.n_cargo ?? 0) || 0,
        nContainer: Number(a.n_container ?? 0) || 0,
        nDryBulk: Number(a.n_dry_bulk ?? 0) || 0,
      });
    }
    // API returns DESC; normalize ASC for series math
    points.sort((a, b) => a.date.localeCompare(b.date));
    const latest = points.at(-1) ?? null;
    const prev = points.length >= 2 ? points[points.length - 2] : null;
    const last7 = points.slice(-7);
    const last30 = points.slice(-30);
    const avg = (arr: ChokepointDay[]) =>
      arr.length
        ? arr.reduce((s, p) => s + p.nTotal, 0) / arr.length
        : null;
    const avg7d = avg(last7);
    const avg30d = avg(last30);
    const ago7 = points.length >= 8 ? points[points.length - 8] : null;
    const changePct7d =
      latest && ago7 && ago7.nTotal > 0
        ? ((latest.nTotal - ago7.nTotal) / ago7.nTotal) * 100
        : null;
    return {
      ...empty,
      latest,
      prev,
      changePct7d,
      avg7d,
      avg30d,
      points,
    };
  } catch (err) {
    return { ...empty, note: `PortWatch fetch failed: ${String(err)}` };
  }
}

function lagDaysFromIso(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(`${iso}T12:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 86_400_000));
}

function buildRead(
  hormuz: ChokepointSeries,
  bab: ChokepointSeries,
  cape: ChokepointSeries,
): string {
  const h = hormuz.latest;
  const b = bab.latest;
  const c = cape.latest;
  if (!h && !b) {
    return "IMF PortWatch chokepoint series unavailable — use MarineTraffic deep links as Layer-3 manual gap.";
  }
  const parts: string[] = [];
  if (h) {
    const lag = lagDaysFromIso(h.date);
    parts.push(
      `Hormuz latest ${h.date}${lag != null ? ` (lag ~${lag}d)` : ""}: ${h.nTotal} total / ${h.nTanker} tanker (7d avg ${hormuz.avg7d?.toFixed(1) ?? "—"}, 30d avg ${hormuz.avg30d?.toFixed(1) ?? "—"})`,
    );
  }
  if (b) {
    parts.push(
      `Bab latest ${b.date}: ${b.nTotal} total / ${b.nTanker} tanker (7d avg ${bab.avg7d?.toFixed(1) ?? "—"})`,
    );
  }
  if (c) {
    parts.push(
      `Cape latest ${c.date}: ${c.nTotal} total (diversion proxy; 7d avg ${cape.avg7d?.toFixed(1) ?? "—"})`,
    );
  }
  parts.push(
    "PortWatch is lagged AIS-derived estimates — not live MarineTraffic counts. Crisis periods can print very low Hormuz totals vs pre-crisis norms.",
  );
  return parts.join(". ");
}

export async function fetchChokepointTransits(): Promise<ChokepointTransitsReport> {
  const [hormuz, bab, cape] = await Promise.all(
    CHOKEPOINTS.map((c) => fetchSeries(c.portid, c.name, c.id)),
  );
  const dataAsOf = hormuz.latest?.date ?? bab.latest?.date ?? null;
  const dataLagDays = lagDaysFromIso(dataAsOf);
  const lagNote =
    dataAsOf != null
      ? `Hormuz/chokepoint PortWatch print as-of ${dataAsOf}${dataLagDays != null ? ` · lag ~${dataLagDays}d` : ""} — not live AIS. Typical publish lag ~3–7 days. Free, no API key. Cite IMF PortWatch.`
      : "Typical publish lag ~3–7 days. Free, no API key. Cite IMF PortWatch. Not live AIS.";
  return {
    asOf: new Date().toISOString(),
    dataAsOf,
    dataLagDays,
    source: "IMF PortWatch Daily_Chokepoints_Data (ArcGIS FeatureServer)",
    portal: "https://portwatch.imf.org/",
    lagNote,
    hormuz,
    bab,
    cape,
    read: buildRead(hormuz, bab, cape),
    deepLinks: [
      { label: "IMF PortWatch", href: "https://portwatch.imf.org/" },
      {
        label: "MarineTraffic · Hormuz",
        href: "https://www.marinetraffic.com/en/ais/home/centerx:56.25/centery:26.56/zoom:8",
      },
      {
        label: "MarineTraffic · Bab el-Mandeb",
        href: "https://www.marinetraffic.com/en/ais/home/centerx:43.3/centery:12.6/zoom:8",
      },
      {
        label: "straits.live Hormuz mirror",
        href: "https://straits.live/",
      },
    ],
  };
}

export function chokepointTransitsMarkdown(
  report: ChokepointTransitsReport | null,
  error?: string | null,
): string {
  const lines: string[] = [
    "## Chokepoint vessel transits (IMF PortWatch — free)",
  ];
  if (!report) {
    lines.push(`(unavailable${error ? `: ${error}` : ""})`);
    lines.push(
      "❌ Live commercial AIS transit counts still require a license; PortWatch is the free lagged proxy.",
    );
    return lines.join("\n");
  }
  lines.push(`✅ ${report.source}`);
  lines.push(report.lagNote);
  lines.push(report.read);
  lines.push(`portal: ${report.portal}`);
  for (const series of [report.hormuz, report.bab, report.cape]) {
    lines.push("");
    lines.push(`### ${series.name} (\`${series.portid}\`)`);
    if (!series.latest) {
      lines.push("- (no rows)");
      continue;
    }
    lines.push(
      `Latest **${series.latest.date}**: total **${series.latest.nTotal}** · tanker **${series.latest.nTanker}** · cargo ${series.latest.nCargo} · container ${series.latest.nContainer} · dry bulk ${series.latest.nDryBulk}`,
    );
    lines.push(
      `7d avg ${series.avg7d?.toFixed(1) ?? "—"} · 30d avg ${series.avg30d?.toFixed(1) ?? "—"} · vs ~7d ago ${series.changePct7d != null ? `${series.changePct7d >= 0 ? "+" : ""}${series.changePct7d.toFixed(1)}%` : "—"}`,
    );
    lines.push("| date | total | tanker | cargo |");
    lines.push("| --- | ---: | ---: | ---: |");
    for (const p of series.points.slice(-21)) {
      lines.push(
        `| ${p.date} | ${p.nTotal} | ${p.nTanker} | ${p.nCargo} |`,
      );
    }
  }
  lines.push("");
  lines.push("Deep links:");
  for (const l of report.deepLinks) {
    lines.push(`- ${l.label}: ${l.href}`);
  }
  return lines.join("\n");
}
