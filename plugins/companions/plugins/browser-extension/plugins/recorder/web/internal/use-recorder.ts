import { useEffect, useState } from "react";
import type { ExtensionRecorder } from "@plugins/companions/plugins/browser-extension/web";
import type {
  RecorderSnapshot,
  TabFit,
} from "@plugins/companions/plugins/browser-extension/core";

/** The recorder as the section reads it: not known yet, or known. */
export type RecorderView =
  | { kind: "pending" }
  | { kind: "ready"; snapshot: RecorderSnapshot; fit: TabFit };

/**
 * The shell's recorder, live: its snapshot (read once, then pushed by the
 * shell on every change) and the tab measured for the size presets (read
 * once per open — the tab the popup is about does not change under it).
 * A failed read throws to the section's error boundary.
 */
export function useRecorder(recorder: ExtensionRecorder): RecorderView {
  const [snapshot, setSnapshot] = useState<RecorderSnapshot | null>(null);
  const [fit, setFit] = useState<TabFit | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    const off = recorder.onSnapshot(setSnapshot);
    const fail = (err: unknown) =>
      setError(err instanceof Error ? err : new Error(String(err)));
    recorder.snapshot().then(setSnapshot, fail);
    recorder.fit().then(setFit, fail);
    return off;
  }, [recorder]);
  if (error !== null) throw error;
  return snapshot === null || fit === null
    ? { kind: "pending" }
    : { kind: "ready", snapshot, fit };
}

/** A clock that ticks every 250 ms while `running` — the timer's display. */
export function useTicking(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [running]);
  return now;
}

/** `m:ss`. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Bytes as the Finder writes them (MB, one decimal under 10). */
export function sizeText(bytes: number): string {
  const mb = bytes / 1_000_000;
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  if (mb < 10) return `${mb.toFixed(1)} MB`;
  if (mb < 1000) return `${Math.round(mb)} MB`;
  return `${(mb / 1000).toFixed(1)} GB`;
}
