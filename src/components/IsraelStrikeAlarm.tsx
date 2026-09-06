import { useCallback, useEffect, useRef, useState } from "react";
import {
  resumeAlarmAudio,
  startOrderAlarm,
  stopOrderAlarm,
} from "../lib/orderAlarmSound";
import { useDashboardStore } from "../store/dashboard";
import type { IsraelStrikeTells } from "../types";

const LADDER_STORAGE_KEY = "tradehole.israelStrike.ladderNotified";
/** Soft elevated rung before HOT (≥3). */
const TANKER_ELEVATED = 2;
const TANKER_HOT = 3;

type EdgeFlags = {
  aer01Hot: boolean;
  highGo: boolean;
  nav01Hot: boolean;
  aerElevated2: boolean;
  awacsElevated: boolean;
  goLanguage: boolean;
  iranBlackout: boolean;
  firmsSpike: boolean;
  strategicPressure: boolean;
};

type LadderPersisted = {
  /** Highest tanker ladder step already alerted this episode (0 / 2 / 3). */
  tankerStep: 0 | 2 | 3;
  awacsElevated: boolean;
  goLanguage: boolean;
  iranBlackout: boolean;
  firmsSpike: boolean;
  strategicPressure: boolean;
};

type AlarmPayload = {
  edges: string[];
  headline: string;
  detail: string;
  score: number;
  statusLabel: string;
  froGuidance: string;
  severity: "critical" | "soft";
};

function tankerStep(n: number | null | undefined): 0 | 2 | 3 {
  if (n == null) return 0;
  if (n >= TANKER_HOT) return 3;
  if (n >= TANKER_ELEVATED) return 2;
  return 0;
}

function loadLadder(): LadderPersisted {
  try {
    const raw = sessionStorage.getItem(LADDER_STORAGE_KEY);
    if (!raw)
      return {
        tankerStep: 0,
        awacsElevated: false,
        goLanguage: false,
        iranBlackout: false,
        firmsSpike: false,
        strategicPressure: false,
      };
    const parsed = JSON.parse(raw) as Partial<LadderPersisted>;
    const step = parsed.tankerStep;
    return {
      tankerStep: step === 3 || step === 2 ? step : 0,
      awacsElevated: parsed.awacsElevated === true,
      goLanguage: parsed.goLanguage === true,
      iranBlackout: parsed.iranBlackout === true,
      firmsSpike: parsed.firmsSpike === true,
      strategicPressure: parsed.strategicPressure === true,
    };
  } catch {
    return {
      tankerStep: 0,
      awacsElevated: false,
      goLanguage: false,
      iranBlackout: false,
      firmsSpike: false,
      strategicPressure: false,
    };
  }
}

