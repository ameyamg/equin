import type { z } from "zod";
import {
  PubSubApiError,
  PubSubResponseShapeError,
  PubSubUnreachableError,
} from "../../core";
import {
  EmptySchema,
  ErrorEnvelopeSchema,
  IamPolicySchema,
  PullResponseSchema,
  SubscriptionSchema,
  TopicSchema,
  PUBSUB_PULL_MAX,
  type IamPolicy,
  type ReceivedMessage,
} from "./schemas";

/** Root of Pub/Sub's REST API; every resource name hangs off `/v1/`. */
export const PUBSUB_API_ROOT = "https://pubsub.googleapis.com";

export type PubSubClientOptions = {
  /**
   * A valid pubsub-scoped access token, asked for once per request. On a 401
   * the request is sent once more with a token asked for with `{ refused }`
   * (the broker refreshes it if it still holds that one); a second 401 throws.
   */
  accessToken: (o?: { refused?: string }) => Promise<string>;
  /** Tests replay recorded answers through this. Default: global `fetch`. */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
};

export type PubSubClient = ReturnType<typeof createPubSubClient>;

/** `projects/<project>/topics/<topic>`. */
export function topicName(project: string, topic: string): string {
  return `projects/${project}/topics/${topic}`;
}

/** `projects/<project>/subscriptions/<subscription>`. */
export function subscriptionName(
  project: string,
  subscription: string,
): string {
  return `projects/${project}/subscriptions/${subscription}`;
}

/** Google's refusal as a typed error, from its JSON error envelope. */
function apiError(what: string, status: number, text: string): PubSubApiError {
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
  }
  const env = ErrorEnvelopeSchema.safeParse(json);
  if (!env.success)
    return new PubSubApiError(
      what,
      status,
      null,
      text.slice(0, 300) || "no body",
      null,
    );
  const details = env.data.error.details ?? [];
  const reason =
    details.find((d) => d.reason)?.reason ?? env.data.error.status ?? null;
  const activationUrl =
    details.find((d) => d.metadata?.activationUrl)?.metadata?.activationUrl ??
    null;
  return new PubSubApiError(
    what,
    status,
    reason,
    env.data.error.message,
    activationUrl,
  );
}

