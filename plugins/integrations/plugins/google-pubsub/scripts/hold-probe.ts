// ─── Pub/Sub held-pull probe, on the connected Google account ────────────────
//
//   ./equin run plugins/integrations/plugins/google-pubsub/scripts/hold-probe.ts \
//     [--topic projects/<p>/topics/<t>] \
//     [--subscription projects/<p>/subscriptions/<s> [--pulls 3]]
//
// Says whether the Google connection carries the pubsub scope. With --topic:
// reads that topic's IAM policy (read-only) and prints its bindings. With
// --subscription (an existing pull subscription): issues `--pulls` held pulls one after another WITHOUT acking, printing how long
// each was held and how many messages it carried — what the push consumer
// relies on (a pull held until a message is published). Never acks, so a
// consumer still receives everything after the ack deadline.

import { getPubSubToken } from "../server";
import { createPubSubClient } from "../server";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const t = await getPubSubToken();
console.log(
  t.ok ? "pubsub scope: granted" : `pubsub scope: no token — ${t.message}`,
);
const client = createPubSubClient({
  accessToken: async (o) => {
    const r = await getPubSubToken({ refused: o?.refused });
    if (!r.ok) throw new Error(r.message);
    return r.accessToken;
  },
});
const topic = flag("topic");
if (t.ok && topic) {
  const policy = await client.getTopicPolicy(topic);
  console.log(
    `${topic} policy (etag ${policy.etag ?? "none"}): ${JSON.stringify(policy.bindings ?? [])}`,
  );
}
const subscription = flag("subscription");
if (t.ok && subscription) {
  const pulls = Number(flag("pulls") ?? "3");
  for (let i = 0; i < pulls; i++) {
    const t0 = performance.now();
    const r = await client.pull(subscription, { maxMessages: 10 });
    const ms = Math.round(performance.now() - t0);
    console.log(
      r.kind === "gone"
        ? `pull ${i + 1}: subscription gone (${ms} ms)`
        : `pull ${i + 1}: held ${ms} ms, ${r.messages.length} message(s)`,
    );
  }
}
