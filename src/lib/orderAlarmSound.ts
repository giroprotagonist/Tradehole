/** Loud looping siren via Web Audio — no asset files. */

let ctx: AudioContext | null = null;
let timer: number | null = null;
let step = 0;
/** "critical" = full wake-up; "soft" = yellow / informational loop. */
let mode: "critical" | "soft" | null = null;

export type AlarmSoundOpts = {
  /** Softer, slower loop (5-Lock YELLOW). Default critical. */
  soft?: boolean;
  /**
   * Restart even if already looping. Default: skip restart when same mode
   * already playing (avoids triple-siren when RED + AER-hot fire together).
   */
  forceRestart?: boolean;
};

function getCtx(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
  }
  return ctx;
}

function beep(freq: number, durationMs: number, gain = 0.55): void {
  const ac = getCtx();
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  g.gain.value = gain;
  // Quick attack / release to avoid clicks
  const now = ac.currentTime;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(gain, now + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
  osc.connect(g);
  g.connect(ac.destination);
  osc.start(now);
  osc.stop(now + durationMs / 1000 + 0.02);
}

export function isOrderAlarmPlaying(): boolean {
  return timer != null;
}

export function getOrderAlarmMode(): "critical" | "soft" | null {
  return mode;
}

/** Start repeating two-tone alarm until stopOrderAlarm(). */
export async function startOrderAlarm(opts?: AlarmSoundOpts): Promise<void> {
  const nextMode: "critical" | "soft" = opts?.soft ? "soft" : "critical";
  // Same mode already looping → leave it (dedupe concurrent overlays).
  if (timer != null && mode === nextMode && !opts?.forceRestart) {
    return;
  }
  // Soft playing + critical requested → upgrade.
  if (timer != null && mode === "soft" && nextMode === "critical") {
    // fall through and restart louder
  } else if (timer != null && mode === "critical" && nextMode === "soft") {
    // Critical already covers yellow — don't downgrade.
    return;
  }

  stopOrderAlarm();
  mode = nextMode;
  const ac = getCtx();
  if (ac.state === "suspended") {
    try {
      await ac.resume();
    } catch {
      /* user gesture may be required — overlay click will retry */
    }
  }

  const soft = nextMode === "soft";
  const tick = () => {
    if (soft) {
      // Lower freqs + quieter — still looping so it wakes, less harsh than RED.
      const freq = step % 2 === 0 ? 660 : 880;
      beep(freq, 140, 0.38);
    } else {
      const freq = step % 2 === 0 ? 880 : 1240;
      beep(freq, 180, 0.6);
    }
    step += 1;
  };
  tick();
  timer = window.setInterval(tick, soft ? 420 : 280);
}

export function stopOrderAlarm(): void {
  if (timer != null) {
    window.clearInterval(timer);
    timer = null;
  }
  step = 0;
  mode = null;
}

export async function resumeAlarmAudio(): Promise<void> {
  const ac = getCtx();
  if (ac.state === "suspended") {
    await ac.resume();
  }
}
