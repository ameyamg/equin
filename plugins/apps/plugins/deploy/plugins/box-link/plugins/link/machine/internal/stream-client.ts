import {
  NdjsonParseError,
  readNdjson,
} from "@plugins/infra/plugins/ndjson-stream/server";
import { reportServerError } from "@plugins/framework/plugins/server-core/core";
import {
  runInRootContext,
  runTracked,
} from "@plugins/infra/plugins/runtime-profiler/core";
import { armAwakeDeadline } from "@plugins/packages/plugins/deadline/core";
import {
  BOX_LINK_STREAM_PATH,
  readBoxFrame,
  type BoxBeatFrame,
  type BoxHelloFrame,
} from "@plugins/apps/plugins/deploy/plugins/box-link/core";

/** No frame for this long (three missed beats): the stream is dead. */
export const STREAM_WATCHDOG_MS = 45_000;

/** Reconnect backoff after a failed or ended stream: 2 s doubling to 2 min. */
const BACKOFF_MIN_MS = 2_000;
const BACKOFF_MAX_MS = 2 * 60_000;

/** How the stream request reaches the box. */
export type StreamTransport = (
  path: string,
  signal: AbortSignal,
) => Promise<Response>;

/** What one stream tells its link, frame by frame. */
export interface StreamEvents {
  hello(frame: BoxHelloFrame): void;
  beat(frame: BoxBeatFrame): void;
  signal(source: string, payload: unknown): void;
  /** The box has no stream route (404): idle until kicked. */
  routeMissing(error: string): void;
  /** The stream failed or ended — see {@link StreamFailure}. */
  failed(failure: StreamFailure): void;
}

/**
 * How one attempt failed. `answered`: the box itself answered (an HTTP
 * error, a stream it closed, a frame it sent wrong) — so the transport
 * carried the request and equin is what failed. Otherwise nothing came back
 * (the request or the connection broke, or silence): through a tunnel, that
 * cannot tell the tunnel dying from equin not listening. `startedAt` is
 * when the attempt began (epoch ms).
 */
export interface StreamFailure {
  error: string;
  answered: boolean;
  startedAt: number;
}

/**
 * Why one attempt ended. `heardBeat`: the box sent a SECOND beat — the stream
 * outlived a whole beat interval, so it reached steady state, which is what
 * resets the backoff. A hello alone does not, nor a first beat: a box whose
 * first (or second) sample throws says hello on every attempt, and resetting
 * on it would reconnect every few seconds forever (each one a catch-up
 * mirror pull and a state write).
 */
type AttemptEnd =
  | { kind: "route-missing"; error: string }
  | { kind: "failed"; error: string; answered: boolean; heardBeat: boolean }
  | { kind: "aborted" };

class WatchdogFired extends Error {
  constructor() {
    super(`no frame from the box for ${String(STREAM_WATCHDOG_MS / 1000)} s`);
    this.name = "WatchdogFired";
  }
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    return cause instanceof Error
      ? `${err.message} (${cause.message})`
      : err.message;
  }
  return String(err);
}

/**
 * One attempt: open the stream, read it to its end. Every frame re-arms the
 * watchdog (awake time: a sleep is the wake kick's to handle, not a timeout).
 * A malformed frame or line is a protocol bug — reported, and the attempt
 * ends as failed.
 *
 * Metered per unit of work, never as one op: the request (until the box
 * answers) and each frame's handling are each a `bg` entry of their own. The
 * stream itself stays open for as long as the link is up — hours — and as
 * one entry its whole life read as "own time" when it ended
 * (report-1795399008-z56qqe: a 27-min stream filed as a 1,651 s slow op).
 */
