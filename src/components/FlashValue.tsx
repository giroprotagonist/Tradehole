import { useEffect, useRef, useState, type ReactNode } from "react";

type Dir = "up" | "down";

function cmpNum(a: unknown, b: unknown): Dir | null {
  if (typeof a !== "number" || typeof b !== "number") return null;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a === b) return null;
  return b > a ? "up" : "down";
}

/** Flash green/red briefly when a numeric (or numeric-like) value changes. */
export function FlashValue({
  value,
  children,
  className = "",
  durationMs = 1400,
}: {
  value: number | string | null | undefined;
  children: ReactNode;
  className?: string;
  durationMs?: number;
}) {
  const prev = useRef<number | string | null | undefined>(undefined);
  const [dir, setDir] = useState<Dir | null>(null);
  const [bump, setBump] = useState(0);

  useEffect(() => {
    const prior = prev.current;
    prev.current = value;
    if (prior === undefined) return; // skip first paint
    const d = cmpNum(prior, value);
    if (!d && prior === value) return;
    if (!d && String(prior) === String(value)) return;
    const nextDir = d ?? (String(value) > String(prior) ? "up" : "down");
    setDir(nextDir);
    setBump((n) => n + 1);
    const t = window.setTimeout(() => setDir(null), durationMs);
    return () => window.clearTimeout(t);
  }, [value, durationMs]);

  return (
    <span
      key={bump}
      className={`flash-val ${dir ? `flash-${dir}` : ""} ${className}`.trim()}
    >
      {children}
    </span>
  );
}

export function formatPollLabel(pollMs: number): string {
  if (pollMs < 1000) return `${pollMs}ms`;
  const s = pollMs / 1000;
  return Number.isInteger(s) ? `${s}s` : `${s.toFixed(1)}s`;
}

export function formatAge(fetchedAt: string | null | undefined, nowMs: number): string {
  if (!fetchedAt) return "—";
  const age = Math.max(0, Math.round((nowMs - new Date(fetchedAt).getTime()) / 1000));
  if (age < 2) return "just now";
  if (age < 60) return `${age}s ago`;
  const m = Math.floor(age / 60);
  return `${m}m ago`;
}
