import { z } from "zod";
import {
  MAX_PROTOCOL_LENGTH,
  MODULE_EVAL_ID,
  RESOURCE_TIMING_BUFFER_SIZE,
  ROUTE_CONTENT_COMMIT_ID,
  type BootSpan,
  type LongTask,
} from "@plugins/primitives/plugins/perfs/plugins/boot-trace/core";

/**
 * The files and boot spans named, longest first. A few: the whole payload has
 * to fit the intake's 4 KB (`SITE_REPORT_LIMITS.maxDataBytes`), past which the
 * channel trims it.
 */
const MAX_NAMED = 5;
/** A file's path keeps its end, where the name that tells it apart is. */
const MAX_PATH = 120;
const MAX_SPAN_ID = 80;
/** A file not served by the site: its URL could name the visitor's extensions. */
const OTHER_ORIGIN = "(another origin)";

const CountSchema = z.number().int().nonnegative();

const SlowFileSchema = z
  .object({
    path: z.string().max(MAX_PATH),
    /** What asked for it (`script`, `link`, `fetch`, …). */
    by: z.string().max(24),
    startMs: CountSchema,
    /**
     * Start → request sent: queued, connecting. Null when the browser did not
     * time the request (another origin without Timing-Allow-Origin).
     */
    queueMs: CountSchema.nullable(),
    /** Request sent → its first byte. */
    waitMs: CountSchema.nullable(),
    /** First byte → last byte. */
    downloadMs: CountSchema.nullable(),
    totalMs: CountSchema,
    bytes: CountSchema,
    protocol: z.string().max(MAX_PROTOCOL_LENGTH).nullable(),
  })
  .strict();

/**
 * What a slow load spent its time on, up to when it was ready (or hidden).
 * Which stretch, first:
 * - `codeRanMs` late or null — the app's code was not running yet: the
 *   download (below), or the device evaluating it;
 * - `contentMs` long after `codeRanMs` — the boot waited (`waitingOn`, `spans`);
 * - the first paint long after `contentMs` — the content was committed and
 *   not painted: the main thread (`mainThread`), or the browser drew no frame.
 * Then, inside it:
 * - a late `documentEndMs` — the document's own download;
 * - a late `lastFileEndMs` — the files: all of them (`bytes` over the time),
 *   or one that stalled (`slowest`, by queue / wait / download);
 * - a large `mainThread` — the visitor's device running the code;
 * - none of these — a boot step waited (`spans`), or a request was still in
 *   flight (the browser times a request only once it has ended).
 */
export const LoadSplitSchema = z
  .object({
    documentEndMs: CountSchema.nullable(),
    /** The entry module evaluated: the app's code had arrived. */
    codeRanMs: CountSchema.nullable(),
    /** The route's content committed — before any paint of it. */
    contentMs: CountSchema.nullable(),
    /** Boot spans still open when the load was filed. */
    waitingOn: z.array(z.string().max(MAX_SPAN_ID)).max(MAX_NAMED),
    /** The files that started by then. */
    files: CountSchema,
    /**
     * Their bytes over the wire: a lower bound (a cached file, another
     * origin's and Safari before 16.4 count 0).
     */
    bytes: CountSchema,
    /** The last of them to end, by `untilMs` at the latest. */
    lastFileEndMs: CountSchema.nullable(),
    /** Still downloading at `untilMs` (each one's times are cut there). */
    inFlight: CountSchema,
    /**
     * The browser's resource buffer filled — at the shell's raised size, or
     * at the browser's own 250 where the raise did not apply: files are
     * missing from the split.
     */
    filesTruncated: z.boolean(),
    slowest: z.array(SlowFileSchema).max(MAX_NAMED),
    /** Null where the browser has no Long Tasks API (Firefox, Safari). */
    mainThread: z
      .object({ busyMs: CountSchema, longestMs: CountSchema })
      .strict()
      .nullable(),
    spans: z
      .array(
        z
          .object({
            id: z.string().max(MAX_SPAN_ID),
            startMs: CountSchema,
            durationMs: CountSchema,
          })
          .strict(),
      )
      .max(MAX_NAMED),
    /** Loads asked again after the page lost its reach (web-sdk's page-reach). */
    retries: CountSchema,
  })
  .strict();
export type LoadSplit = z.infer<typeof LoadSplitSchema>;

/** The fields read from a `PerformanceResourceTiming`. */
export type ResourceFields = Pick<
  PerformanceResourceTiming,
  | "name"
  | "initiatorType"
  | "startTime"
  | "requestStart"
  | "responseStart"
  | "responseEnd"
  | "transferSize"
  | "nextHopProtocol"
>;

export interface LoadRecords {
  /** The page's origin: only its own files are named. */
  origin: string;
  /** The document's last byte; 0 or null when not reached. */
  documentEndMs: number | null;
  resources: readonly ResourceFields[];
  /** Null where the browser has no Long Tasks API. */
  longTasks: readonly LongTask[] | null;
  spans: readonly BootSpan[];
  openSpans: readonly { id: string; startMs: number }[];
  retries: number;
}

/** Whole ms; never negative. */
function whole(ms: number): number {
  return Math.max(0, Math.round(ms));
}

function filePath(name: string, origin: string): string {
  // `blob:` and `data:` URLs do not start with the origin: never named.
  if (!name.startsWith(`${origin}/`)) return OTHER_ORIGIN;
  const path = new URL(name).pathname;
  return path.length > MAX_PATH ? `…${path.slice(1 - MAX_PATH)}` : path;
}

/** The browser's own Resource Timing buffer, where the shell's raise did not apply. */
const DEFAULT_RESOURCE_BUFFER = 250;