function parseBody<T>(what: string, text: string, schema: z.ZodType<T>): T {
  let json: unknown;
  try {
    json = text.trim() === "" ? {} : JSON.parse(text);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    throw new PubSubResponseShapeError(what, `not JSON: ${text.slice(0, 300)}`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success)
    throw new PubSubResponseShapeError(what, parsed.error.message);
  return parsed.data;
}

/**
 * The Pub/Sub calls a pull consumer and its setup need, one HTTP request
 * each, no retry: a setup is a click (its failure is shown), and a consumer
 * owns its own reconnect.
 */
export function createPubSubClient(opts: PubSubClientOptions) {
  const doFetch =
    opts.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));

  async function send(
    what: string,
    method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE",
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
  ): Promise<{ status: number; text: string }> {
    const once = async (token: string) => {
      try {
        const res = await doFetch(`${PUBSUB_API_ROOT}/v1/${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json; charset=UTF-8" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal,
        });
        return { status: res.status, text: await res.text(), token };
      } catch (err) {
        if (signal?.aborted) throw err;
        throw new PubSubUnreachableError(what, err);
      }
    };
    const first = await once(await opts.accessToken());
    if (first.status !== 401) return first;
    // Google did nothing on a 401: send it again with a refreshed token.
    return once(await opts.accessToken({ refused: first.token }));
  }

  /** The parsed answer, or `null` for a status the caller expects (`expect`). */
  async function call<T>(
    spec: {
      what: string;
      method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE";
      path: string;
      body?: unknown;
      schema: z.ZodType<T>;
      expect?: readonly number[];
    },
    signal?: AbortSignal,
  ): Promise<{ ok: true; value: T } | { ok: false; status: number }> {
    const { status, text } = await send(
      spec.what,
      spec.method,
      spec.path,
      spec.body,
      signal,
    );
    if (status >= 200 && status < 300)
      return { ok: true, value: parseBody(spec.what, text, spec.schema) };
    if (spec.expect?.includes(status)) return { ok: false, status };
    throw apiError(spec.what, status, text);
  }

  async function getTopicPolicy(topic: string): Promise<IamPolicy> {
    const r = await call({
      what: `topics.getIamPolicy ${topic}`,
      method: "POST",
      path: `${topic}:getIamPolicy`,
      body: {},
      schema: IamPolicySchema,
    });
    if (!r.ok) throw new Error("unreachable: getIamPolicy expects no status");
    return r.value;
  }

  return {
    /** Creates the topic; `existed` when it was already there (409). */
    async ensureTopic(name: string): Promise<{ existed: boolean }> {
      const r = await call({
        what: `topics.create ${name}`,
        method: "PUT",
        path: name,
        body: {},
        schema: TopicSchema,
        expect: [409],
      });
      return { existed: !r.ok };
    },

    getTopicPolicy,

    /**
     * Adds `member` to `role` on the topic's policy, read-modify-write under
     * the policy's etag (a concurrent edit makes Google refuse it, 409).
     * `added: false` when the binding was already there.
     */
    async grantOnTopic(
      topic: string,
      role: string,
      member: string,
    ): Promise<{ added: boolean }> {
      const policy = await getTopicPolicy(topic);
      const bindings = policy.bindings ?? [];
      const binding = bindings.find((b) => b.role === role);
      if (binding?.members?.includes(member)) return { added: false };
      const next: IamPolicy = {
        ...policy,
        bindings: binding
          ? bindings.map((b) =>
              b === binding
                ? { ...b, members: [...(b.members ?? []), member] }
                : b,
            )
          : [...bindings, { role, members: [member] }],
      };
      await call({
        what: `topics.setIamPolicy ${topic}`,
        method: "POST",
        path: `${topic}:setIamPolicy`,
        body: { policy: next },
        schema: IamPolicySchema,
      });
      return { added: true };
    },

    /**
     * Creates a pull subscription on `topic`; `existed` when one of that name
     * was already there (409 — its topic is then checked: a subscription of
     * that name on another topic is refused, never silently consumed).
     * `expireAfterIdle`: Pub/Sub deletes it after this long with no pull
     * (≥ 1 day, `"86400s"`); null keeps it forever.
     */
    async ensureSubscription(
      name: string,
      s: {
        topic: string;
        ackDeadlineSeconds: number;
        messageRetention: string;
        expireAfterIdle: string | null;
      },
    ): Promise<{ existed: boolean }> {
      const r = await call({
        what: `subscriptions.create ${name}`,
        method: "PUT",
        path: name,
        body: {
          topic: s.topic,
          ackDeadlineSeconds: s.ackDeadlineSeconds,
          messageRetentionDuration: s.messageRetention,
          // An empty policy (no ttl) never expires.
          expirationPolicy:
            s.expireAfterIdle === null ? {} : { ttl: s.expireAfterIdle },
        },
        schema: SubscriptionSchema,
        expect: [409],
      });
      if (r.ok) return { existed: false };
      const existing = await call({
        what: `subscriptions.get ${name}`,
        method: "GET",
        path: name,
        schema: SubscriptionSchema,
      });
      if (existing.ok && existing.value.topic !== s.topic)
        throw new PubSubApiError(
          `subscriptions.create ${name}`,
          409,
          "ALREADY_EXISTS",
          `a subscription of that name already exists on ${existing.value.topic}, not ${s.topic}`,
          null,
        );
      return { existed: true };
    },

    async deleteSubscription(name: string): Promise<void> {
      await call({
        what: `subscriptions.delete ${name}`,
        method: "DELETE",
        path: name,
        schema: EmptySchema,
        expect: [404],
      });
    },

    /**
     * One held pull: Pub/Sub keeps the request open until messages arrive
     * (answering at once with them) or it lets the request go empty. `gone`
     * when the subscription no longer exists (404: deleted, or expired idle).
     */
    async pull(
      subscription: string,
      p: { maxMessages: number; signal?: AbortSignal },
    ): Promise<
      { kind: "messages"; messages: ReceivedMessage[] } | { kind: "gone" }
    > {
      if (p.maxMessages < 1 || p.maxMessages > PUBSUB_PULL_MAX)
        throw new Error(
          `Pub/Sub pull: maxMessages ${p.maxMessages} outside 1…${PUBSUB_PULL_MAX}`,
        );
      const r = await call(
        {
          what: `subscriptions.pull ${subscription}`,
          method: "POST",
          path: `${subscription}:pull`,
          body: { maxMessages: p.maxMessages },
          schema: PullResponseSchema,
          expect: [404],
        },
        p.signal,
      );
      if (!r.ok) return { kind: "gone" };
      return { kind: "messages", messages: r.value.receivedMessages ?? [] };
    },

    async acknowledge(
      subscription: string,
      ackIds: readonly string[],
    ): Promise<void> {
      if (ackIds.length === 0) return;
      await call({
        what: `subscriptions.acknowledge ${subscription}`,
        method: "POST",
        path: `${subscription}:acknowledge`,
        body: { ackIds },
        schema: EmptySchema,
      });
    },
  };
}

/** A received message's data, decoded from Base64 as UTF-8 text. */
export function messageText(m: ReceivedMessage): string {
  return m.message.data === undefined
    ? ""
    : Buffer.from(m.message.data, "base64").toString("utf8");
}
