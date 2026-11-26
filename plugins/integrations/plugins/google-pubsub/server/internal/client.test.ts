import { describe, expect, test } from "bun:test";
import { PubSubApiError } from "../../core";
import {
  createPubSubClient,
  messageText,
  PUBSUB_METHODS,
  pubsubUrl,
} from "./client";

type Seen = { method: string; url: string; body: unknown; auth: string };

/**
 * A replay of Google's answers, each pinned to the exact request it answers
 * (`"<VERB> <url>"`): a request with another verb or URL fails the test.
 */
function fake(
  answers: Array<{ req: string; status: number; body?: unknown; raw?: string }>,
) {
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
      const req = `${init.method} ${url}`;
      if (!a) throw new Error(`unexpected request ${req}`);
      if (a.req !== req)
        throw new Error(`expected request ${a.req}, got ${req}`);
      return new Response(
        a.raw ?? (a.body === undefined ? "" : JSON.stringify(a.body)),
        { status: a.status },
      );
    },
  });
  return { client, seen, tokens };
}

const T = "projects/p/topics/equin-gmail";
const S = "projects/p/subscriptions/equin-gmail-main";
const V1 = "https://pubsub.googleapis.com/v1";

/**
 * Google's own declaration of each method, copied from the discovery document
 * (`https://pubsub.googleapis.com/$discovery/rest?version=v1`, fetched
 * 2026-11-26): `httpMethod`, `path`, and whether it has a `request`.
 */
const DISCOVERY: Record<string, [string, string, boolean]> = {
  "pubsub.projects.topics.create": ["PUT", "v1/{+name}", true],
  "pubsub.projects.topics.getIamPolicy": [
    "GET",
    "v1/{+resource}:getIamPolicy",
    false,
  ],
  "pubsub.projects.topics.setIamPolicy": [
    "POST",
    "v1/{+resource}:setIamPolicy",
    true,
  ],
  "pubsub.projects.subscriptions.create": ["PUT", "v1/{+name}", true],
  "pubsub.projects.subscriptions.get": ["GET", "v1/{+subscription}", false],
  "pubsub.projects.subscriptions.delete": [
    "DELETE",
    "v1/{+subscription}",
    false,
  ],
  "pubsub.projects.subscriptions.pull": [
    "POST",
    "v1/{+subscription}:pull",
    true,
  ],
  "pubsub.projects.subscriptions.acknowledge": [
    "POST",
    "v1/{+subscription}:acknowledge",
    true,
  ],
};

describe("the Pub/Sub client", () => {
  test("every method is sent as Google's discovery document declares it", () => {
    expect(
      Object.fromEntries(
        Object.entries(PUBSUB_METHODS).map(([m, d]) => [
          `pubsub.projects.${m}`,
          [d.httpMethod, `v1/${d.path}`, d.request],
        ]),
      ),
    ).toEqual(DISCOVERY);
    expect(pubsubUrl("topics.getIamPolicy", T)).toBe(`${V1}/${T}:getIamPolicy`);
  });

  test("an HTML answer is refused in a few words, not as the page", async () => {
    const f = fake([
      {
        req: `PUT ${V1}/${T}`,
        status: 404,
        raw: "<!DOCTYPE html>\n<html lang=en><meta charset=utf-8><title>Error 404 (Not Found)!!1</title><style>*{margin:0}</style><p>The requested URL was not found on this server.</p>",
      },
    ]);
    const err = await f.client.ensureTopic(T).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PubSubApiError);
    expect((err as PubSubApiError).message).toBe(
      `Pub/Sub refused topics.create ${T} (HTTP 404): an HTML page ("Error 404 (Not Found)!!1") instead of a Pub/Sub answer: no Pub/Sub method serves this URL and verb`,
    );
  });

  test("ensureTopic creates, and answers existed on 409", async () => {
    const f = fake([
      { req: `PUT ${V1}/${T}`, status: 200, body: { name: T } },
      {
        req: `PUT ${V1}/${T}`,
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
        req: `PUT ${V1}/${T}`,
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
        req: `GET ${V1}/${T}:getIamPolicy`,
        status: 200,
        body: {
          etag: "BwX",
          bindings: [{ role: "roles/pubsub.viewer", members: ["user:a@x"] }],
        },
      },
      { req: `POST ${V1}/${T}:setIamPolicy`, status: 200, body: {} },
      {
        req: `GET ${V1}/${T}:getIamPolicy`,
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
      {
        req: `PUT ${V1}/${S}`,
        status: 409,
        body: { error: { code: 409, message: "exists" } },
      },
      {
        req: `GET ${V1}/${S}`,
        status: 200,
        body: { name: S, topic: "projects/p/topics/other" },
      },
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
        req: `POST ${V1}/${S}:pull`,
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
      { req: `POST ${V1}/${S}:pull`, status: 200, body: {} },
      {
        req: `POST ${V1}/${S}:pull`,
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
      {
        req: `POST ${V1}/${S}:acknowledge`,
        status: 401,
        body: { error: { code: 401, message: "expired" } },
      },
      { req: `POST ${V1}/${S}:acknowledge`, status: 200, body: {} },
    ]);
    await f.client.acknowledge(S, ["a1"]);
    expect(f.tokens).toEqual([undefined, { refused: "stale" }]);
    expect(f.seen.map((s) => s.auth)).toEqual(["Bearer stale", "Bearer fresh"]);
  });
});
