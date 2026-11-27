import type { z } from "zod";
import { wallNow } from "@plugins/packages/plugins/deadline/core";
import { beginWait } from "@plugins/infra/plugins/runtime-profiler/core";
import {
  exponential,
  withJitter,
  type DelayStrategy,
} from "@plugins/packages/plugins/retry/core";
import {
  decodeBatch,
  encodeBatch,
  ErrorEnvelopeSchema,
  GMAIL_BATCH_MAX,
  GmailApiError,
  GmailOutcomeUnknownError,
  GmailResponseShapeError,
  GmailUnreachableError,
  newBatchBoundary,
  type BatchRequestPart,
  type GmailPriority,
  type QuotaPacer,
} from "../../core";

/**
 * The waits a Gmail call is metered as, each named by its layer in the trace
 * of the request that awaited it (2026-11-26: a cold Mail window held 57 s by
 * the account's budget read as `loader mail.threads took 56,072 ms of its
 * own`, naming nothing):
 * - `gmail-quota` (queue): held by the account's pacer, its minute spent.
 *   Metered only when the call has to wait; not the waiter's own time.
 * - `gmail-rate-pause` (queue): held by the pacer's pause after Google refused
 *   a call for rate — the account's budget spent by more than this pacer saw
 *   (another process on the same account: a worktree, a script). Told apart
 *   from `gmail-quota` because the fixes differ: a spender here, a spender
 *   elsewhere. Named by what held the call as it queued.
 * - `gmail-backoff` (queue): the delay before re-sending what Google failed
 *   on its side or could not be reached for (a rate refusal waits on the
 *   pacer's pause instead, as `gmail-rate-pause`).
 * - `gmail-api` (io): Google's time — the HTTP round trip, body read
 *   included. An io wait no one files stays part of its waiter's own time,
 *   named.
 */
const QUOTA_WAIT = "gmail-quota";
const RATE_PAUSE_WAIT = "gmail-rate-pause";
const BACKOFF_WAIT = "gmail-backoff";
const API_WAIT = "gmail-api";

/** Root of Gmail's REST API host; every path below hangs off it. */
export const GMAIL_API_ROOT = "https://gmail.googleapis.com";

/** How a call waits: its priority in the pacer, and a way to give up. */
export type GmailCallOptions = {
  priority?: GmailPriority;
  signal?: AbortSignal;
};

export type GmailTransportOptions = {
  /**
   * A valid Gmail-scoped access token, asked for once per HTTP request (a
   * token can expire between two pages; the broker caches it). When Google
   * answers 401 the request is sent once more with a token asked for with
   * `{ refused }` — the token Google just refused, so the broker refreshes it
   * if it still holds that one (another caller may have refreshed already). A
   * second 401 throws: the grant itself is gone.
   */
  accessToken: (o?: { refused?: string }) => Promise<string>;
  /** The account's ONE pacer (`createQuotaPacer`), shared by all its callers. */
  pacer: QuotaPacer;
  /** Tests replay recorded answers through this. Default: global `fetch`. */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /**
   * The bound around Google, not a fix for our code: a call Google refuses
   * for rate or fails on its side (429, 403 rateLimitExceeded, 5xx) or that
   * cannot reach Google is tried at most `attempts` times, waiting
   * `Retry-After` when Google names one, else `delay` (1 s doubling to 32 s,
   * jittered — Google's advice). A rate refusal waits on the pacer's shared
   * pause rather than `sleep`. Then it throws.
   */
  retry?: {
    attempts?: number;
    delay?: DelayStrategy;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  };
};

/**
 * One item of a batched read: the value, or what went wrong for that item
 * alone — Google's refusal, or an answer of an undocumented shape.
 */
export type GmailBatchResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: GmailApiError | GmailResponseShapeError };

type Body =
  | { kind: "json"; value: unknown }
  | { kind: "upload"; contentType: string; bytes: Uint8Array };

export type CallSpec<T> = {
  /** What is asked, in words, for errors: "threads.get 18c…". */
  what: string;
  units: number;
  method: BatchRequestPart["method"];
  /** Path under the host: `/gmail/v1/users/me/…` or `/upload/gmail/v1/…`. */
  path: string;
  body?: Body;
  schema: z.ZodType<T>;
  /** Statuses answered as a typed outcome instead of thrown (history's 404). */
  expect?: readonly number[];
  /**
   * Whether the call may be sent again after Google might have done it.
   * `safe`: a read, or a write that sets a target state (modify, trash,
   * update, delete) — every retry is allowed. `rate-only`: a call that must
   * not happen twice (send, create) — only a rate refusal, where Google did
   * nothing, is retried; a dropped connection or a 5xx throws
   * `GmailOutcomeUnknownError`. Required, so a new call says which it is.
   */
  replay: "safe" | "rate-only";
};

