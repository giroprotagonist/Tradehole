/**
 * Optional AIS via AISStream.io (free API key, WebSocket).
 * Legitimate ToS path — no MarineTraffic scrape, no CF/paywall bypass.
 *
 * Set AISSTREAM_API_KEY in .env (sign up at https://aisstream.io/).
 * Subscribes to compact Cyprus + Hormuz + Bab boxes. NAV-01 / High-go still
 * uses Cyprus navy-like only. Community terrestrial AIS — warships often dark.
 */

/** Minimal WebSocket surface (Node 20+ global). */
type AisWs = {
  readyState: number;
  binaryType?: string;
  send(data: string): void;
  close(): void;
  addEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (ev: { data?: unknown }) => void,
  ): void;
};

type AisWsCtor = {
  new (url: string): AisWs;
  readonly CONNECTING: number;
  readonly OPEN: number;
};

const WS = globalThis.WebSocket as unknown as AisWsCtor;

/**
 * South/east Cyprus approaches (Larnaca / Famagusta / Limassol shelf).
 * Slightly wider than the old tight box so coastal AIS stations can land
 * vessels on the approaches without inventing GPS.
 */
export const CYPRUS_AIS_BBOX = {
  latMin: 34.28,
  latMax: 35.78,
  lonMin: 32.35,
  lonMax: 34.95,
} as const;

/** Strait of Hormuz + close approaches — not the whole Gulf. */
export const HORMUZ_AIS_BBOX = {
  latMin: 25.3,
  latMax: 27.4,
  lonMin: 55.2,
  lonMax: 57.6,
} as const;

/** Bab el-Mandeb / Aden approaches. */
export const BAB_AIS_BBOX = {
  latMin: 11.8,
  latMax: 14.2,
  lonMin: 42.2,
  lonMax: 44.8,
} as const;

export type AisWatchBoxId = "cyprus" | "hormuz" | "bab";

export const AIS_WATCH_BOXES: Array<{
  id: AisWatchBoxId;
  label: string;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}> = [
  { id: "cyprus", label: "Cyprus / E-Med AIS", ...CYPRUS_AIS_BBOX },
  { id: "hormuz", label: "Hormuz / Strait AIS", ...HORMUZ_AIS_BBOX },
  { id: "bab", label: "Bab el-Mandeb AIS", ...BAB_AIS_BBOX },
];

export function matchAisWatchBox(
  lat: number,
  lon: number,
): AisWatchBoxId | null {
  for (const b of AIS_WATCH_BOXES) {
    if (
      lat >= b.latMin &&
      lat <= b.latMax &&
      lon >= b.lonMin &&
      lon <= b.lonMax
    ) {
      return b.id;
    }
  }
  return null;
}

const WS_URL = "wss://stream.aisstream.io/v0/stream";
const VESSEL_TTL_MS = 18 * 60 * 1000;
const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 90_000;
/** Force reconnect if socket is open but silent this long. */
const STALE_RECONNECT_MS = 3 * 60 * 1000;
/** Don't call the box "empty" until we've waited this long after subscribe. */
const EMPTY_GRACE_MS = 90_000;
/** If socket stays CONNECTING this long, surface ERROR (not hung forever). */
const CONNECTING_TIMEOUT_MS = 60_000;
const MAX_LIST = 24;

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

export type CyprusAisStatus =
  | "disabled"
  | "connecting"
  | "live"
  | "stale"
  | "error"
  | "empty";

export type CyprusAisSnapshot = {
  enabled: boolean;
  status: CyprusAisStatus;
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
  bbox: typeof CYPRUS_AIS_BBOX;
  note: string;
  /** Seconds in current connecting/empty-grace wait (UI honesty). */
  statusAgeSec: number | null;
};

export type TheaterAisVessel = CyprusAisVessel & {
  boxId: "hormuz" | "bab";
};

export type TheaterAisSnapshot = {
  enabled: boolean;
  status: CyprusAisStatus;
  error: string | null;
  asOf: string | null;
  vessels: TheaterAisVessel[];
  boxes: Array<{
    id: "hormuz" | "bab";
    label: string;
    latMin: number;
    latMax: number;
    lonMin: number;
    lonMax: number;
    totalInBox: number;
    militaryCount: number;
    tankerCount: number;
    interestCount: number;
  }>;
  note: string;
};

