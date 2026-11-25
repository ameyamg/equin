import { describe, expect, it } from "bun:test";
import { textField } from "@plugins/fields/plugins/text/plugins/config/core";
import { mediaField, type MediaRef } from "@plugins/fields/plugins/media/core";
import {
  defineSiteFeed,
  siteFeedEntryIdKind,
  type SiteFeedImportQuestion,
  type SiteFeedUpsertAnswer,
} from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import {
  PublishTransportError,
  publishItem,
  unpublishItem,
  type PublishTransport,
} from "./publish-flow";

const feed = defineSiteFeed({
  id: "notes",
  label: "Notes",
  fields: {
    title: textField({ label: "Title" }),
    media: mediaField({ label: "Media", accept: "*" }),
  },
  publicLimit: 10,
});

const A = "0b4d6c1e-1111-4a2b-8c3d-000000000001";
const B = "0b4d6c1e-1111-4a2b-8c3d-000000000002";

function ref(attachmentId: string, filename: string): MediaRef {
  return { attachmentId, filename, mime: "image/png", size: 3 };
}

const ID = siteFeedEntryIdKind.parse("sfe-1795600000-abc123");
const ITEM = {
  id: ID,
  feed,
  values: { title: "Hello", media: [ref(A, "a.png"), ref(B, "b.png")] },
  publishedAt: new Date("2026-11-25T10:00:00.000Z"),
};

/** A fake box: records every call, answers what each test says. */
function fakeBox(over: Partial<PublishTransport> = {}) {
  const calls: string[] = [];
  const disposed: string[] = [];
  const transport: PublishTransport = {
    missing: async (ids) => {
      calls.push(`missing ${ids.join(",")}`);
      return { kind: "answer", value: { missing: [B] } };
    },
    stage: async (r) => {
      calls.push(`stage ${r.attachmentId}`);
      return {
        path: `/tmp/${r.attachmentId}`,
        sha256: "f".repeat(64),
        size: 3,
        dispose: async () => {
          disposed.push(r.attachmentId);
        },
      };
    },
    upload: async (local, name) => {
      calls.push(`upload ${local} ${name}`);
      return { kind: "uploaded" };
    },
    importMedia: async (q: SiteFeedImportQuestion) => {
      calls.push(
        `import ${q.attachmentId} ${q.stagedName} ${q.sha256.slice(0, 4)}`,
      );
      return {
        kind: "answer",
        value: { kind: "imported", attachmentId: q.attachmentId },
      };
    },
    upsert: async (body) => {
      calls.push(`upsert ${body.id} ${body.publishedAt}`);
      return {
        kind: "answer",
        value: { kind: "upserted", id: body.id, updatedAt: "now" },
      };
    },
    delete: async (body) => {
      calls.push(`delete ${body.id}`);
      return { kind: "answer", value: { kind: "deleted" } };
    },
    ...over,
  };
  return { transport, calls, disposed };
}

describe("publishItem", () => {
  it("transfers only what the box lacks, imports it, then upserts", async () => {
    const box = fakeBox();
    expect(await publishItem(box.transport, ITEM)).toEqual({
      kind: "published",
      transferred: 1,
    });
    expect(box.calls).toEqual([
      `missing ${A},${B}`,
      `stage ${B}`,
      `upload /tmp/${B} ${B}`,
      `import ${B} ${B} ffff`,
      `upsert ${ID} 2026-11-25T10:00:00.000Z`,
    ]);
    // The staged copy is removed once sent.
    expect(box.disposed).toEqual([B]);
  });

  it("asks nothing about files for an item without media", async () => {
    const box = fakeBox();
    await publishItem(box.transport, {
      ...ITEM,
      values: { title: "x", media: [] },
    });
    expect(box.calls).toEqual([`upsert ${ID} 2026-11-25T10:00:00.000Z`]);
  });

  it("names a site running an older feed, with its issues, as refused", async () => {
    const box = fakeBox({
      upsert: async () => ({
        kind: "answer",
        value: {
          kind: "invalid-values",
          issues: [{ path: ["media"], message: "unknown field" }],
        } satisfies SiteFeedUpsertAnswer,
      }),
    });
    const outcome = await publishItem(box.transport, ITEM);
    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") {
      expect(outcome.message).toContain(
        "older version of this feed — deploy it",
      );
      expect(outcome.message).toContain("media: unknown field");
    }
  });

  it("stops at an import refusal before the upsert, still removing the staged copy", async () => {
    const box = fakeBox({
      importMedia: async () => ({
        kind: "answer",
        value: { kind: "sha256-mismatch", expected: "a", actual: "b" },
      }),
    });
    const outcome = await publishItem(box.transport, ITEM);
    expect(outcome.kind).toBe("refused");
    expect(box.calls.some((c) => c.startsWith("upsert"))).toBe(false);
    expect(box.disposed).toEqual([B]);
  });

  it("refuses for good on a site whose release lacks the routes", async () => {
    const box = fakeBox({
      missing: async () => ({
        kind: "route-missing",
        path: "/api/host-only/x",
      }),
    });
    const outcome = await publishItem(box.transport, ITEM);
    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused")
      expect(outcome.message).toContain("deploy it again");
  });

  it("throws a transport failure, for the job to retry", async () => {
    const box = fakeBox({
      upload: async () => ({
        kind: "ssh-failed",
        failure: "unreachable",
        message: "no route",
        stderr: "",
      }),
    });
    let thrown: unknown;
    try {
      await publishItem(box.transport, ITEM);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(PublishTransportError);
    expect(box.disposed).toEqual([B]);
  });

  it("refuses for good on an SSH failure no retry cures", async () => {
    const box = fakeBox({
      missing: async () => ({
        kind: "ssh-failed",
        failure: "auth",
        message: "key refused",
        stderr: "",
      }),
    });
    expect((await publishItem(box.transport, ITEM)).kind).toBe("refused");
  });
});

describe("unpublishItem", () => {
  it("treats an absent entry as unpublished", async () => {
    const box = fakeBox({
      delete: async () => ({ kind: "answer", value: { kind: "absent" } }),
    });
    expect(
      await unpublishItem(box.transport, { id: ID, feedId: "notes" }),
    ).toEqual({
      kind: "unpublished",
    });
  });

  it("throws when the site does not answer", async () => {
    const box = fakeBox({
      delete: async () => ({
        kind: "request-failed",
        exitCode: 7,
        stderr: "down",
      }),
    });
    let thrown: unknown;
    try {
      await unpublishItem(box.transport, { id: ID, feedId: "notes" });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(PublishTransportError);
  });
});
