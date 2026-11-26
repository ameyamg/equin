import { describe, expect, it } from "bun:test";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { textField } from "@plugins/fields/plugins/text/plugins/config/core";
import { defineSyndicationTarget, type SyndicatedPost } from "../../core";
import {
  syndicationTarget,
  type SyndicationTargetContribution,
} from "../../server";
import { testPostOnce, type TestPostWorld } from "./test-post";

const decl = defineSyndicationTarget({
  id: "fake",
  label: "Fake",
  icon: symbol("send"),
  configFields: { channel: textField({ label: "Channel" }) },
});

const POST: SyndicatedPost = {
  title: "T",
  paragraphs: [],
  media: [],
  url: "https://a.test/tips",
};

function world(over: Partial<TestPostWorld> = {}) {
  const posted: { post: SyndicatedPost; config: unknown }[] = [];
  let disposed = 0;
  const target: SyndicationTargetContribution = syndicationTarget(decl, {
    validate: (c) => (c.channel === "" ? "Pick a channel." : null),
    post: async (post, config) => {
      posted.push({ post, config });
      return { ok: true, remoteId: "m1", url: "https://fake.test/m1" };
    },
  });
  const w: TestPostWorld = {
    target,
    item: async () => ({ unpostable: null }),
    settings: async () => ({ config: { channel: "tests" } }),
    stage: async () => ({
      post: POST,
      dispose: async () => {
        disposed += 1;
      },
    }),
    ...over,
  };
  return { w, posted, disposed: () => disposed };
}

const ctx = { signal: new AbortController().signal, workDir: "/tmp/x" };

describe("testPostOnce", () => {
  it("posts the item with the saved config and answers the link", async () => {
    const { w, posted, disposed } = world();
    expect(await testPostOnce(w, "fake", ctx)).toEqual({
      kind: "posted",
      remoteId: "m1",
      url: "https://fake.test/m1",
    });
    expect(posted).toEqual([{ post: POST, config: { channel: "tests" } }]);
    expect(disposed()).toBe(1);
  });

  it("refuses, posting nothing, what cannot be sent", async () => {
    for (const [over, words] of [
      [{ target: null }, 'posts to "fake"'],
      [{ item: async () => null }, "no longer exists"],
      [
        { item: async () => ({ unpostable: "No syndicate." }) },
        "No syndicate.",
      ],
      [{ settings: async () => null }, "Set Fake up first."],
      [
        { settings: async () => ({ config: { channel: "" } }) },
        "Pick a channel.",
      ],
    ] as const) {
      const { w, posted } = world(over);
      const answer = await testPostOnce(w, "fake", ctx);
      expect(answer.kind).toBe("failed");
      if (answer.kind === "failed") expect(answer.error).toContain(words);
      expect(posted).toEqual([]);
    }
  });

  it("answers the target's own refusal, and always disposes the staged files", async () => {
    let disposed = 0;
    const target = syndicationTarget(decl, {
      post: async () => ({ ok: false, error: "Rate limited", retryable: true }),
    });
    const { w } = world({
      target,
      stage: async () => ({
        post: POST,
        dispose: async () => {
          disposed += 1;
        },
      }),
    });
    expect(await testPostOnce(w, "fake", ctx)).toEqual({
      kind: "failed",
      error: "Rate limited",
    });
    expect(disposed).toBe(1);
  });
});