type Track = {
  mmsi: string;
  name: string;
  shipType: number | null;
  lat: number | null;
  lon: number | null;
  sog: number | null;
  cog: number | null;
  updatedAtMs: number;
};

let started = false;
let ws: AisWs | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let reconnectAttempt = 0;
let lastError: string | null = null;
let lastMessageAt: number | null = null;
let subscribedAt: number | null = null;
let messageCount = 0;
let connecting = false;
let connectingSince: number | null = null;
const tracks = new Map<string, Track>();

const INTEREST_NAME_RE =
  /\b(sa.?ar|hanit|eilat|lahav|magen|oz\b|nirit|ins\b|israeli|idf|corvette|missile.?boat|navy|warship|patrol|opv|frigate)\b/i;

function apiKey(): string | null {
  const k = process.env.AISSTREAM_API_KEY?.trim();
  return k && k.length > 8 && !/^your[_-]?/i.test(k) ? k : null;
}

function shipTypeLabel(t: number | null): string {
  if (t == null) return "unknown";
  if (t === 35) return "military";
  if (t >= 80 && t <= 89) return "tanker";
  if (t >= 70 && t <= 79) return "cargo";
  if (t >= 60 && t <= 69) return "passenger";
  if (t === 30) return "fishing";
  if (t === 31 || t === 32) return "towing";
  if (t === 36 || t === 37) return "pleasure";
  if (t >= 40 && t <= 49) return "HSC";
  return `type ${t}`;
}

function categorize(shipType: number | null, name: string): CyprusAisCategory {
  if (shipType === 35) return "military";
  if (shipType != null && shipType >= 80 && shipType <= 89) return "tanker";
  if (INTEREST_NAME_RE.test(name)) return "interest";
  return "other";
}

function inBox(lat: number, lon: number): boolean {
  return matchAisWatchBox(lat, lon) != null;
}

function prune(): void {
  const cutoff = Date.now() - VESSEL_TTL_MS;
  for (const [mmsi, t] of tracks) {
    if (t.updatedAtMs < cutoff) tracks.delete(mmsi);
  }
}

function upsert(partial: Partial<Track> & { mmsi: string }): void {
  const cur = tracks.get(partial.mmsi);
  const next: Track = {
    mmsi: partial.mmsi,
    name: (partial.name ?? cur?.name ?? "").trim(),
    shipType: partial.shipType ?? cur?.shipType ?? null,
    lat: partial.lat ?? cur?.lat ?? null,
    lon: partial.lon ?? cur?.lon ?? null,
    sog: partial.sog ?? cur?.sog ?? null,
    cog: partial.cog ?? cur?.cog ?? null,
    updatedAtMs: Date.now(),
  };
  if (next.lat != null && next.lon != null && !inBox(next.lat, next.lon)) {
    tracks.delete(partial.mmsi);
    return;
  }
  tracks.set(partial.mmsi, next);
}

function numField(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Node's undici WebSocket often delivers AIS frames as Blob/ArrayBuffer
 * (binary JSON). `String(blob)` becomes "[object Blob]" and silently drops
 * every message — which is why NAV-01/Hormuz stuck on connecting/empty.
 */
export async function wsDataToTextForTests(data: unknown): Promise<string> {
  return wsDataToText(data);
}

async function wsDataToText(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(
      data.buffer,
      data.byteOffset,
      data.byteLength,
    ).toString("utf8");
  }
  if (
    data &&
    typeof data === "object" &&
    typeof (data as { text?: unknown }).text === "function"
  ) {
    return await (data as { text: () => Promise<string> }).text();
  }
  return String(data ?? "");
}

