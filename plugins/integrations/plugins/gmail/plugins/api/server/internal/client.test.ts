import { describe, expect, test } from "bun:test";
import {
  createQuotaPacer,
  decodeBatch,
  GmailApiError,
  GmailOutcomeUnknownError,
  GmailResponseShapeError,
} from "../../core";
import type { PacerClock } from "../../core/internal/pacer";
import { createGmailClient } from "./client";
import {
  batchAnswer,
  HISTORY_PAGE,
  metadataThread,
  NOT_FOUND,
  RATE_LIMITED,
  THREAD_LIST,
  USER_RATE_LIMITED_403,
} from "./fixtures/gmail-fixtures";

type Sent = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | Uint8Array | undefined;
};
type Reply = (req: Sent) => Response;

/** A fetch that replays `replies` in order and records every request. */
function replay(replies: Reply[]) {
  const sent: Sent[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const req: Sent = {
      url,
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: init.body as string | Uint8Array | undefined,
    };
    sent.push(req);
    const next = replies.shift();
    if (!next) throw new Error(`unexpected request ${req.method} ${url}`);
    return next(req);
  };
  return { sent, fetch };
}

const json =
  (status: number, body: unknown, headers: Record<string, string> = {}) =>
  () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });

/** Answers a batch request part by part with `answer(index, path)`. */
function batchReply(
  answer: (
    index: number,
    path: string,
  ) => { status: number; statusText: string; body: unknown },
): Reply {
  return (req) => {
    const boundary = /boundary=(\S+)/.exec(req.headers["Content-Type"]!)![1]!;
    const requests = String(req.body)
      .split(`--${boundary}`)
      .slice(1, -1)
      .map((p) => /\r\n\r\n(\w+) (\S+) HTTP\/1\.1/.exec(p)![2]!);
    const out = "batch_ANSWER";
    // Answer in reverse order: Google does not promise request order.
    const parts = requests
      .map((path, index) => ({ index, ...answer(index, path) }))
      .reverse();
    return new Response(batchAnswer(out, parts), {
      status: 200,
      headers: { "Content-Type": `multipart/mixed; boundary=${out}` },
    });
  };
}

function client(replies: Reply[], unitsPerMinute = 6_000) {
  const r = replay(replies);
  // A clock whose timers fire at once, jumping time forward: a pacer wait
  // (a window filling, a rate pause) costs the test nothing but shows in now().
  let now = 0;
  const clock: PacerClock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const t = { cancelled: false };
      queueMicrotask(() => {
        if (t.cancelled) return;
        now += ms;
        fn();
      });
      return t;
    },
    clearTimeout: (t) => void ((t as { cancelled: boolean }).cancelled = true),
  };
  const pacer = createQuotaPacer({ unitsPerMinute, clock });
  const sleeps: number[] = [];
  const gmail = createGmailClient({
    accessToken: async () => "tok",
    pacer,
    fetch: r.fetch,
    retry: {
      attempts: 3,
      delay: (a) => 1_000 * 2 ** a,
      sleep: async (ms) => void sleeps.push(ms),
    },
  });
  return { gmail, pacer, sent: r.sent, sleeps, now: () => now };
}

