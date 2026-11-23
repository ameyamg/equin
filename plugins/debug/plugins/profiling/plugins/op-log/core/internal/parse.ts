import type { OpEventKind, OpLine, RawOpRecord } from "./types";

/**
 * Every v2 event kind this reader folds. A `Record` over `OpEventKind`, so
 * adding a kind to the wire type without listing it here is a tsc error.
 */
const KNOWN_EVENT_KINDS: Record<OpEventKind, true> = {
  requested: true,
  "wait-start": true,
  "wait-end": true,
  requeue: true,
  granted: true,
  completed: true,
};

const KNOWN_LEGACY_PHASES: Record<RawOpRecord["phase"], true> = {
  requested: true,
  granted: true,
  completed: true,
};

/**
 * One op-log value, checked before the fold sees it: a line this reader folds,
 * or a skip saying why. The log is shared by every checkout, so a writer newer
 * than this reader (an event kind it has never heard of) is expected, not a
 * fault: it is skipped and reported by the caller, never folded as if known.
 */
export type ParsedOpLine =
  | { kind: "line"; line: OpLine }
  | {
      kind: "skipped";
      /** `unknown-kind`: a v2 event or legacy phase this reader does not know. */
      reason: "not-an-op-line" | "unknown-kind";
      /** The unknown `e` / `phase`, for an `unknown-kind` skip. */
      detail: string | null;
    };

/** Check one already-JSON-parsed op-log value (see `ParsedOpLine`). */
export function parseOpLine(value: unknown): ParsedOpLine {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as { opId?: unknown }).opId !== "string"
  )
    return { kind: "skipped", reason: "not-an-op-line", detail: null };
  if ("e" in value) {
    const e = (value as { e: unknown }).e;
    return typeof e === "string" && Object.hasOwn(KNOWN_EVENT_KINDS, e)
      ? { kind: "line", line: value as OpLine }
      : { kind: "skipped", reason: "unknown-kind", detail: String(e) };
  }
  const phase = (value as { phase?: unknown }).phase;
  return typeof phase === "string" && Object.hasOwn(KNOWN_LEGACY_PHASES, phase)
    ? { kind: "line", line: value as OpLine }
    : { kind: "skipped", reason: "unknown-kind", detail: String(phase) };
}

/**
 * The foldable lines among `values`, with every skip counted by its reason and
 * kind (`"unknown-kind:progress"` → 7) for the caller to report.
 */
export function parseOpLines(values: Iterable<unknown>): {
  lines: OpLine[];
  skipped: Map<string, number>;
} {
  const lines: OpLine[] = [];
  const skipped = new Map<string, number>();
  for (const value of values) {
    const parsed = parseOpLine(value);
    if (parsed.kind === "line") {
      lines.push(parsed.line);
      continue;
    }
    const key =
      parsed.detail === null
        ? parsed.reason
        : `${parsed.reason}:${parsed.detail}`;
    skipped.set(key, (skipped.get(key) ?? 0) + 1);
  }
  return { lines, skipped };
}
