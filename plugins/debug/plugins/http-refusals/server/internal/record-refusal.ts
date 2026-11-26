import type { Refusal } from "@plugins/framework/plugins/http-router/core";
import { defineLogSink } from "@plugins/primitives/plugins/log-channels/server";
import { runTracked } from "@plugins/infra/plugins/runtime-profiler/core";

// Stage 0 of research/2026-11-26-infra-declared-refusals.md: measure every 4xx
// this backend answers before deciding which refusals are deliberate. One line
// per 4xx in the `http-refusals` channel →
// ~/.equin/worktrees/<wt>/logs/http-refusals.jsonl. Bounded by the channel
// file sink's rotation (128 MB × 3); a 4xx line is ~200–500 bytes.
const channel = defineLogSink({
  id: "http-refusals",
  description:
    "Every 4xx this backend answered (http-refusals): the route key (or null when no route matched), method, path, status and the first 300 characters of the body — to count refusals per route and status before declared refusals (research/2026-11-26-infra-declared-refusals.md).",
});

/** The longest body excerpt a line keeps. */
const MESSAGE_CHARS = 300;

/** What one `http-refusals` line holds (its `line`, JSON). */
export interface RefusalLine {
  route: string | null;
  method: string;
  path: string;
  status: number;
  /** The body's first characters; `null` for an empty body. */
  message: string | null;
  /** Why the body could not be read, when it could not. */
  bodyError?: string;
}

/**
 * The router's `onRefused` (wired by server-core's `bin/serve.ts`): records
 * one line for a 4xx answer. It reads at most `MESSAGE_CHARS` of a clone's
 * body in the background, then cancels the clone, so the answer is never
 * delayed or changed. It never throws on the request path: an answer whose
 * body was already used is recorded as such, and a body that fails to read
 * is recorded with the read's error.
 */
export function recordRefusal(refusal: Refusal): void {
  const { route, method, pathname, res } = refusal;
  const clone = res.bodyUsed ? null : res.clone();
  void runTracked("http-refusals.record", async () => {
    const line: RefusalLine = {
      route,
      method,
      path: pathname,
      status: res.status,
      ...(clone === null
        ? { message: null, bodyError: "body already used" }
        : await excerpt(clone)),
    };
    channel.publish(JSON.stringify(line));
  });
}

/** The body's first `MESSAGE_CHARS`, read no further than needed. */
export async function excerpt(
  res: Response,
): Promise<Pick<RefusalLine, "message" | "bodyError">> {
  if (res.body === null) return { message: null };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let done = false;
  try {
    while (!done && text.length < MESSAGE_CHARS) {
      const chunk = await reader.read();
      done = chunk.done;
      if (!done) text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch (err) {
    // An errored body is already closed: nothing to cancel.
    return { message: text === "" ? null : text, bodyError: String(err) };
  }
  // The rest is not ours to read: stop the clone's branch of the body.
  if (!done) await reader.cancel();
  return { message: text === "" ? null : text.slice(0, MESSAGE_CHARS) };
}
