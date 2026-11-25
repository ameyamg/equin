import { describe, expect, it } from "bun:test";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { textField } from "@plugins/fields/plugins/text/plugins/config/core";
import { defineSyndicationTarget, type SyndicatedPost } from "../../core";
import {
  syndicationTarget,
  type SyndicationTargetCalls,
} from "../../server/internal/targets";
import {
  decideSyndication,
  syndicateOnce,
  type SyndicationWorld,
} from "./flow";

const fakeDecl = defineSyndicationTarget({
  id: "fake",
  label: "Fake",
  icon: symbol("send"),
  configFields: { channel: textField({ label: "Channel" }) },
});

const POST: SyndicatedPost = {
  title: "A tip",
  paragraphs: ["Body"],
  media: [],
  url: "https://example.com/tips",
};

/** A fake target recording every call; each answer is the test's to choose. */
function fakeTarget(
  answers: Partial<SyndicationTargetCalls<{ channel: string }>> = {},
  opts: { edit?: boolean; remove?: boolean } = {},
) {
  const calls: string[] = [];
  const target = syndicationTarget(fakeDecl, {
    post: async (post, config) => {
      calls.push(`post:${post.title}:${config.channel}`);
      return answers.post
        ? answers.post(post, config, ctx)
        : { ok: true, remoteId: "m-1" };
    },
    ...(opts.edit !== false
      ? {
          edit: async (remoteId, post, config) => {
            calls.push(`edit:${remoteId}`);
            return answers.edit
              ? answers.edit(remoteId, post, config, ctx)
              : { ok: true, remoteId };
          },
        }
      : {}),
    ...(opts.remove !== false
      ? {
          remove: async (remoteId, config) => {
            calls.push(`remove:${remoteId}`);
            return answers.remove
              ? answers.remove(remoteId, config, ctx)
              : { ok: true };
          },
        }
      : {}),
  });
  return { target, calls };
}

const ctx = { signal: new AbortController().signal, workDir: "/nowhere" };

function world(
  target: SyndicationWorld["target"],
  state: {
    published: boolean;
    remoteId: string | null;
    enabled?: boolean;
    unpostable?: string | null;
    settings?: boolean;
  },
) {
  const disposed: number[] = [];
  const w: SyndicationWorld = {
    item: async () => ({
      published: state.published,
      unpostable: state.unpostable ?? null,
    }),
    remoteId: async () => state.remoteId,
    target,
    settings: async () =>
      state.settings === false
        ? null
        : { enabled: state.enabled ?? true, config: { channel: "tips" } },
    stage: async () => ({
      post: POST,
      dispose: async () => {
        disposed.push(1);
      },
    }),
  };
  return { w, disposed };
}

describe("decideSyndication", () => {
  it("routes by the item's state and what the target holds", () => {
    const d = (published: boolean, remoteId: string | null, can = true) =>
      decideSyndication({ published, remoteId, canEdit: can, canRemove: can });
    expect(d(true, null)).toBe("post");
    expect(d(true, "m")).toBe("edit");
    expect(d(true, "m", false)).toBe("keep");
    expect(d(false, null)).toBe("forget");
    expect(d(false, "m")).toBe("remove");
    expect(d(false, "m", false)).toBe("cannot-remove");
  });
});

