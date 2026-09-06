/**
 * Fail-fast IRONSIGHT liveness. StatusBar already knows when :3170 is down;
 * heavy rebuilds must not sit on 8–12s panel timeouts for 90s.
 */
const PROBE_TIMEOUT_MS = 1_500;
const DOWN_TTL_MS = 20_000;
const UP_TTL_MS = 8_000;

type Probe = { at: number; up: boolean };

let probe: Probe | null = null;

function ironsightBase(): string {
  return (process.env.IRONSIGHT_URL ?? "http://localhost:3170").replace(
    /\/$/,
    "",
  );
}

export function ironsightKnownDown(): boolean {
  return Boolean(
    probe && !probe.up && Date.now() - probe.at < DOWN_TTL_MS,
  );
}

export function _setIronsightProbeForTests(up: boolean | null): void {
  probe = up == null ? null : { at: Date.now(), up };
}

export async function probeIronsight(): Promise<boolean> {
  const now = Date.now();
  if (probe) {
    const ttl = probe.up ? UP_TTL_MS : DOWN_TTL_MS;
    if (now - probe.at < ttl) return probe.up;
  }
  try {
    const res = await fetch(ironsightBase(), {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    probe = { at: Date.now(), up: res.ok };
  } catch {
    probe = { at: Date.now(), up: false };
  }
  return probe.up;
}

/** JSON GET against IRONSIGHT. Returns null immediately when known down. */
export async function fetchIfIronsightUp(
  path: string,
  timeoutMs: number,
): Promise<Response | null> {
  if (ironsightKnownDown()) return null;
  const up = await probeIronsight();
  if (!up) return null;
  const p = path.startsWith("/") ? path : `/${path}`;
  try {
    return await fetch(`${ironsightBase()}${p}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // Panel timeout / heavy news payload must NOT mark the whole host down.
    // That falsely painted ELEC-01 / PIKUD-01 / GO-01 as "IRONSIGHT offline"
    // while theater paths still saw :3170 healthy.
    return null;
  }
}
