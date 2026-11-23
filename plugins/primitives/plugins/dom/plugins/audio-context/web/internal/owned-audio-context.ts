// ── One owner of an AudioContext's resume and close ─────────────────────────
//
// A context starts suspended until the page has a user gesture, so a resume()
// asked for before one stays pending. Closing the context meanwhile — leaving
// the app before ever clicking — rejects that pending resume with an
// InvalidStateError ("Closed before resume completed" on WebKit, "AudioContext
// is closed" elsewhere). A caller that fired the resume and forgot it
// (`void ctx.resume()`) leaves an unhandled rejection for the teardown it asked
// for itself (Sonata on equin.ai, report-1795059421-nnk0da; the ambient host,
// report-1795142633-urk0aa). Closing a context twice rejects the same way.
//
// So the context is built here and its owner holds the only resume and close:
// resume answers `running` or `closed` (closed by this owner while it was
// pending), close runs once. The context the owner hands out is typed without
// resume / suspend / close, so a raw call on it does not compile, and the
// `audio-context/no-raw-audio-context` lint rule sends every `new AudioContext`
// and every raw `.resume()` promise here. A rejection that is not this
// owner's own teardown — any other InvalidStateError included — is thrown as
// an AudioContextError carrying the caller's stack.

/**
 * An AudioContext without the lifecycle calls only its owner makes — what a
 * graph builder (voices, schedulers, effects) needs: the clock, the
 * destination, node factories, state and latency.
 */
export type AudioGraphContext = Omit<
  AudioContext,
  "resume" | "suspend" | "close"
>;

/** What became of a resume request. */
export type ResumeOutcome =
  /** The context is running. */
  | { kind: "running" }
  /** This owner closed the context before the resume completed (or before it was asked). */
  | { kind: "closed" };

/** A resume() or close() rejection that is not the owner's own teardown. */
export class AudioContextError extends Error {
  override name = "AudioContextError";
}

/** An AudioContext with its single owner of resume and close. */
export interface OwnedAudioContext {
  /** The context to build the graph on. */
  readonly ctx: AudioGraphContext;
  /**
   * Resumes the context (call it from a gesture's handler to start sound at
   * once; asked for without one it stays pending until the browser allows
   * sound). Never rejects for this owner's own close; fire-and-forget callers
   * write `void owned.requestResume()`.
   */
  requestResume(): Promise<ResumeOutcome>;
  /** Closes the context, once — a second call is a no-op. */
  close(): void;
  /** Whether {@link close} was called. */
  readonly closed: boolean;
}

function describe(err: unknown): string {
  return err instanceof DOMException
    ? `${err.name}: ${err.message}`
    : String(err);
}

/** Builds an AudioContext and its owner — the one `new AudioContext` of the app. */
export function openAudioContext(
  options?: AudioContextOptions,
): OwnedAudioContext {
  return ownAudioContext(new AudioContext(options));
}

/** The owner of an already-built context (exported for the tests' fakes). */
export function ownAudioContext(ctx: AudioContext): OwnedAudioContext {
  let closed = false;
  return {
    ctx,
    get closed() {
      return closed;
    },
    async requestResume() {
      if (closed) return { kind: "closed" };
      // Made before the await, so its stack is the caller's — the
      // DOMException the browser rejects with has none.
      const origin = new AudioContextError("AudioContext resume() rejected");
      try {
        await ctx.resume();
        return { kind: "running" };
      } catch (err) {
        // Only the teardown this owner asked for is an answer; anything else —
        // an InvalidStateError on a context nobody here closed included — is a
        // failure.
        if (
          closed &&
          err instanceof DOMException &&
          err.name === "InvalidStateError"
        )
          return { kind: "closed" };
        origin.message = `AudioContext resume() rejected with ${describe(err)} (state ${ctx.state})`;
        origin.cause = err;
        throw origin;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      const origin = new AudioContextError("AudioContext close() rejected");
      void ctx.close().catch((err: unknown) => {
        origin.message = `AudioContext close() rejected with ${describe(err)} (state ${ctx.state})`;
        origin.cause = err;
        throw origin;
      });
    },
  };
}