function handleMessage(raw: string): void {
  let msg: {
    MessageType?: string;
    MetaData?: Record<string, unknown>;
    Message?: Record<string, Record<string, unknown>>;
    error?: unknown;
  };
  try {
    msg = JSON.parse(raw) as typeof msg;
  } catch {
    return;
  }

  // Server may push bare error objects.
  if (msg.error != null && !msg.MessageType) {
    lastError =
      typeof msg.error === "string"
        ? msg.error
        : JSON.stringify(msg.error).slice(0, 200);
    return;
  }

  if (!msg.MessageType || msg.MessageType === "Error") {
    const errBody =
      msg.Message?.ErrorMessage ??
      msg.Message?.error ??
      msg.error;
    if (errBody || msg.MessageType === "Error") {
      lastError =
        typeof errBody === "string"
          ? errBody
          : JSON.stringify(errBody ?? msg).slice(0, 200);
    }
    return;
  }

  messageCount += 1;
  lastMessageAt = Date.now();
  lastError = null;

  const meta = msg.MetaData ?? {};
  const mmsi = String(meta.MMSI ?? meta.mmsi ?? "").trim();
  if (!mmsi) return;

  const lat =
    numField(meta.latitude) ??
    numField(meta.Latitude) ??
    numField(meta.lat);
  const lon =
    numField(meta.longitude) ??
    numField(meta.Longitude) ??
    numField(meta.lon) ??
    numField(meta.lng);

  const body = msg.Message?.[msg.MessageType] ?? {};
  const nameFromMeta =
    typeof meta.ShipName === "string"
      ? meta.ShipName.trim()
      : typeof meta.shipName === "string"
        ? String(meta.shipName).trim()
        : "";
  const nameFromBody =
    typeof body.Name === "string"
      ? String(body.Name).trim()
      : typeof body.name === "string"
        ? String(body.name).trim()
        : "";

  if (
    msg.MessageType === "ShipStaticData" ||
    msg.MessageType === "StaticDataReport"
  ) {
    const typeRaw = body.Type ?? body.type ?? body.ShipType;
    const shipType = numField(typeRaw);
    upsert({
      mmsi,
      name: nameFromBody || nameFromMeta,
      shipType,
      lat: lat ?? undefined,
      lon: lon ?? undefined,
    });
    return;
  }

  // Position reports (Class A/B and long-range)
  const sog = numField(body.Sog ?? body.SOG ?? body.sog ?? meta.Sog);
  const cog = numField(
    body.Cog ?? body.COG ?? body.cog ?? body.TrueHeading ?? body.Heading,
  );

  upsert({
    mmsi,
    name: nameFromMeta || nameFromBody,
    lat: lat ?? undefined,
    lon: lon ?? undefined,
    sog,
    cog,
  });
}

function clearReconnectTimer(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(reason?: string): void {
  if (!apiKey()) return;
  if (reconnectTimer) return;
  if (reason) {
    console.warn(`[tradehole] AISStream Cyprus reconnect: ${reason}`);
  }
  const delay = Math.min(
    RECONNECT_MAX_MS,
    RECONNECT_BASE_MS * Math.pow(1.55, reconnectAttempt),
  );
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect({ force: true });
  }, delay);
}

function softClose(): void {
  const sock = ws;
  ws = null;
  if (!sock) return;
  try {
    sock.close();
  } catch {
    /* ignore */
  }
}

