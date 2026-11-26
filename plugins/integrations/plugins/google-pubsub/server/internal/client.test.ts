import { describe, expect, test } from "bun:test";
import { PubSubApiError } from "../../core";
import { createPubSubClient, messageText } from "./client";

type Seen = { method: string; url: string; body: unknown; auth: string };

function fake(answers: Array<{ status: number; body?: unknown }>) {
  const seen: Seen[] = [];
  const tokens: Array<{ refused?: string } | undefined> = [];
  let n = 0;
  const client = createPubSubClient({
    accessToken: async (o) => {
      tokens.push(o);
      return o?.refused ? "fresh" : "stale";
    },
    fetch: async (url, init) => {
      seen.push({
        method: init.method!,
        url,
        body: init.body ? JSON.parse(init.body as string) : undefined,
        auth: (init.headers as Record<string, string>).Authorization!,
      });
      const a = answers[n++];
      if (!a) throw new Error(`unexpected request ${init.method} ${url}`);
      return new Response(a.body === undefined ? "" : JSON.stringify(a.body), {
        status: a.status,
      });
    },
  });
  return { client, seen, tokens };
}

const T = "projects/p/topics/equin-gmail";
const S = "projects/p/subscriptions/equin-gmail-main";

describe("the Pub/Sub client", () => {
  test("ensureTopic creates, and answers existed on 409", async () => {
    const f = fake([
      { status: 200, body: { name: T } },
      {
        status: 409,
        body: {
          error: { code: 409, message: "exists", status: "ALREADY_EXISTS" },
        },
      },
    ]);
    expect(await f.client.ensureTopic(T)).toEqual({ existed: false });
    expect(await f.client.ensureTopic(T)).toEqual({ existed: true });
    expect(f.seen[0]).toMatchObject({
      method: "PUT",
      url: `https://pubsub.googleapis.com/v1/${T}`,
    });
  });

  test("a disabled API is typed, with its activation link", async () => {
    const f = fake([
      {
        status: 403,
        body: {
          error: {
            code: 403,
            message: "Cloud Pub/Sub API has not been used in project 123",
            status: "PERMISSION_DENIED",
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                reason: "SERVICE_DISABLED",
                metadata: {
                  activationUrl:
                    "https://console.developers.google.com/apis/api/pubsub.googleapis.com/overview?project=123",
                },
              },
            ],
          },
        },
      },
    ]);
    const err = await f.client.ensureTopic(T).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PubSubApiError);
    const e = err as PubSubApiError;
    expect(e.serviceDisabled).toBe(true);
    expect(e.reason).toBe("SERVICE_DISABLED");
    expect(e.activationUrl).toContain("pubsub.googleapis.com");
  });

  test("grantOnTopic adds the member under the policy's etag, once", async () => {
    const f = fake([
      {
        status: 200,
        body: {
          etag: "BwX",
          bindings: [{ role: "roles/pubsub.viewer", members: ["user:a@x"] }],
        },
      },
      { status: 200, body: {} },
      {
        status: 200,
        body: {
          etag: "BwY",
          bindings: [
            { role: "roles/pubsub.publisher", members: ["serviceAccount:g"] },
          ],
        },
      },
    ]);
    expect(
      await f.client.grantOnTopic(
        T,
        "roles/pubsub.publisher",
        "serviceAccount:g",
      ),
    ).toEqual({ added: true });
    expect(f.seen[1]!.body).toEqual({
      policy: {
        etag: "BwX",
        bindings: [
          { role: "roles/pubsub.viewer", members: ["user:a@x"] },
          { role: "roles/pubsub.publisher", members: ["serviceAccount:g"] },
        ],
      },
    });
    expect(
      await f.client.grantOnTopic(
        T,
        "roles/pubsub.publisher",
        "serviceAccount:g",
      ),
    ).toEqual({ added: false });
    expect(f.seen).toHaveLength(3);
  });

  test("ensureSubscription refuses a same-named subscription on another topic", async () => {
    const f = fake([
      { status: 409, body: { error: { code: 409, message: "exists" } } },
      { status: 200, body: { name: S, topic: "projects/p/topics/other" } },
    ]);
    const refused = await f.client
      .ensureSubscription(S, {
        topic: T,
        ackDeadlineSeconds: 10,
        messageRetention: "600s",
        expireAfterIdle: null,
      })
      .catch((e: unknown) => e);
    expect(String(refused)).toContain(
      "already exists on projects/p/topics/other",
    );
    expect(f.seen[0]!.body).toEqual({
      topic: T,
      ackDeadlineSeconds: 10,
      messageRetentionDuration: "600s",
      expirationPolicy: {},
    });
  });

  test("a pull answers messages, an empty {} as none, and 404 as gone", async () => {
    const data = Buffer.from('{"emailAddress":"me@x","historyId":42}').toString(
      "base64",
    );
    const f = fake([
      {
        status: 200,
        body: {
          receivedMessages: [
            {
              ackId: "a1",
              message: {
                data,
                messageId: "1",
                publishTime: "2026-11-26T10:00:00Z",
              },
            },
          ],
        },
      },
      { status: 200, body: {} },
      {
        status: 404,
        body: { error: { code: 404, message: "no sub", status: "NOT_FOUND" } },
      },
    ]);
    const r = await f.client.pull(S, { maxMessages: 10 });
    expect(r.kind).toBe("messages");
    if (r.kind !== "messages") throw new Error("unreachable");
    expect(r.messages.map((m) => m.ackId)).toEqual(["a1"]);
    expect(messageText(r.messages[0]!)).toBe(
      '{"emailAddress":"me@x","historyId":42}',
    );
    expect(await f.client.pull(S, { maxMessages: 10 })).toEqual({
      kind: "messages",
      messages: [],
    });
    expect(await f.client.pull(S, { maxMessages: 10 })).toEqual({
      kind: "gone",
    });
  });

  test("a 401 is sent once more with a token asked past the refused one", async () => {
    const f = fake([
      { status: 401, body: { error: { code: 401, message: "expired" } } },
      { status: 200, body: {} },
    ]);
    await f.client.acknowledge(S, ["a1"]);
    expect(f.tokens).toEqual([undefined, { refused: "stale" }]);
    expect(f.seen.map((s) => s.auth)).toEqual(["Bearer stale", "Bearer fresh"]);
  });
});