export type CallOutcome<T> =
  { ok: true; value: T } | { ok: false; status: number; error: GmailApiError };

/** Query string with repeated keys for arrays, undefined skipped. */
export function queryString(
  params: Record<
    string,
    string | number | boolean | readonly string[] | undefined
  >,
): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const item of v) qs.append(k, item);
    else qs.append(k, String(v));
  }
  const s = qs.toString();
  return s === "" ? "" : `?${s}`;
}

/** Google's refusal as a typed error, from its JSON error envelope. */
function apiError(what: string, status: number, text: string): GmailApiError {
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
  }
  const env = ErrorEnvelopeSchema.safeParse(json);
  if (!env.success)
    return new GmailApiError(
      what,
      status,
      null,
      text.slice(0, 300) || "no body",
    );
  return new GmailApiError(
    what,
    status,
    env.data.error.errors?.[0]?.reason ??
      env.data.error.details?.find((d) => d.reason)?.reason ??
      env.data.error.status ??
      null,
    env.data.error.message,
  );
}

function parseBody<T>(what: string, text: string, schema: z.ZodType<T>): T {
  let json: unknown;
  try {
    // A delete answers 204 with no body.
    json = text.trim() === "" ? {} : JSON.parse(text);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    throw new GmailResponseShapeError(what, `not JSON: ${text.slice(0, 300)}`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success)
    throw new GmailResponseShapeError(what, parsed.error.message);
  return parsed.data;
}

/** The wait Google asks for (`Retry-After`: seconds, or an HTTP date), as ms, or null. */
function retryAfterMs(header: string | null | undefined): number | null {
  if (!header) return null;
  const s = Number(header);
  if (Number.isFinite(s) && s >= 0) return s * 1000;
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - wallNow("external"));
}

/** A sleep the signal cuts short (rejecting with its reason). */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted();
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export type GmailTransport = {
  call<T>(spec: CallSpec<T>, opts?: GmailCallOptions): Promise<T>;
  callOutcome<T>(
    spec: CallSpec<T>,
    opts?: GmailCallOptions,
  ): Promise<CallOutcome<T>>;
  batch<T>(
    what: string,
    items: readonly { part: BatchRequestPart; units: number }[],
    schema: z.ZodType<T>,
    opts?: GmailCallOptions,
  ): Promise<GmailBatchResult<T>[]>;
};

/**
 * Splits a batch by count (≤ GMAIL_BATCH_MAX calls: past it Google refuses
 * parts for rate, and each refused part is charged again) and by
 * units (≤ half the priority's window), so no chunk is one the pacer refuses
 * and none holds a whole minute's budget while a click waits behind it in
 * the FIFO. A 50-thread metadata page (2,000 units) is three requests, one
 * after another.
 */