describe("syndicateOnce", () => {
  it("posts a published item the target does not hold, config parsed", async () => {
    const { target, calls } = fakeTarget();
    const { w, disposed } = world(target, { published: true, remoteId: null });
    expect(await syndicateOnce(w, "fake", ctx)).toEqual({
      kind: "posted",
      remoteId: "m-1",
    });
    expect(calls).toEqual(["post:A tip:tips"]);
    expect(disposed).toEqual([1]);
  });

  it("edits a published item it already posted, keeping a new id the edit answers", async () => {
    const { target, calls } = fakeTarget({
      edit: async () => ({ ok: true, remoteId: "m-2" }),
    });
    const { w } = world(target, { published: true, remoteId: "m-1" });
    expect(await syndicateOnce(w, "fake", ctx)).toEqual({
      kind: "posted",
      remoteId: "m-2",
    });
    expect(calls).toEqual(["edit:m-1"]);
  });

  it("keeps the post of a target that cannot edit", async () => {
    const { target, calls } = fakeTarget({}, { edit: false });
    const { w } = world(target, { published: true, remoteId: "m-1" });
    expect(await syndicateOnce(w, "fake", ctx)).toEqual({
      kind: "posted",
      remoteId: "m-1",
    });
    expect(calls).toEqual([]);
  });

  it("removes an unpublished item's post — even with the target turned off", async () => {
    const { target, calls } = fakeTarget();
    const { w } = world(target, {
      published: false,
      remoteId: "m-1",
      enabled: false,
    });
    expect(await syndicateOnce(w, "fake", ctx)).toEqual({ kind: "gone" });
    expect(calls).toEqual(["remove:m-1"]);
  });

  it("forgets an unpublished item that was never posted, calling nothing", async () => {
    const { target, calls } = fakeTarget();
    const { w } = world(target, { published: false, remoteId: null });
    expect(await syndicateOnce(w, "fake", ctx)).toEqual({ kind: "gone" });
    expect(calls).toEqual([]);
  });

  it("says a target that cannot remove leaves the post", async () => {
    const { target } = fakeTarget({}, { remove: false });
    const { w } = world(target, { published: false, remoteId: "m-1" });
    const out = await syndicateOnce(w, "fake", ctx);
    expect(out.kind).toBe("failed");
  });

  it("retries only what the target calls retryable", async () => {
    const retry = fakeTarget({
      post: async () => ({ ok: false, error: "rate limited", retryable: true }),
    });
    expect(
      await syndicateOnce(
        world(retry.target, { published: true, remoteId: null }).w,
        "fake",
        ctx,
      ),
    ).toEqual({ kind: "retry", error: "rate limited" });
    const refuse = fakeTarget({
      post: async () => ({ ok: false, error: "too big", retryable: false }),
    });
    expect(
      await syndicateOnce(
        world(refuse.target, { published: true, remoteId: null }).w,
        "fake",
        ctx,
      ),
    ).toEqual({ kind: "failed", error: "too big" });
  });

  it("posts nothing while the target is off, or the feed cannot be posted", async () => {
    const off = fakeTarget();
    const a = await syndicateOnce(
      world(off.target, { published: true, remoteId: null, enabled: false }).w,
      "fake",
      ctx,
    );
    expect(a.kind).toBe("failed");
    const unpostable = await syndicateOnce(
      world(off.target, {
        published: true,
        remoteId: null,
        unpostable: "no syndicate",
      }).w,
      "fake",
      ctx,
    );
    expect(unpostable).toEqual({ kind: "failed", error: "no syndicate" });
    const unset = await syndicateOnce(
      world(off.target, { published: true, remoteId: null, settings: false }).w,
      "fake",
      ctx,
    );
    expect(unset.kind).toBe("failed");
    expect(off.calls).toEqual([]);
  });

  it("disposes the staged files when the target throws, and throws through", async () => {
    const { target } = fakeTarget({
      post: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const { w, disposed } = world(target, { published: true, remoteId: null });
    expect(syndicateOnce(w, "fake", ctx)).rejects.toThrow("fetch failed");
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(disposed).toEqual([1]);
  });

  it("answers nothing for an item gone, and fails for a target gone", async () => {
    const { target } = fakeTarget();
    const gone: SyndicationWorld = {
      ...world(target, { published: true, remoteId: null }).w,
      item: async () => null,
    };
    expect(await syndicateOnce(gone, "fake", ctx)).toEqual({ kind: "nothing" });
    const noTarget = world(null, { published: true, remoteId: null }).w;
    expect((await syndicateOnce(noTarget, "fake", ctx)).kind).toBe("failed");
  });
});
