/**
 * Shared ADS-B type/callsign classifiers for tanker / AWACS.
 * Keep ICAO codes exact — substring matches false-positive bizjets
 * (e.g. E35L Embraer Legacy 600 matched old /E-?3/ as "AWACS").
 */

/** Known airlift ICAO types — AMC Reach (RCH) C-17/C-5/C-130 must not score as KC. */
function isKnownAirliftType(type: string): boolean {
  const t = type.toUpperCase().replace(/[-\s]/g, "");
  return /^(C17|C5|C5M|C5A|C5B|C5C|C130|C130J|C30J|C27J|A400|A400M|G222|Y8|Y9)$/.test(
    t,
  );
}

/** KC-135 / KC-46 / KC-10. RCH/Reach callsign only if type is unknown or tanker — not C-17 airlift. */
export function isAerialTanker(
  type: string,
  desc: string,
  callsign: string,
): boolean {
  const t = type.toUpperCase();
  const d = desc.toLowerCase();
  const cs = callsign.toUpperCase().trim();
  if (/KC.?135|KC135|K35R|KC35/.test(t)) return true;
  if (/KC.?46|KC46|K46A/.test(t)) return true;
  if (/KC.?10|KC10/.test(t)) return true;
  if (/KC.?707|B707|707/.test(t) && /tanker|refuel/i.test(d + cs)) return true;
  if (d.includes("tanker") || d.includes("stratotanker")) return true;
  if (isKnownAirliftType(type)) return false;
  if (/^RCH|^REACH|^BLUE\d|^SHELL|^TEXACO|^ESSO/.test(cs)) return true;
  return false;
}

/**
 * E-3 Sentry / E-7 Wedgetail only — NOT Embraer Legacy (E35L / E35B),
 * Phenom, or other E3* bizjet ICAO codes.
 */
export function isAwacs(
  type: string,
  desc: string,
  callsign = "",
): boolean {
  const t = type.toUpperCase().trim();
  const d = desc.toLowerCase();
  const cs = callsign.toUpperCase().trim();
  // Exact type codes only (adsb.lol / OpenSky `t` field).
  if (
    /^(E3|E-3|E3A|E3B|E3C|E3D|E3TF|E3CF|E7|E-7|E7A|E7B)$/.test(t)
  ) {
    return true;
  }
  if (
    d.includes("sentry") ||
    d.includes("wedgetail") ||
    /\bawacs\b/.test(d)
  ) {
    return true;
  }
  // OpenSky failover often has no type — callsign-only soft match.
  if (/^(NATO|AWACS|SENTRY|MAGIC|FORTE)/.test(cs)) return true;
  return false;
}

/** Airliners / VIP / EMS / firefighting — mil dbFlags must not enroll these. */
export function isCivOrVipAirframe(type: string): boolean {
  const t = type.toUpperCase().replace(/[-\s]/g, "");
  if (!t) return false;
  if (/^B7[0-8]/.test(t)) return true;
  if (/^A3[0-58]/.test(t)) return true;
  if (/^E35/.test(t)) return true;
  if (/^(A139|A169|A189|EC35|EC45|EC55|CL2T|CL2P|P180|P18)/.test(t)) return true;
  if (/^(E75|E19|E55|CRJ|DH8|AT7|GLF|GL5|GLEX|GA6C|C56X|C68A|C25B|C25C|C700|F2TH|FA7X|FA8X|H25B|LJ60|PC12|PC24|TBM|BE20|B350)$/.test(t)) {
    return true;
  }
  return false;
}

/**
 * Types worth a global hex follow: tankers, AWACS, airlift, combat/ISR.
 * Not UAE 777s, AW139s, or CL-415s that happen to carry a mil flag.
 */
export function isFollowWorthyMil(
  type: string,
  desc: string,
  callsign: string,
): boolean {
  if (isAerialTanker(type, desc, callsign)) return true;
  if (isAwacs(type, desc, callsign)) return true;
  if (isKnownAirliftType(type)) return true;
  const t = type.toUpperCase().replace(/[-\s]/g, "");
  if (
    /^(F15|F15E|F16|F18|FA18|F22|F35|F5|A10|B1|B1B|B2|B52|TU95|TU22|MIG29|SU24|SU25|SU27|SU30|SU34|SU35|J10|J20|MQ9|MQ1|Q9|RQ4|U2|P8|P3|E2|E2C|E2D|E8|E8C|RC135|R135|WC135|OC135|H60|HH60|MH60|SH60|AH64|AH1|UH1|UH60|CH47|CH53|V22|C2|K35R|K46A|KC10)$/.test(
      t,
    )
  ) {
    return true;
  }
  const cs = callsign.toUpperCase().trim();
  if (
    /^(RCH|REACH|NAVY|CNVRY|DUKE|NATO|MAGIC|FORTE|SHELL|TEXACO|ESSO|BLUE\d|MOOSE|RAAD|IAF)/.test(
      cs,
    )
  ) {
    return true;
  }
  return false;
}
export function classifyAerialKind(
  type: string,
  desc: string,
  callsign: string,
  fallback: "tanker" | "awacs" | "mil" = "mil",
): "tanker" | "awacs" | "mil" {
  if (isAerialTanker(type, desc, callsign)) return "tanker";
  if (isAwacs(type, desc, callsign)) return "awacs";
  return fallback === "tanker" || fallback === "awacs" ? "mil" : fallback;
}