export function batchChunks<I extends { units: number }>(
  items: readonly I[],
  capacity: number,
): I[][] {
  const maxUnits = Math.max(1, Math.floor(capacity / 2));
  const chunks: I[][] = [];
  let chunk: I[] = [];
  let units = 0;
  for (const item of items) {
    if (
      chunk.length > 0 &&
      (chunk.length >= GMAIL_BATCH_MAX || units + item.units > maxUnits)
    ) {
      chunks.push(chunk);
      chunk = [];
      units = 0;
    }
    chunk.push(item);
    units += item.units;
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

export function createGmailTransport(
  opts: GmailTransportOptions,
): GmailTransport {
  const doFetch =
    opts.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));
  const attempts = opts.retry?.attempts ?? 5;
  const delay =
    opts.retry?.delay ??
    withJitter(exponential({ initial: 1_000, max: 32_000 }));
  const sleep = opts.retry?.sleep ?? abortableSleep;
  const { pacer } = opts;

  /** The pacer's admission, metered when it has to wait: `gmail-quota` (its minute spent) or `gmail-rate-pause` (Google's refusal). */
  function admit(units: number, priority: GmailPriority, signal?: AbortSignal) {
    return pacer.acquire(units, {
      priority,
      signal,
      onQueued: (why) =>
        beginWait(why === "paused" ? RATE_PAUSE_WAIT : QUOTA_WAIT, "queue"),
    });
  }

  /**
   * Wait before attempt `attempt + 1`. A rate refusal pauses the account's
   * pacer instead — the budget is the user's, so every caller waits it out,
   * and the retry's own `acquire` is where this caller does.
   */
  async function backoff(
    attempt: number,
    rateLimited: boolean,
    retryAfter: number | null,
    signal?: AbortSignal,
  ) {
    const ms = retryAfter ?? delay(attempt);
    if (rateLimited) {
      pacer.pause(ms);
      return;
    }
    const end = beginWait(BACKOFF_WAIT, "queue");
    try {
      await sleep(ms, signal);
    } finally {
      end();
    }
    signal?.throwIfAborted();
  }

  async function send(
    what: string,
    method: string,
    path: string,
    headers: Record<string, string>,
    body: BodyInit | undefined,
    signal: AbortSignal | undefined,
    /** A token Google refused inside an earlier answer (a batch part's 401): ask past it. */
    refused?: string,
  ): Promise<{ res: Response; text: string; token: string }> {
    const once = async (token: string) => {
      const end = beginWait(API_WAIT, "io");
      try {
        const res = await doFetch(`${GMAIL_API_ROOT}${path}`, {
          method,
          headers: { Authorization: `Bearer ${token}`, ...headers },
          body,
          signal,
        });
        // Read here: a connection reset mid-body is the same failure as one
        // before the headers.
        return { res, text: await res.text(), token };
      } catch (err) {
        if (signal?.aborted) throw err;
        throw new GmailUnreachableError(what, err);
      } finally {
        end();
      }
    };
    const token = await opts.accessToken(
      refused === undefined ? undefined : { refused },
    );
    const first = await once(token);
    // A 401 means Google did nothing (it never read the request), so even a
    // send may go again — with a token the broker refreshed. Not a retry of a
    // failing op: the token's lifetime is Google's, not ours to predict.
    if (first.res.status !== 401) return first;
    return once(await opts.accessToken({ refused: token }));
  }

  async function callOutcome<T>(
    spec: CallSpec<T>,
    callOpts: GmailCallOptions = {},
  ): Promise<CallOutcome<T>> {
    const priority = callOpts.priority ?? "foreground";
    const headers: Record<string, string> = {};
    let body: BodyInit | undefined;
    if (spec.body?.kind === "json") {
      headers["Content-Type"] = "application/json; charset=UTF-8";
      body = JSON.stringify(spec.body.value);
    } else if (spec.body?.kind === "upload") {
      headers["Content-Type"] = spec.body.contentType;
      body = spec.body.bytes as Uint8Array<ArrayBuffer>;
    }
    for (let attempt = 0; ; attempt++) {
      await admit(spec.units, priority, callOpts.signal);
      let res: Response;
      let text: string;
      try {
        ({ res, text } = await send(
          spec.what,
          spec.method,
          spec.path,
          headers,
          body,
          callOpts.signal,
        ));
      } catch (err) {
        if (!(err instanceof GmailUnreachableError)) throw err;
        if (spec.replay === "rate-only")
          throw new GmailOutcomeUnknownError(spec.what, err);
        if (attempt + 1 >= attempts) throw err;
        await backoff(attempt, false, null, callOpts.signal);
        continue;
      }
      if (res.ok)
        return { ok: true, value: parseBody(spec.what, text, spec.schema) };
      const error = apiError(spec.what, res.status, text);
      if (spec.expect?.includes(res.status))
        return { ok: false, status: res.status, error };
      if (error.transient && !error.rateLimited && spec.replay === "rate-only")
        throw new GmailOutcomeUnknownError(spec.what, error);
      if (!error.transient || attempt + 1 >= attempts) throw error;
      await backoff(
        attempt,
        error.rateLimited,
        retryAfterMs(res.headers.get("retry-after")),
        callOpts.signal,
      );
    }
  }

  async function call<T>(
    spec: CallSpec<T>,
    callOpts?: GmailCallOptions,
  ): Promise<T> {
    const out = await callOutcome({ ...spec, expect: [] }, callOpts);
    if (!out.ok) throw out.error; // unreachable: no status is expected
    return out.value;
  }

  /** One chunk of ≤ GMAIL_BATCH_MAX calls, retrying only the items Google failed transiently. */
  async function batchChunk<T>(
    what: string,
    items: readonly { part: BatchRequestPart; units: number }[],
    schema: z.ZodType<T>,
    callOpts: GmailCallOptions,
  ): Promise<GmailBatchResult<T>[]> {
    const priority = callOpts.priority ?? "foreground";
    const results: (GmailBatchResult<T> | undefined)[] = new Array(
      items.length,
    );
    let pending = items.map((_, i) => i);
    // A batch whose envelope Google accepted can still refuse its parts with
    // 401 (the token lapsed): those parts go once more, with a token asked
    // past the refused one — as `send` does for a whole request.
    let refusedToken: string | undefined;
    let authRetried = false;
    for (let attempt = 0; pending.length > 0; attempt++) {
      const last = attempt + 1 >= attempts;
      const units = pending.reduce((sum, i) => sum + items[i]!.units, 0);
      await admit(units, priority, callOpts.signal);
      const boundary = newBatchBoundary();
      const label = `${what} (batch of ${pending.length})`;
      let res: Response;
      let text: string;
      let token: string;
      try {
        ({ res, text, token } = await send(
          label,
          "POST",
          "/batch/gmail/v1",
          { "Content-Type": `multipart/mixed; boundary=${boundary}` },
          encodeBatch(
            pending.map((i) => items[i]!.part),
            boundary,
          ),
          callOpts.signal,
          refusedToken,
        ));
        refusedToken = undefined;
      } catch (err) {
        if (!(err instanceof GmailUnreachableError) || last) throw err;
        await backoff(attempt, false, null, callOpts.signal);
        continue;
      }
      if (!res.ok) {
        const error = apiError(label, res.status, text);
        if (!error.transient || last) throw error;
        await backoff(
          attempt,
          error.rateLimited,
          retryAfterMs(res.headers.get("retry-after")),
          callOpts.signal,
        );
        continue;
      }
      const parts = decodeBatch(
        res.headers.get("content-type") ?? "",
        text,
        pending.length,
      );
      const retry: number[] = [];
      const unauthorized: number[] = [];
      let rateLimited = false;
      let retryAfter: number | null = null;
      for (const part of parts) {
        const index = pending[part.index]!;
        const itemWhat = `${what} ${items[index]!.part.path}`;
        if (part.status === 401 && !authRetried) {
          unauthorized.push(index);
          continue;
        }
        if (part.status >= 200 && part.status < 300) {
          try {
            results[index] = {
              ok: true,
              value: parseBody(itemWhat, part.body, schema),
            };
          } catch (err) {
            if (!(err instanceof GmailResponseShapeError)) throw err;
            results[index] = { ok: false, error: err };
          }
          continue;
        }
        const error = apiError(itemWhat, part.status, part.body);
        if (error.transient && !last) {
          retry.push(index);
          rateLimited ||= error.rateLimited;
          retryAfter =
            Math.max(
              retryAfter ?? 0,
              retryAfterMs(part.headers["retry-after"]) ?? 0,
            ) || null;
        } else {
          results[index] = { ok: false, error };
        }
      }
      if (unauthorized.length > 0) {
        // Not a backoff: Google did nothing, the token is what changes.
        authRetried = true;
        refusedToken = token;
        pending = [...unauthorized, ...retry];
        if (retry.length > 0)
          await backoff(attempt, rateLimited, retryAfter, callOpts.signal);
        continue;
      }
      pending = retry;
      if (pending.length > 0)
        await backoff(attempt, rateLimited, retryAfter, callOpts.signal);
    }
    return results.map((r, i) => {
      if (!r)
        throw new Error(`gmail batch: item ${i} of ${what} was never settled`);
      return r;
    });
  }

  async function batch<T>(
    what: string,
    items: readonly { part: BatchRequestPart; units: number }[],
    schema: z.ZodType<T>,
    callOpts: GmailCallOptions = {},
  ): Promise<GmailBatchResult<T>[]> {
    const out: GmailBatchResult<T>[] = [];
    // Chunks run one after another: Google rate-limits concurrent batches of
    // one user harder than their units alone would.
    for (const chunk of batchChunks(
      items,
      pacer.capacity(callOpts.priority ?? "foreground"),
    )) {
      out.push(...(await batchChunk(what, chunk, schema, callOpts)));
    }
    return out;
  }

  return { call, callOutcome, batch };
}