function saveLadder(next: LadderPersisted): void {
  try {
    sessionStorage.setItem(LADDER_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function edgeFlags(data: IsraelStrikeTells): EdgeFlags {
  const aer = data.tells.find((t) => t.id === "AER-01");
  const nav = data.tells.find((t) => t.id === "NAV-01");
  const go = data.tells.find((t) => t.id === "GO-01");
  const cyber = data.tells.find((t) => t.id === "CYBER-01");
  const firms = data.tells.find((t) => t.id === "FIRMS-01");
  const stratIds = ["POL-02", "POL-03", "STRAT-01", "STRAT-02", "DIP-03"];
  const stratLit = data.tells.some(
    (t) =>
      stratIds.includes(t.id) && (t.status === "hot" || t.status === "warm"),
  );
  const tankers = data.inputs.aerialTankersLevant ?? 0;
  const awacs = data.inputs.aerialAwacsLevant ?? 0;
  return {
    aer01Hot: aer?.status === "hot",
    highGo: data.scenario === "high_confidence_go",
    nav01Hot: nav?.status === "hot",
    aerElevated2: tankers >= TANKER_ELEVATED && tankers < TANKER_HOT,
    awacsElevated: awacs >= 1 && tankers >= 1,
    goLanguage: go?.status === "hot" || go?.status === "warm",
    iranBlackout: cyber?.status === "hot" || cyber?.status === "warm",
    firmsSpike: firms?.status === "hot" || firms?.status === "warm",
    strategicPressure: stratLit,
  };
}

function risingCritical(prev: EdgeFlags, next: EdgeFlags): string[] {
  const edges: string[] = [];
  if (next.aer01Hot && !prev.aer01Hot) edges.push("AER-01 HOT (≥3 tankers)");
  if (next.highGo && !prev.highGo) edges.push("High-go (hard gates)");
  if (next.nav01Hot && !prev.nav01Hot) edges.push("NAV-01 HOT");
  return edges;
}

function anyCritical(f: EdgeFlags): boolean {
  return f.aer01Hot || f.highGo || f.nav01Hot;
}

function buildPayload(
  data: IsraelStrikeTells,
  edges: string[],
  severity: "critical" | "soft",
): AlarmPayload {
  const aer = data.tells.find((t) => t.id === "AER-01");
  const nav = data.tells.find((t) => t.id === "NAV-01");
  const tankers = data.inputs.aerialTankersLevant;
  const awacs = data.inputs.aerialAwacsLevant;
  const bits = [
    edges.join(" · "),
    `score ${data.score}/100`,
    tankers != null ? `tankers ${tankers}/${TANKER_HOT}` : null,
    awacs != null ? `AWACS ${awacs}` : null,
    aer?.status ? `AER ${aer.status}` : null,
    nav?.status ? `NAV ${nav.status}` : null,
  ].filter(Boolean);
  return {
    edges,
    headline: edges[0] ?? "Israel strike tell",
    detail: bits.join(" · "),
    score: data.score,
    statusLabel: data.statusLabel,
    froGuidance: data.froGuidance,
    severity,
  };
}

function chipLabel(data: IsraelStrikeTells, flags: EdgeFlags): string {
  const tankers = data.inputs.aerialTankersLevant;
  const awacs = data.inputs.aerialAwacsLevant;
  const tankerBit =
    tankers != null ? `tankers ${tankers}/${TANKER_HOT}` : "tankers —";
  const awacsBit = awacs != null && awacs > 0 ? ` · AWACS ${awacs}` : "";
  if (anyCritical(flags)) {
    const hotLabel = [
      flags.aer01Hot ? "AER HOT" : null,
      flags.highGo ? "High-go" : null,
      flags.nav01Hot ? "NAV HOT" : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return `Strike · ${hotLabel} · ${tankerBit}${awacsBit} · ${data.score}`;
  }
  if (flags.aerElevated2 || flags.awacsElevated) {
    return `Strike elevated · ${tankerBit}${awacsBit} · need ≥${TANKER_HOT} for HOT · ${data.score}`;
  }
  if (flags.goLanguage) {
    return `GO-01 go-language · soft wake · ${tankerBit} · ${data.score}`;
  }
  if (flags.strategicPressure) {
    return `Strategic pressure soft · ${tankerBit} · ${data.score}`;
  }
  if (flags.iranBlackout || flags.firmsSpike) {
    const bits = [
      flags.iranBlackout ? "blackout" : null,
      flags.firmsSpike ? "FIRMS" : null,
    ]
      .filter(Boolean)
      .join("+");
    return `Soft elevated · ${bits} · ${tankerBit} · ${data.score}`;
  }
  return `Strike watch · ${tankerBit}${awacsBit} · ${data.score}/100`;
}

/**
 * Edge-triggered wake-up for Israel Strike pre-launch tells.
 * Soft: first 2-tanker rung / AWACS while tankers elevated.
 * Critical: AER-01 → hot (≥3), High-go, NAV-01 → hot.
 * Consumes shared App poller via dashboard store (no duplicate fetch).
 */
export function IsraelStrikeAlarm() {
  const data = useDashboardStore((s) => s.israelStrike);
  const [payload, setPayload] = useState<AlarmPayload | null>(null);
  const [alerting, setAlerting] = useState(false);
  const [chip, setChip] = useState<string | null>(null);
  const primedRef = useRef(false);
  const flagsRef = useRef<EdgeFlags>({
    aer01Hot: false,
    highGo: false,
    nav01Hot: false,
    aerElevated2: false,
    awacsElevated: false,
    goLanguage: false,
    iranBlackout: false,
    firmsSpike: false,
    strategicPressure: false,
  });
  const ladderRef = useRef<LadderPersisted>(loadLadder());
  const titleRef = useRef(document.title);
  const flashRef = useRef<number | null>(null);

  const dismiss = useCallback(() => {
    setAlerting(false);
    setPayload(null);
    stopOrderAlarm();
    if (flashRef.current != null) {
      window.clearInterval(flashRef.current);
      flashRef.current = null;
    }
    document.title = titleRef.current;
  }, []);

  const fire = useCallback((next: AlarmPayload) => {
    setPayload(next);
    setAlerting(true);
    const soft = next.severity === "soft";
    void startOrderAlarm({ soft });
    // Soft = informational dock bounce; critical = wake-up bounce.
    void window.tradehole?.alertOrderFill?.(!soft);
    try {
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        new Notification(
          soft ? "ISRAEL STRIKE ELEVATED" : "ISRAEL STRIKE TELL",
          {
            body: `${next.headline} · ${next.detail}`,
            requireInteraction: true,
            silent: true,
          },
        );
      } else if (
        typeof Notification !== "undefined" &&
        Notification.permission === "default"
      ) {
        void Notification.requestPermission();
      }
    } catch {
      /* ignore */
    }
    titleRef.current = document.title;
    let on = false;
    if (flashRef.current != null) window.clearInterval(flashRef.current);
    const flashTitle = soft
      ? `🟡 ${next.edges[0] ?? "STRIKE ELEVATED"}`
      : `🚨 ${next.edges[0] ?? "STRIKE TELL"}`;
    flashRef.current = window.setInterval(() => {
      on = !on;
      document.title = on ? flashTitle : titleRef.current;
    }, 700);
  }, []);

  useEffect(() => {
    if (!data) return;

    const flags = edgeFlags(data);
    setChip(chipLabel(data, flags));

    const step = tankerStep(data.inputs.aerialTankersLevant);
    const ladder = ladderRef.current;

    // De-escalation: rewind persisted steps so a later climb can re-alert.
    // Quiet status only — no panic siren.
    let ladderDirty = false;
    if (step < ladder.tankerStep) {
      ladder.tankerStep = step;
      ladderDirty = true;
    }
    if (!flags.awacsElevated && ladder.awacsElevated) {
      ladder.awacsElevated = false;
      ladderDirty = true;
    }
    if (ladderDirty) {
      ladderRef.current = { ...ladder };
      saveLadder(ladderRef.current);
    }

    if (!primedRef.current) {
      primedRef.current = true;
      flagsRef.current = flags;
      // Seed ladder from live state so refresh doesn't re-siren same rung.
      ladderRef.current = {
        tankerStep: step,
        awacsElevated: flags.awacsElevated,
        goLanguage: flags.goLanguage,
        iranBlackout: flags.iranBlackout,
        firmsSpike: flags.firmsSpike,
        strategicPressure: flags.strategicPressure,
      };
      saveLadder(ladderRef.current);
      if (typeof Notification !== "undefined") {
        if (Notification.permission === "default") {
          void Notification.requestPermission();
        }
      }
      // Already hot on mount → overlay OK, no spam siren (shekel pattern).
      if (anyCritical(flags)) {
        const edges: string[] = [];
        if (flags.aer01Hot) edges.push("AER-01 HOT (≥3 tankers)");
        if (flags.highGo) edges.push("High-go (hard gates)");
        if (flags.nav01Hot) edges.push("NAV-01 HOT");
        setPayload(buildPayload(data, edges, "critical"));
        setAlerting(true);
      } else if (
        flags.aerElevated2 ||
        flags.awacsElevated ||
        flags.goLanguage ||
        flags.iranBlackout ||
        flags.firmsSpike ||
        flags.strategicPressure
      ) {
        // Elevated on mount — chip only, no soft spam.
        setChip(chipLabel(data, flags));
      }
      return;
    }

    const criticalRising = risingCritical(flagsRef.current, flags);
    const softEdges: string[] = [];

    // Tanker ladder: only alert on upward transitions not yet notified.
    if (step > ladder.tankerStep) {
      if (step === 2) {
        softEdges.push(
          `AER elevated · ${data.inputs.aerialTankersLevant} tankers · need ≥${TANKER_HOT} for HOT`,
        );
      }
      // step === 3 covered by critical AER-01 HOT edge (dedupe).
      ladder.tankerStep = step;
      ladderRef.current = { ...ladder };
      saveLadder(ladderRef.current);
    }

    if (flags.awacsElevated && !ladder.awacsElevated) {
      softEdges.push(
        `AWACS ≥1 with tankers elevated (${data.inputs.aerialTankersLevant ?? "?"} tankers)`,
      );
      ladder.awacsElevated = true;
      ladderRef.current = { ...ladder };
      saveLadder(ladderRef.current);
    }

    if (flags.goLanguage && !ladder.goLanguage) {
      softEdges.push(
        "GO-01 Hebrew/Home Front go-language — soft wake · not High-go alone",
      );
      ladder.goLanguage = true;
      ladderRef.current = { ...ladder };
      saveLadder(ladderRef.current);
    }

    if (flags.iranBlackout && !ladder.iranBlackout) {
      softEdges.push("CYBER-01 Iran blackout chatter — soft elevated · not a go gate");
      ladder.iranBlackout = true;
      ladderRef.current = { ...ladder };
      saveLadder(ladderRef.current);
    }

    if (flags.firmsSpike && !ladder.firmsSpike) {
      softEdges.push("FIRMS-01 thermal soft wake — corroborate map · not a go gate");
      ladder.firmsSpike = true;
      ladderRef.current = { ...ladder };
      saveLadder(ladderRef.current);
    }

    if (flags.strategicPressure && !ladder.strategicPressure) {
      softEdges.push(
        "Strategic pressure soft (Mossad/Iran doctrine/IDF recovery) — not High-go alone",
      );
      ladder.strategicPressure = true;
      ladderRef.current = { ...ladder };
      saveLadder(ladderRef.current);
    }

    if (criticalRising.length > 0) {
      fire(buildPayload(data, criticalRising, "critical"));
    } else if (softEdges.length > 0) {
      fire(buildPayload(data, softEdges, "soft"));
    }

    flagsRef.current = flags;
  }, [data, fire]);

  useEffect(() => {
    return () => {
      stopOrderAlarm();
      if (flashRef.current != null) window.clearInterval(flashRef.current);
      document.title = titleRef.current;
    };
  }, []);

  return (
    <>
      {chip && !alerting && (
        <button
          type="button"
          className="israel-strike-watch-chip"
          title="Israel strike pre-launch watch — auto-polls with Markets desk · app must stay open for siren"
          onClick={() => {
            void resumeAlarmAudio();
          }}
        >
          {chip}
        </button>
      )}

      {alerting && payload && (
        <div
          className={`fill-alarm-overlay israel-strike-alarm${
            payload.severity === "soft" ? " soft" : ""
          }`}
          role="alertdialog"
          aria-modal="true"
          onClick={() => {
            void resumeAlarmAudio().then(() =>
              void startOrderAlarm({ soft: payload.severity === "soft" }),
            );
          }}
        >
          <div className="fill-alarm-card">
            <p className="fill-alarm-eyebrow">
              {payload.severity === "soft"
                ? "Israel strike elevated"
                : "Israel strike pre-launch"}
            </p>
            <h2>{payload.headline}</h2>
            <p className="fill-alarm-order">{payload.detail}</p>
            <p className="fill-alarm-detail">{payload.statusLabel}</p>
            <p className="fill-alarm-detail">{payload.froGuidance}</p>
            <p className="fill-alarm-detail">
              Edge-triggered only (ladder / quiet→hot). Siren needs Tradehole
              open (Electron renderer) — not a background OS daemon. No
              auto-trade.
            </p>
            <button
              type="button"
              className="primary fill-alarm-dismiss"
              onClick={(e) => {
                e.stopPropagation();
                dismiss();
              }}
            >
              Dismiss alarm
            </button>
          </div>
        </div>
      )}
    </>
  );
}