describe("createGmailClient", () => {
  test("threads.list: query, bearer token, parsed page, 10 units", async () => {
    const c = client([json(200, THREAD_LIST)]);
    const page = await c.gmail.listThreads({
      labelIds: ["INBOX", "UNREAD"],
      maxResults: 50,
      q: "from:ana",
    });
    expect(c.sent[0]!.url).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/threads?q=from%3Aana&labelIds=INBOX&labelIds=UNREAD&maxResults=50",
    );
    expect(c.sent[0]!.headers.Authorization).toBe("Bearer tok");
    expect(page.threads?.map((t) => t.historyId)).toEqual([
      "9001",
      "8990",
      "8950",
    ]);
    expect(c.pacer.stats().spentUnits).toBe(10);
  });

  test("getThreads batches, charges 40 per metadata thread, and answers per id in order", async () => {
    const ids = THREAD_LIST.threads.map((t) => t.id);
    const c = client([
      batchReply((i, path) =>
        i === 1
          ? { status: 404, statusText: "Not Found", body: NOT_FOUND }
          : {
              status: 200,
              statusText: "OK",
              body: metadataThread(/threads\/(\w+)/.exec(path)![1]!, "9001"),
            },
      ),
    ]);
    const res = await c.gmail.getThreads(ids, {
      format: "metadata",
      metadataHeaders: ["From", "Subject"],
    });
    expect(c.sent).toHaveLength(1);
    expect(c.sent[0]!.url).toBe("https://gmail.googleapis.com/batch/gmail/v1");
    expect(String(c.sent[0]!.body)).toContain(
      "GET /gmail/v1/users/me/threads/18c0000000000001?format=metadata&metadataHeaders=From&metadataHeaders=Subject HTTP/1.1",
    );
    expect(res.map((r) => r.ok)).toEqual([true, false, true]);
    expect(res[0]!.ok && res[0]!.value.id).toBe(ids[0]!);
    expect(res[2]!.ok && res[2]!.value.messages[0]!.internalDate).toBe(
      1764150000000,
    );
    const missing = !res[1]!.ok ? res[1]!.error : null;
    expect(missing).toBeInstanceOf(GmailApiError);
    expect((missing as GmailApiError).reason).toBe("notFound");
    expect(c.pacer.stats().spentUnits).toBe(120);
  });

  test("a batch of 120 ids is three HTTP requests of ≤ 50", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `t${i}`);
    const ok = batchReply((_, path) => ({
      status: 200,
      statusText: "OK",
      body: metadataThread(/threads\/(\w+)/.exec(path)![1]!, "1"),
    }));
    const c = client([ok, ok, ok]);
    const res = await c.gmail.getThreads(ids, { format: "minimal" });
    expect(c.sent).toHaveLength(3);
    expect(res.map((r) => r.ok && r.value.id)).toEqual(ids);
  });

  test("a batch part refused for rate is retried alone after a shared pause", async () => {
    const c = client([
      batchReply((i, path) =>
        i === 0
          ? { status: 429, statusText: "Too Many Requests", body: RATE_LIMITED }
          : {
              status: 200,
              statusText: "OK",
              body: metadataThread(/threads\/(\w+)/.exec(path)![1]!, "1"),
            },
      ),
      batchReply((_, path) => ({
        status: 200,
        statusText: "OK",
        body: metadataThread(/threads\/(\w+)/.exec(path)![1]!, "1"),
      })),
    ]);
    const res = await c.gmail.getThreads(["a", "b"], { format: "metadata" });
    expect(res.every((r) => r.ok)).toBe(true);
    // A rate refusal waits on the pacer's shared pause, not a private sleep.
    expect(c.sleeps).toEqual([]);
    expect(c.now()).toBe(1_000);
    // The retry carried only the refused part.
    const retried = String(c.sent[1]!.body);
    expect(retried).toContain("/threads/a?");
    expect(retried).not.toContain("/threads/b?");
    // Both attempts were charged: Google counts a refused call too.
    expect(c.pacer.stats().spentUnits).toBe(120);
  });

  test("a 403 userRateLimitExceeded backs off by Retry-After and pauses the pacer", async () => {
    const c = client([
      json(403, USER_RATE_LIMITED_403, { "Retry-After": "5" }),
      json(200, THREAD_LIST),
    ]);
    await c.gmail.listThreads({});
    expect(c.sleeps).toEqual([]);
    expect(c.now()).toBe(5_000);
    expect(c.sent).toHaveLength(2);
  });

  test("a 5xx is retried within the bound (sleeping, the pacer untouched), then thrown in Google's words", async () => {
    const c = client([
      json(503, { error: { code: 503, message: "Backend Error" } }),
      json(503, { error: { code: 503, message: "Backend Error" } }),
      json(503, { error: { code: 503, message: "Backend Error" } }),
    ]);
    const err = await c.gmail.getProfile().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GmailApiError);
    expect((err as Error).message).toContain("HTTP 503");
    expect(c.sent).toHaveLength(3);
    expect(c.sleeps).toEqual([1_000, 2_000]);
    expect(c.pacer.stats().pausedForMs).toBeNull();
  });

  test("a refusal that is not transient is thrown at once", async () => {
    const c = client([json(404, NOT_FOUND)]);
    const err = await c.gmail
      .getThread("x", { format: "full" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GmailApiError);
    expect((err as GmailApiError).reason).toBe("notFound");
    expect(c.sent).toHaveLength(1);
    expect(c.pacer.stats().spentUnits).toBe(120);
  });

  test("an answer of an undocumented shape throws, never returns a guess", async () => {
    const c = client([json(200, { emailAddress: "a@b", historyId: 12 })]);
    const err = await c.gmail.getProfile().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GmailResponseShapeError);
  });

  test("history.list: a page, and 404 as an expired cursor", async () => {
    const c = client([json(200, HISTORY_PAGE), json(404, NOT_FOUND)]);
    const page = await c.gmail.listHistory({
      startHistoryId: "9001",
      historyTypes: ["messageAdded", "labelRemoved"],
    });
    expect(c.sent[0]!.url).toContain(
      "startHistoryId=9001&historyTypes=messageAdded&historyTypes=labelRemoved",
    );
    expect(page).toMatchObject({
      kind: "page",
      historyId: "9010",
      nextPageToken: null,
    });
    expect(
      page.kind === "page" && page.history[1]!.labelsRemoved![0]!.labelIds,
    ).toEqual(["INBOX"]);
    expect(await c.gmail.listHistory({ startHistoryId: "1" })).toEqual({
      kind: "expired",
    });
  });

  test("attachments decode base64url to bytes", async () => {
    const c = client([json(200, { size: 4, data: "_-8A_w" })]);
    expect([...(await c.gmail.getAttachment("m", "a"))]).toEqual([
      0xff, 0xef, 0x00, 0xff,
    ]);
  });

  test("send uploads the RFC 2822 bytes untouched, as multipart/related", async () => {
    const c = client([
      json(200, { id: "m1", threadId: "t1", labelIds: ["SENT"] }),
    ]);
    const rfc822 = new TextEncoder().encode("Subject: hé\r\n\r\nbody\r\n");
    const sent = await c.gmail.sendMessage({ rfc822, threadId: "t1" });
    expect(sent).toEqual({ id: "m1", threadId: "t1", labelIds: ["SENT"] });
    const req = c.sent[0]!;
    expect(req.url).toBe(
      "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart",
    );
    expect(req.headers["Content-Type"]).toMatch(
      /^multipart\/related; boundary=/,
    );
    const body = new TextDecoder().decode(req.body as Uint8Array);
    expect(body).toContain('{"threadId":"t1"}');
    expect(body).toContain(
      "Content-Type: message/rfc822\r\n\r\nSubject: hé\r\n\r\nbody\r\n",
    );
    expect(c.pacer.stats().spentUnits).toBe(100);
  });

  test("a delete's empty 204 parses as nothing", async () => {
    const c = client([() => new Response(null, { status: 204 })]);
    await c.gmail.deleteDraft("r1");
    expect(c.sent[0]!.method).toBe("DELETE");
  });

  test("a batch is split by units too, so no chunk is one the pacer refuses", async () => {
    // 100-unit window: background cap 50, chunks ≤ 25 units — one 20-unit message each.
    const ok = batchReply((_, path) => ({
      status: 200,
      statusText: "OK",
      body: { id: /messages\/(\w+)/.exec(path)![1]!, threadId: "t" },
    }));
    const c = client([ok, ok, ok], 100);
    const res = await c.gmail.getMessages(
      ["a", "b", "c"],
      { format: "metadata" },
      { priority: "background" },
    );
    expect(c.sent).toHaveLength(3);
    expect(res.map((r) => r.ok && r.value.id)).toEqual(["a", "b", "c"]);
  });

  test("one item of an undocumented shape fails alone; the rest of the batch stands", async () => {
    const c = client([
      batchReply((i, path) => ({
        status: 200,
        statusText: "OK",
        body:
          i === 0
            ? { id: "a" }
            : metadataThread(/threads\/(\w+)/.exec(path)![1]!, "1"),
      })),
    ]);
    const res = await c.gmail.getThreads(["a", "b"], { format: "metadata" });
    expect(!res[0]!.ok && res[0]!.error).toBeInstanceOf(
      GmailResponseShapeError,
    );
    expect(res[1]!.ok).toBe(true);
  });

  test("a send is never repeated after Google may have done it", async () => {
    const rfc822 = new TextEncoder().encode("Subject: x\r\n\r\nbody");
    const c = client([
      json(503, { error: { code: 503, message: "Backend Error" } }),
    ]);
    const err = await c.gmail.sendMessage({ rfc822 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GmailOutcomeUnknownError);
    expect(c.sent).toHaveLength(1);

    const dropped = client([
      () => {
        throw new TypeError("socket hang up");
      },
    ]);
    const err2 = await dropped.gmail.sendDraft("r1").catch((e: unknown) => e);
    expect(err2).toBeInstanceOf(GmailOutcomeUnknownError);
    expect(dropped.sent).toHaveLength(1);
  });

  test("a send refused for rate is retried: Google did nothing", async () => {
    const rfc822 = new TextEncoder().encode("Subject: x\r\n\r\nbody");
    const c = client([
      json(429, RATE_LIMITED),
      json(200, { id: "m1", threadId: "t1" }),
    ]);
    expect((await c.gmail.sendMessage({ rfc822 })).id).toBe("m1");
    expect(c.sent).toHaveLength(2);
  });

  test("a rate reason in error.details (ErrorInfo) counts as rate-limited", async () => {
    const c = client([
      json(403, {
        error: {
          code: 403,
          message: "Quota exceeded",
          status: "PERMISSION_DENIED",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              reason: "rateLimitExceeded",
            },
          ],
        },
      }),
      json(200, THREAD_LIST),
    ]);
    await c.gmail.listThreads({});
    expect(c.sent).toHaveLength(2);
  });

  test("an abort cuts a backoff sleep short", async () => {
    const ac = new AbortController();
    const r = replay([
      json(503, { error: { code: 503, message: "Backend Error" } }),
    ]);
    const gmail = createGmailClient({
      accessToken: async () => "tok",
      pacer: createQuotaPacer(),
      fetch: r.fetch,
      retry: { delay: () => 60_000 },
    });
    const p = gmail.getProfile({ signal: ac.signal });
    setTimeout(() => ac.abort(new Error("left")), 5);
    expect(p).rejects.toThrow("left");
  });
});

test("decodeBatch rejects an answer missing a part", () => {
  const body = batchAnswer("b", [
    { index: 0, status: 200, statusText: "OK", body: {} },
  ]);
  expect(() => decodeBatch("multipart/mixed; boundary=b", body, 2)).toThrow(
    "no answer for request(s) 1",
  );
});
