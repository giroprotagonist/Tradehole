/** Black–Scholes helpers for dealer GEX when broker gamma is missing. */

const SQRT_2PI = Math.sqrt(2 * Math.PI);

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

function normCdf(x: number): number {
  // Abramowitz–Stegun approximation
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return sign === 1 ? 1 - p : p;
}

function toVol(iv: number): number {
  // Accept 0.55 or 55
  return iv > 2 ? iv / 100 : iv;
}

export function yearsToExpiry(expiry: string, from = new Date()): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiry);
  if (!m) return 0;
  const exp = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const days = Math.max(0, (exp - now) / 86_400_000);
  return Math.max(days / 365, 1 / 365);
}

export function bsD1(
  spot: number,
  strike: number,
  t: number,
  iv: number,
  r = 0.045,
): number | null {
  const vol = toVol(iv);
  if (!(spot > 0 && strike > 0 && t > 0 && vol > 0)) return null;
  return (Math.log(spot / strike) + (r + 0.5 * vol * vol) * t) / (vol * Math.sqrt(t));
}

/** Per-share gamma (multiply by 100 for contract). */
export function bsGamma(
  spot: number,
  strike: number,
  t: number,
  iv: number,
  r = 0.045,
): number | null {
  const d1 = bsD1(spot, strike, t, iv, r);
  if (d1 == null) return null;
  const vol = toVol(iv);
  return normPdf(d1) / (spot * vol * Math.sqrt(t));
}

export function bsDelta(
  spot: number,
  strike: number,
  t: number,
  iv: number,
  type: "call" | "put",
  r = 0.045,
): number | null {
  const d1 = bsD1(spot, strike, t, iv, r);
  if (d1 == null) return null;
  return type === "call" ? normCdf(d1) : normCdf(d1) - 1;
}

/**
 * Dealer GEX convention (spot-scaled, per strike, calls positive / puts negative
 * under the usual "dealers short customer long" assumption):
 * GEX = gamma * OI * 100 * spot  (call + / put −)
 */
export function dealerGex(
  gammaPerShare: number,
  oi: number,
  spot: number,
  type: "call" | "put",
): number {
  const raw = gammaPerShare * oi * 100 * spot;
  return type === "call" ? raw : -raw;
}