function connect(opts?: { force?: boolean }): void {
  const key = apiKey();
  if (!key) return;
  if (
    !opts?.force &&
    ws &&
    (ws.readyState === WS.OPEN || ws.readyState === WS.CONNECTING)
  ) {
    return;
  }

  clearReconnectTimer();
  if (opts?.force) softClose();

  connecting = true;
  connectingSince = Date.now();
  lastError = null;
  subscribedAt = null;
  let socket: AisWs;
  try {
    socket = new WS(WS_URL);
    ws = socket;
    // Prefer ArrayBuffer over Blob when the runtime supports it.
    try {
      (socket as AisWs & { binaryType?: string }).binaryType = "arraybuffer";
    } catch {
      /* optional */
    }
  } catch (err) {
    connecting = false;
    connectingSince = null;
    lastError = String(err);
    scheduleReconnect("constructor failed");
    return;
  }

  // Serialize async Blob/ArrayBuffer decoding so vessel upserts stay ordered.
  let messageChain: Promise<void> = Promise.resolve();

  socket.addEventListener("open", () => {
    connecting = false;
    connectingSince = null;
    reconnectAttempt = 0;
    const sub = {
      APIKey: key,
      BoundingBoxes: AIS_WATCH_BOXES.map((b) => [
        [b.latMin, b.lonMin],
        [b.latMax, b.lonMax],
      ]),
      // Omit FilterMessageTypes → all types in box (better density on free Med).
    };
    try {
      socket.send(JSON.stringify(sub));
      subscribedAt = Date.now();
      console.log(
        "[tradehole] AISStream subscribed Cyprus + Hormuz + Bab (NAV-01 still Cyprus-only)",
      );
    } catch (err) {
      lastError = String(err);
      softClose();
      scheduleReconnect("subscribe send failed");
    }
  });

  socket.addEventListener("message", (ev) => {
    messageChain = messageChain
      .then(async () => {
        const data = await wsDataToText(ev.data);
        handleMessage(data);
      })
      .catch(() => undefined);
  });

  socket.addEventListener("error", () => {
    connecting = false;
    connectingSince = null;
    lastError = lastError ?? "AISStream WebSocket error";
    // Close usually follows; if not, watchdog/reconnect covers it.
  });

  socket.addEventListener("close", () => {
    connecting = false;
    connectingSince = null;
    if (ws === socket) ws = null;
    scheduleReconnect("socket closed");
  });
}

function runWatchdog(): void {
  if (!apiKey()) return;
  const now = Date.now();
  if (connecting) return;

  // Open but silent too long → force reconnect.
  if (
    ws &&
    ws.readyState === WS.OPEN &&
    lastMessageAt != null &&
    now - lastMessageAt > STALE_RECONNECT_MS
  ) {
    lastError = `No AIS messages for ${Math.round((now - lastMessageAt) / 1000)}s — reconnecting`;
    scheduleReconnect("stale open socket");
    softClose();
    return;
  }

  // Subscribed, never got a message, past grace → reconnect once.
  if (
    ws &&
    ws.readyState === WS.OPEN &&
    lastMessageAt == null &&
    subscribedAt != null &&
    now - subscribedAt > EMPTY_GRACE_MS * 2
  ) {
    lastError = "Subscribed but zero messages — reconnecting";
    scheduleReconnect("zero messages after subscribe");
    softClose();
    return;
  }

  // No socket and not connecting → reconnect.
  if (!ws && !reconnectTimer) {
    scheduleReconnect("no socket");
  }
}

/** Start background collector when AISSTREAM_API_KEY is set. */
export function startCyprusAisCollector(): void {
  if (started) return;
  started = true;
  if (!apiKey()) {
    console.log(
      "[tradehole] AISStream: disabled (set AISSTREAM_API_KEY for Cyprus/Hormuz/Bab AIS)",
    );
    return;
  }
  connect();
  setInterval(() => prune(), 60_000).unref?.();
  if (!watchdogTimer) {
    watchdogTimer = setInterval(() => runWatchdog(), 30_000);
    watchdogTimer.unref?.();
  }
}

function statusNote(
  enabled: boolean,
  status: CyprusAisStatus,
  error: string | null,
  statusAgeSec: number | null,
): string {
  const base =
    "AISStream.io free WebSocket (personal key). Cyprus + Hormuz + Bab boxes. Community terrestrial AIS — warships often dark; not MarineTraffic. NAV-01 uses Cyprus navy-like only.";
  const ageBit =
    statusAgeSec != null && statusAgeSec > 0 ? ` (${statusAgeSec}s)` : "";
  if (!enabled) {
    return `${base} KEY UNSET — set AISSTREAM_API_KEY (aisstream.io free signup). Deep links remain backup only.`;
  }
  if (status === "connecting") {
    return `${base} Connecting / waiting for first position in watch boxes${ageBit}…`;
  }
  if (status === "error") {
    return `${base} ERROR${error ? `: ${error}` : ""}${ageBit} — auto-reconnect armed.`;
  }
  if (status === "empty") {
    return `${base} FEED EMPTY in box (auto)${ageBit} — not quiet confirmation; warships often AIS-dark. Deep links are backup.`;
  }
  if (status === "stale") {
    return `${base} STALE — last message aged out; reconnecting. Not quiet confirmation.`;
  }
  if (status === "live") {
    return `${base} LIVE — navy-like count auto-updates NAV-01 when mil/name-interest vessels appear.`;
  }
  return base;
}

