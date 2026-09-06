import { formatAerialAssetLine } from "./aerialFormat";
import { copyText } from "./clipboard";
import { fetchMapCopyBoard } from "../services/api";
import type { IsraelStrikeTells, TheaterWatch } from "../types";

type StampRow = {
  label: string;
  kind: string;
  lat: number;
  lon: number;
  stale?: boolean;
  ageSec?: number;
  lastSeenAt?: string;
  sogKt?: number | null;
  courseDeg?: number | null;
  region?: string;
  meta?: string;
};

function stampLine(s: StampRow): string {
  return `- ${s.stale ? "DARK" : "LIVE"} ${s.label} · kind ${s.kind} · ${s.lat.toFixed(4)},${s.lon.toFixed(4)}${s.courseDeg != null ? ` · hdg ${Math.round(s.courseDeg)}°` : ""}${s.sogKt != null ? ` · ${s.sogKt.toFixed(1)}kt` : ""}${s.region ? ` · region ${s.region}` : ""}${s.ageSec != null ? ` · age ${s.ageSec}s` : ""}${s.lastSeenAt ? ` · lastSeen ${s.lastSeenAt}` : ""}${s.meta ? ` · ${s.meta}` : ""}`;
}

function collectStamps(
  theater: TheaterWatch | null,
  skipHexes?: Set<string>,
): StampRow[] {
  if (!theater) return [];
  const out: StampRow[] = [];
  const seen = new Set<string>();
  const push = (s: StampRow) => {
    const key = `${s.label}|${s.lat.toFixed(2)}|${s.lon.toFixed(2)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };

  for (const v of theater.khargPickaxe?.amphibious?.vessels ?? []) {
    const stamp = v.ironsight;
    if (!stamp || !Number.isFinite(stamp.lat) || !Number.isFinite(stamp.lon))
      continue;
    if (stamp.lat === 0 && stamp.lon === 0) continue;
    const stale = (stamp as { stale?: boolean }).stale === true;
    push({
      label: stamp.name || v.name,
      kind: "arg",
      lat: stamp.lat,
      lon: stamp.lon,
      stale,
      ageSec: (stamp as { ageSec?: number }).ageSec,
      sogKt: (stamp as { sogKt?: number | null }).sogKt ?? null,
      courseDeg:
        (stamp as { courseDeg?: number | null }).courseDeg ??
        (stamp as { headingDeg?: number | null }).headingDeg ??
        null,
      region: stamp.region,
      meta: `${stale ? "DARK / LAST-KNOWN" : "LIVE"} · ${stamp.status} · ${stamp.region}${stamp.lastReported ? ` · ${stamp.lastReported}` : ""}`,
    });
  }

  for (const s of theater.khargPickaxe?.e6b?.samples ?? []) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    const stale = (s as { stale?: boolean }).stale === true;
    push({
      label: s.callsign || "E-6B",
      kind: "e6b",
      lat: s.lat,
      lon: s.lon,
      stale,
      ageSec: (s as { ageSec?: number }).ageSec,
      meta: `${stale ? "DARK / LAST-KNOWN" : "LIVE"} · hex ${(s as { hex?: string }).hex || "?"} · type ${s.aircraftType || "?"} · class e6b`,
    });
  }

  for (const s of theater.aerial?.samples ?? []) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    const stale = (s as { stale?: boolean }).stale === true;
    const hex = (s as { hex?: string }).hex;
    if (hex && skipHexes?.has(hex)) continue;
    push({
      label: s.callsign || s.type || "ADS-B",
      kind: "gulf_adsb",
      lat: s.lat,
      lon: s.lon,
      stale,
      ageSec: (s as { ageSec?: number }).ageSec,
      region: (s as { region?: string }).region,
      meta: `${stale ? "DARK / LAST-KNOWN" : "LIVE"} · hex ${hex || "?"} · type ${s.aircraftType || "?"} · class ${s.type}`,
    });
  }

  for (const s of theater.mapOverlays?.stamps ?? []) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    if (s.lat === 0 && s.lon === 0) continue;
    push({
      label: s.label,
      kind: s.kind,
      lat: s.lat,
      lon: s.lon,
      stale: s.stale === true,
      ageSec: s.ageSec,
      lastSeenAt: s.lastSeenAt,
      sogKt: s.sogKt ?? null,
      courseDeg: s.courseDeg ?? null,
      region: s.region,
      meta:
        s.meta ??
        `${s.stale ? "DARK / LAST-KNOWN" : "LIVE"} · ${s.status} · ${s.region}${s.lastReported ? ` · ${s.lastReported}` : ""}`,
    });
  }

  return out;
}

/** LIVE Map board paste — last-good server cache (does not rebuild ADS-B/RSS). */
export async function copyLiveMapAssets(opts?: {
  israelStrike?: IsraelStrikeTells | null;
  theater?: TheaterWatch | null;
}): Promise<void> {
  const notes: string[] = [];
  let ist: IsraelStrikeTells | null = opts?.israelStrike ?? null;
  let theater: TheaterWatch | null = opts?.theater ?? null;
  let source = "desk last-good (instant)";
  try {
    const board = await fetchMapCopyBoard();
    if (board.israelStrike) ist = board.israelStrike;
    if (board.theater) theater = board.theater;
    const ageSec =
      board.israelStrikeAgeMs != null
        ? Math.round(board.israelStrikeAgeMs / 1000)
        : null;
    source = `server last-good${ageSec != null ? ` · IST age ${ageSec}s` : ""} (no ADS-B rebuild)`;
  } catch (e) {
    notes.push(
      `map-copy-board failed: ${e instanceof Error ? e.message : String(e)} · using desk snapshot if present`,
    );
    source = "desk snapshot fallback (copy board timed out)";
  }
  if (!ist && !theater) {
    notes.push("no last-good board yet — wait one IST/theater poll cycle");
  }

  const liveTracks = ist?.inputs.aerialTracks ?? [];
  const darkTracks = ist?.inputs.aerialLastGoodTracks ?? [];
  const aerialHexes = new Set(
    [...liveTracks, ...darkTracks].map((t) => t.hex).filter(Boolean),
  );
  const overlays = ist?.inputs.mapOverlays;
  const istZones = overlays?.zones ?? [];
  const istAis = overlays?.points ?? [];
  const theaterAis = theater?.mapOverlays?.aisPoints ?? [];
  const allAis = [...istAis, ...theaterAis];
  const istFirms = overlays?.firmsPoints ?? [];
  const firmsNote = overlays?.firmsNote ?? "FIRMS: no coords";
  const stamps = collectStamps(theater, aerialHexes);
  const theaterZones = theater?.mapOverlays?.zones ?? [];

  const lines: string[] = [
    `**Tradehole Map · displayed assets** · ${new Date().toISOString()}`,
    `Mode: LIVE`,
    `Layers on: aerial, notam, adsb, ais, dipNav, theater, firms`,
    `Honesty: class = Tradehole label; type = raw ICAO (E35L = Embraer Legacy 600 bizjet, not E-3 Sentry AWACS). FOLLOWED = tanker/AWACS/airlift/combat hex enrolled in Med–Gulf–Horn, then tracked outside scoring boxes (still transmitting, not AER-01). VIP airliners (B77W) and EMS/firefighting types are not followed. Naval stamps are curated OSINT (often static lat/lon, no SOG). AISStream Cyprus is NAV-01; Hormuz/Bab AIS is plot-only.`,
    `Source: ${source}.`,
    ``,
  ];
  if (notes.length) lines.push(`Fetch notes: ${notes.join(" · ")}`, ``);

  const none = () => lines.push(`- (none)`);

  lines.push(`### Aerial · Levant ADS-B`);
  let n = 0;
  const followed = liveTracks.filter((t) => t.followed);
  const inBoxLive = liveTracks.filter((t) => !t.followed);
  for (const t of inBoxLive) {
    lines.push(`- ${formatAerialAssetLine(t)}`);
    n += 1;
  }
  if (followed.length) {
    lines.push(`### Aerial · FOLLOWED outbound (enrolled in theater, still transmitting — not AER-scored)`);
    for (const t of followed) {
      lines.push(`- ${formatAerialAssetLine(t)}`);
      n += 1;
    }
  }
  for (const t of darkTracks) {
    lines.push(`- ${formatAerialAssetLine({ ...t, stale: true })}`);
    n += 1;
  }
  if (!n) none();
  lines.push(
    `AER scored: ${ist?.inputs.aerialTankersLevant ?? "—"}t / ${ist?.inputs.aerialAwacsLevant ?? "—"}a · feed ${ist?.inputs.aerialFeedStatus ?? "?"} · peak ${ist?.inputs.aerialSessionPeak ? `${ist.inputs.aerialSessionPeak.tankers}t/${ist.inputs.aerialSessionPeak.awacs}a` : "—"}`,
    ``,
  );

  lines.push(
    `### Theater stamps · ARG / SSGN / CSG / naval / Gulf ADS-B / E-6B`,
  );
  if (!stamps.length) none();
  for (const s of stamps) lines.push(stampLine(s));
  lines.push(``);

  lines.push(`### AIS · Cyprus / Hormuz / Bab`);
  if (!allAis.length) none();
  for (const p of allAis) {
    lines.push(
      `- ${p.label} · category ${p.category} · ${p.lat.toFixed(4)},${p.lon.toFixed(4)}${p.sog != null ? ` · ${p.sog.toFixed(1)}kt` : ""}${p.cog != null ? ` · cog ${Math.round(p.cog)}°` : ""}${"boxId" in p && (p as { boxId?: string }).boxId ? ` · ${(p as { boxId?: string }).boxId}` : ""} · id ${p.id}`,
    );
  }
  lines.push(``);

  lines.push(`### FIRMS thermal`);
  if (!istFirms.length) none();
  for (const p of istFirms) {
    lines.push(
      `- ${p.label} · box ${p.box} · ${p.lat.toFixed(4)},${p.lon.toFixed(4)}${p.frp != null ? ` · frp ${p.frp}` : ""}${p.acqDate ? ` · ${p.acqDate}` : ""} · id ${p.id}`,
    );
  }
  lines.push(`Note: ${firmsNote}`, ``);

  lines.push(`### Zones (on-map rectangles)`);
  const zoneList = [...istZones, ...theaterZones];
  if (!zoneList.length) none();
  for (const z of zoneList) {
    lines.push(
      `- ${z.id} · ${z.kind} · ${z.status} · ${z.label} · box ${z.latMin.toFixed(2)}–${z.latMax.toFixed(2)}N ${z.lonMin.toFixed(2)}–${z.lonMax.toFixed(2)}E${z.titles?.length ? ` · ${z.titles.slice(0, 2).join(" | ")}` : ""}`,
    );
  }
  lines.push(``);
  lines.push(
    `Landmarks omitted here (context pins). Open Map tab for LLBG/Hormuz/etc.`,
    ``,
  );
  lines.push(
    `Counts: Levant aerial ${inBoxLive.length} live / ${followed.length} followed / ${darkTracks.length} dark · theater stamps ${stamps.length} · AIS ${allAis.length} · FIRMS ${istFirms.length}`,
  );

  await copyText(lines.join("\n"));
}