async function attempt(
  transport: StreamTransport,
  events: StreamEvents,
  outer: AbortSignal,
): Promise<AttemptEnd> {
  const inner = new AbortController();
  const onOuter = () => inner.abort(outer.reason);
  outer.addEventListener("abort", onOuter, { once: true });
  let cancelWatchdog = () => {};
  const arm = () => {
    cancelWatchdog();
    cancelWatchdog = armAwakeDeadline(STREAM_WATCHDOG_MS, () =>
      inner.abort(new WatchdogFired()),
    );
  };
  let heardBeat = false;
  let beats = 0;
  try {
    arm();
    let res: Response;
    try {
      res = await runTracked("box-link: stream connect", () =>
        transport(BOX_LINK_STREAM_PATH, inner.signal),
      );
    } catch (err) {
      if (outer.aborted) return { kind: "aborted" };
      if (inner.signal.reason instanceof WatchdogFired) {
        return {
          kind: "failed",
          error: inner.signal.reason.message,
          answered: false,
          heardBeat,
        };
      }
      // No answer: the tunnel died, or it is up and nothing answers behind
      // it (ssh: "connect failed") — the link manager tells which.
      return {
        kind: "failed",
        error: `the stream request failed: ${errorText(err)}`,
        answered: false,
        heardBeat,
      };
    }
    if (res.status === 404) {
      await res.body?.cancel();
      return {
        kind: "route-missing",
        error: "the box answered 404 for the box-link stream",
      };
    }
    if (!res.ok || res.body === null) {
      await res.body?.cancel();
      return {
        kind: "failed",
        error: `the box answered HTTP ${String(res.status)}`,
        answered: true,
        heardBeat,
      };
    }
    try {
      for await (const value of readNdjson(res.body, inner.signal)) {
        arm();
        const read = readBoxFrame(value);
        switch (read.kind) {
          case "skip":
            break;
          case "producer-error":
            // The box's own code threw while streaming: an equin bug on the
            // box, which files no report main can see — so main files it.
            reportServerError({
              message: `[box-link] the box's stream failed: ${read.message}`,
              scope: "box-link:box-stream-failed",
            });
            return {
              kind: "failed",
              error: `the box's stream failed: ${read.message}`,
              answered: true,
              heardBeat,
            };
          case "malformed":
            reportServerError({
              message: `[box-link] a malformed stream frame: ${read.message}`,
              scope: "box-link:stream-frame",
            });
            return {
              kind: "failed",
              error: `a malformed frame: ${read.message}`,
              answered: true,
              heardBeat,
            };
          case "frame": {
            const frame = read.frame;
            if (frame.kind === "beat") {
              beats += 1;
              if (beats >= 2) heardBeat = true;
            }
            await runTracked("box-link: stream frame", () => {
              if (frame.kind === "hello") events.hello(frame);
              else if (frame.kind === "beat") events.beat(frame);
              else events.signal(frame.source, frame.payload);
            });
            break;
          }
        }
      }
      // A chunked stream only ends cleanly on the box's own last chunk.
      return {
        kind: "failed",
        error: "the box closed the stream",
        answered: true,
        heardBeat,
      };
    } catch (err) {
      if (outer.aborted) return { kind: "aborted" };
      if (err instanceof WatchdogFired) {
        return {
          kind: "failed",
          error: err.message,
          answered: false,
          heardBeat,
        };
      }
      if (err instanceof NdjsonParseError) {
        reportServerError({
          message: `[box-link] an unparseable stream line: ${err.message}`,
          scope: "box-link:stream-frame",
        });
        return {
          kind: "failed",
          error: err.message,
          answered: true,
          heardBeat,
        };
      }
      // The connection broke mid-stream (the tunnel or the box went away).
      return {
        kind: "failed",
        error: `the stream broke: ${errorText(err)}`,
        answered: false,
        heardBeat,
      };
    }
  } finally {
    cancelWatchdog();
    outer.removeEventListener("abort", onOuter);
    inner.abort();
  }
}

/**
 * One deployment's stream client: while enabled, it holds the stream open,
 * reconnecting after a failure with a bounded backoff (a bound around a
 * network peer — the box — not a fix for our own code; reset by a second beat,
 * never by a hello alone — see {@link AttemptEnd}).
 * A 404 leaves it idle until `kick()`. `kick()` reconnects now (skipping a
 * backoff wait), `disable()` drops the stream and any wait.
 */
export interface StreamClient {
  enable(): void;
  disable(): void;
  kick(): void;
}

export function createStreamClient(
  transport: StreamTransport,
  events: StreamEvents,
): StreamClient {
  let enabled = false;
  let running: AbortController | null = null;
  let cancelWait: (() => void) | null = null;
  let backoffMs = BACKOFF_MIN_MS;

  function clearWait(): void {
    cancelWait?.();
    cancelWait = null;
  }

  function connect(): void {
    if (!enabled || running !== null) return;
    clearWait();
    const ctl = new AbortController();
    running = ctl;
    // The stream's life is no one's work: run outside whatever context
    // enabled or kicked it (a boot hook, a request), unmetered — its connect
    // and frames are metered one by one inside `attempt`.
    void runInRootContext(async () => {
      const startedAt = Date.now();
      const end = await attempt(transport, events, ctl.signal);
      if (running === ctl) running = null;
      if (end.kind === "aborted" || !enabled) return;
      if (end.kind === "route-missing") {
        const { error } = end;
        await runTracked("box-link: stream end", () => {
          events.routeMissing(error);
        });
        return;
      }
      if (end.heardBeat) backoffMs = BACKOFF_MIN_MS;
      const failure = { error: end.error, answered: end.answered, startedAt };
      await runTracked("box-link: stream end", () => {
        events.failed(failure);
      });
      // Disabled, or kicked into a new attempt, while the end was handled.
      if (!enabled || running !== null) return;
      const wait = backoffMs;
      backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
      cancelWait = armAwakeDeadline(wait, () => {
        cancelWait = null;
        connect();
      });
    });
  }

  return {
    enable() {
      if (enabled) return;
      enabled = true;
      backoffMs = BACKOFF_MIN_MS;
      connect();
    },
    disable() {
      enabled = false;
      clearWait();
      running?.abort();
      running = null;
    },
    kick() {
      if (!enabled) return;
      backoffMs = BACKOFF_MIN_MS;
      connect();
    },
  };
}