/**
 * A file's times cut at `untilMs`: what it had done when the visitor stopped
 * waiting — a page hidden before it booted is judged after, when the files
 * the hide held up have ended.
 */
function cut(r: ResourceFields, untilMs: number): ResourceFields {
  const at = (ms: number) => (ms > 0 ? Math.min(ms, untilMs) : ms);
  return {
    ...r,
    requestStart: at(r.requestStart),
    responseStart: at(r.responseStart),
    responseEnd: at(r.responseEnd),
  };
}

function slowFile(
  r: ResourceFields,
  origin: string,
): z.infer<typeof SlowFileSchema> {
  const timed = r.requestStart > 0 && r.responseStart > 0;
  return {
    path: filePath(r.name, origin),
    by: r.initiatorType.slice(0, 24),
    startMs: whole(r.startTime),
    queueMs: timed ? whole(r.requestStart - r.startTime) : null,
    waitMs: timed ? whole(r.responseStart - r.requestStart) : null,
    downloadMs: timed ? whole(r.responseEnd - r.responseStart) : null,
    totalMs: whole(r.responseEnd - r.startTime),
    // Absent in Safari before 16.4.
    bytes: whole(r.transferSize || 0),
    protocol: r.nextHopProtocol
      ? r.nextHopProtocol.slice(0, MAX_PROTOCOL_LENGTH)
      : null,
  };
}

/** The split of the load up to `untilMs`, from the browser's records. PURE. */
export function buildLoadSplit(
  records: LoadRecords,
  untilMs: number,
): LoadSplit {
  const { origin, documentEndMs, resources, longTasks, spans } = records;
  const started = resources.filter((r) => r.startTime < untilMs);
  const files = started.map((r) => cut(r, untilMs));
  const tasks = longTasks
    ?.filter((t) => t.startMs < untilMs)
    .map((t) => Math.min(t.durationMs, untilMs - t.startMs));
  const instant = (id: string) => {
    const at = spans.find((s) => s.id === id)?.startMs;
    return at !== undefined && at <= untilMs ? whole(at) : null;
  };
  return {
    documentEndMs: documentEndMs ? whole(documentEndMs) : null,
    codeRanMs: instant(MODULE_EVAL_ID),
    contentMs: instant(ROUTE_CONTENT_COMMIT_ID),
    waitingOn: records.openSpans
      .filter((s) => s.startMs < untilMs)
      .slice(0, MAX_NAMED)
      .map((s) => s.id.slice(0, MAX_SPAN_ID)),
    files: files.length,
    bytes: whole(files.reduce((sum, r) => sum + (r.transferSize || 0), 0)),
    lastFileEndMs: files.length
      ? whole(files.reduce((last, r) => Math.max(last, r.responseEnd), 0))
      : null,
    inFlight: started.filter((r) => r.responseEnd > untilMs).length,
    filesTruncated:
      resources.length >= RESOURCE_TIMING_BUFFER_SIZE ||
      resources.length === DEFAULT_RESOURCE_BUFFER,
    slowest: [...files]
      .sort(
        (a, b) => b.responseEnd - b.startTime - (a.responseEnd - a.startTime),
      )
      .slice(0, MAX_NAMED)
      .map((r) => slowFile(r, origin)),
    mainThread: tasks
      ? {
          busyMs: whole(tasks.reduce((sum, ms) => sum + ms, 0)),
          longestMs: whole(tasks.reduce((max, ms) => Math.max(max, ms), 0)),
        }
      : null,
    // A resource span is one boot-snapshot entry: every one of a snapshot's
    // repeats its window, so they would fill the list with one wait.
    spans: spans
      .filter(
        (s) =>
          s.durationMs > 0 && s.startMs < untilMs && s.phase !== "resources",
      )
      .map((s) => ({
        ...s,
        durationMs: Math.min(s.durationMs, untilMs - s.startMs),
      }))
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, MAX_NAMED)
      .map((s) => ({
        id: s.id.slice(0, MAX_SPAN_ID),
        startMs: whole(s.startMs),
        durationMs: whole(s.durationMs),
      })),
    retries: records.retries,
  };
}

const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/**
 * The split in a few words, for the report's message. Short: the import keeps
 * 300 characters of it, and the payload has the rest. No path (the import
 * removes URLs): the slowest file is named by its last segment.
 */
export function loadSplitWords(split: LoadSplit): string {
  const parts: string[] = [];
  if (split.documentEndMs !== null && split.documentEndMs >= 1_000) {
    parts.push(`document in at ${s(split.documentEndMs)}`);
  }
  if (split.codeRanMs !== null) parts.push(`code ran ${s(split.codeRanMs)}`);
  if (split.contentMs !== null) parts.push(`content ${s(split.contentMs)}`);
  else if (split.waitingOn[0]) parts.push(`waiting on ${split.waitingOn[0]}`);
  if (split.lastFileEndMs !== null) {
    const more = split.filesTruncated ? "+" : "";
    const open = split.inFlight > 0 ? ` (${split.inFlight} still loading)` : "";
    parts.push(
      `${split.files}${more} files ${(split.bytes / 1e6).toFixed(1)} MB in by ${s(split.lastFileEndMs)}${open}`,
    );
  }
  const slow = split.slowest[0];
  if (slow && slow.totalMs >= 1_000) {
    const name = (slow.path.split("/").pop() || slow.path).slice(-32);
    parts.push(`slowest ${name} ${s(slow.totalMs)}`);
  }
  if (split.mainThread) parts.push(`CPU ${s(split.mainThread.busyMs)}`);
  if (split.retries > 0) parts.push(`retried ${split.retries}×`);
  return parts.join(", ");
}