export function getCyprusAisSnapshot(): CyprusAisSnapshot {
  const enabled = Boolean(apiKey());
  prune();

  if (!enabled) {
    return {
      enabled: false,
      status: "disabled",
      source: "aisstream",
      error: null,
      asOf: null,
      messageCount: 0,
      totalInBox: 0,
      militaryCount: 0,
      tankerCount: 0,
      interestCount: 0,
      navyLikeCount: 0,
      vessels: [],
      bbox: CYPRUS_AIS_BBOX,
      note: statusNote(false, "disabled", null, null),
      statusAgeSec: null,
    };
  }

  const vessels: CyprusAisVessel[] = [];
  let militaryCount = 0;
  let tankerCount = 0;
  let interestCount = 0;
  let totalInBox = 0;

  for (const t of tracks.values()) {
    if (t.lat == null || t.lon == null) continue;
    if (matchAisWatchBox(t.lat, t.lon) !== "cyprus") continue;
    totalInBox += 1;
    const cat = categorize(t.shipType, t.name);
    if (cat === "military") militaryCount += 1;
    else if (cat === "tanker") tankerCount += 1;
    else if (cat === "interest") interestCount += 1;
    if (cat === "other") continue;
    vessels.push({
      mmsi: t.mmsi,
      name: t.name || `MMSI ${t.mmsi}`,
      shipType: t.shipType,
      shipTypeLabel: shipTypeLabel(t.shipType),
      category: cat,
      lat: t.lat,
      lon: t.lon,
      sog: t.sog,
      cog: t.cog,
      updatedAt: new Date(t.updatedAtMs).toISOString(),
    });
  }

  vessels.sort((a, b) => {
    const rank = (c: CyprusAisCategory) =>
      c === "military" ? 0 : c === "interest" ? 1 : c === "tanker" ? 2 : 3;
    const d = rank(a.category) - rank(b.category);
    if (d !== 0) return d;
    return a.name.localeCompare(b.name);
  });

  const navyLikeCount = militaryCount + interestCount;
  const ageMs = lastMessageAt != null ? Date.now() - lastMessageAt : null;
  const sinceSubMs =
    subscribedAt != null ? Date.now() - subscribedAt : null;
  const connectingAgeMs =
    connectingSince != null ? Date.now() - connectingSince : null;
  const inEmptyGrace =
    sinceSubMs != null && sinceSubMs < EMPTY_GRACE_MS && totalInBox === 0;
  const connectingTimedOut =
    connecting &&
    connectingAgeMs != null &&
    connectingAgeMs > CONNECTING_TIMEOUT_MS;

  // Hung CONNECTING → ERROR + force reconnect so UI doesn't look stuck forever.
  if (connectingTimedOut) {
    lastError = `CONNECTING timeout after ${Math.round((connectingAgeMs ?? 0) / 1000)}s — reconnecting`;
    connecting = false;
    connectingSince = null;
    softClose();
    scheduleReconnect("connecting timeout");
  }

  let status: CyprusAisStatus;
  let statusAgeSec: number | null = null;
  if (connectingTimedOut || (lastError && tracks.size === 0 && totalInBox === 0 && !connecting && !inEmptyGrace)) {
    status = "error";
    statusAgeSec =
      connectingAgeMs != null
        ? Math.round(connectingAgeMs / 1000)
        : ageMs != null
          ? Math.round(ageMs / 1000)
          : null;
  } else if (connecting || inEmptyGrace) {
    status = "connecting";
    const waitMs =
      connectingAgeMs ??
      (sinceSubMs != null ? sinceSubMs : null);
    statusAgeSec = waitMs != null ? Math.round(waitMs / 1000) : null;
  } else if (ageMs != null && ageMs > 10 * 60 * 1000) {
    status = "stale";
    statusAgeSec = Math.round(ageMs / 1000);
  } else if (totalInBox === 0) {
    status = "empty";
    statusAgeSec =
      sinceSubMs != null
        ? Math.round(sinceSubMs / 1000)
        : ageMs != null
          ? Math.round(ageMs / 1000)
          : null;
  } else {
    status = "live";
    statusAgeSec = ageMs != null ? Math.round(ageMs / 1000) : 0;
  }

  return {
    enabled: true,
    status,
    source: "aisstream",
    error: lastError,
    asOf: lastMessageAt ? new Date(lastMessageAt).toISOString() : null,
    messageCount,
    totalInBox,
    militaryCount,
    tankerCount,
    interestCount,
    navyLikeCount,
    vessels: vessels.slice(0, MAX_LIST),
    bbox: CYPRUS_AIS_BBOX,
    note: statusNote(true, status, lastError, statusAgeSec),
    statusAgeSec,
  };
}

const MAX_THEATER_LIST = 32;

/** Hormuz + Bab AIS — plot only. Never feeds NAV-01 / Israel High-go. */
export function getTheaterAisSnapshot(): TheaterAisSnapshot {
  const cyprus = getCyprusAisSnapshot();
  const boxIds = ["hormuz", "bab"] as const;
  const boxes = boxIds.map((id) => {
    const def = AIS_WATCH_BOXES.find((b) => b.id === id)!;
    return {
      id,
      label: def.label,
      latMin: def.latMin,
      latMax: def.latMax,
      lonMin: def.lonMin,
      lonMax: def.lonMax,
      totalInBox: 0,
      militaryCount: 0,
      tankerCount: 0,
      interestCount: 0,
    };
  });
  const boxById = new Map(boxes.map((b) => [b.id, b]));

  if (!cyprus.enabled) {
    return {
      enabled: false,
      status: "disabled",
      error: null,
      asOf: null,
      vessels: [],
      boxes,
      note: cyprus.note,
    };
  }

  prune();
  const vessels: TheaterAisVessel[] = [];
  for (const t of tracks.values()) {
    if (t.lat == null || t.lon == null) continue;
    const boxId = matchAisWatchBox(t.lat, t.lon);
    if (boxId !== "hormuz" && boxId !== "bab") continue;
    const box = boxById.get(boxId);
    if (box) box.totalInBox += 1;
    const cat = categorize(t.shipType, t.name);
    if (cat === "military" && box) box.militaryCount += 1;
    else if (cat === "tanker" && box) box.tankerCount += 1;
    else if (cat === "interest" && box) box.interestCount += 1;
    if (cat === "other") continue;
    vessels.push({
      mmsi: t.mmsi,
      name: t.name || `MMSI ${t.mmsi}`,
      shipType: t.shipType,
      shipTypeLabel: shipTypeLabel(t.shipType),
      category: cat,
      lat: t.lat,
      lon: t.lon,
      sog: t.sog,
      cog: t.cog,
      updatedAt: new Date(t.updatedAtMs).toISOString(),
      boxId,
    });
  }
  vessels.sort((a, b) => {
    const rank = (c: CyprusAisCategory) =>
      c === "military" ? 0 : c === "interest" ? 1 : c === "tanker" ? 2 : 3;
    const d = rank(a.category) - rank(b.category);
    if (d !== 0) return d;
    return a.name.localeCompare(b.name);
  });
  const mil = boxes.reduce((n, b) => n + b.militaryCount, 0);
  const tank = boxes.reduce((n, b) => n + b.tankerCount, 0);
  const note = `Hormuz/Bab AIS ${cyprus.status} · mil ${mil} · tanker ${tank} · plot-only (not NAV-01).`;
  return {
    enabled: true,
    status: cyprus.status,
    error: cyprus.error,
    asOf: cyprus.asOf,
    vessels: vessels.slice(0, MAX_THEATER_LIST),
    boxes,
    note,
  };
}
