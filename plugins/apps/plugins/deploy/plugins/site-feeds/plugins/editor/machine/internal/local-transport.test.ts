import { describe, expect, it } from "bun:test";
import { textField } from "@plugins/fields/plugins/text/plugins/config/core";
import { mediaField } from "@plugins/fields/plugins/media/core";
import {
  defineSiteFeed,
  siteFeedEntryIdKind,
  type SiteFeedUpsertBody,
} from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import { publishItem, unpublishItem } from "./publish-flow";
import { localTransport, type LocalBox } from "./local-transport";

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
const ID = siteFeedEntryIdKind.parse("sfe-1795600000-abc123");
const ITEM = {
  id: ID,
  feed,
  values: {
    title: "Hello",
    media: [{ attachmentId: A, filename: "a.png", mime: "image/png", size: 3 }],
  },
  publishedAt: new Date("2026-11-25T10:00:00.000Z"),
};

/** This instance's box half, recorded: the calls the local copy makes. */
function fakeLocalBox(over: Partial<LocalBox> = {}) {
  const upserts: SiteFeedUpsertBody[] = [];
  const deletes: string[] = [];
  const box: LocalBox = {
    feedOf: (id) => (id === feed.id ? feed : null),
    present: async (ids) => new Set(ids),
    upsert: async (_feed, body) => {
      upserts.push(body);
      return { kind: "upserted", id: body.id, updatedAt: "now" };
    },
    delete: async (_feed, id) => {
      deletes.push(id);
      return { kind: "deleted" };
    },
    ...over,
  };
  return { box, upserts, deletes };
}

describe("publishing to this instance", () => {
  it("upserts through the box half in-process, transferring nothing", async () => {
    const { box, upserts } = fakeLocalBox();
    expect(await publishItem(localTransport(box), ITEM)).toEqual({
      kind: "published",
      transferred: 0,
    });
    expect(upserts).toEqual([
      {
        feedId: "notes",
        id: ID,
        values: ITEM.values,
        publishedAt: "2026-11-25T10:00:00.000Z",
      },
    ]);
  });

  it("refuses in words what the box half refuses (this release's own judge)", async () => {
    const { box } = fakeLocalBox({
      upsert: async () => ({
        kind: "invalid-values",
        issues: [{ path: ["title"], message: "too long" }],
      }),
    });
    const outcome = await publishItem(localTransport(box), ITEM);
    expect(outcome.kind).toBe("refused");
  });

  it("answers unknown-feed when this release no longer declares it", async () => {
    const { box, upserts } = fakeLocalBox({ feedOf: () => null });
    const outcome = await publishItem(localTransport(box), ITEM);
    expect(outcome).toMatchObject({ kind: "refused" });
    expect(upserts).toEqual([]);
  });

  it("unpublishes through the box half's delete", async () => {
    const { box, deletes } = fakeLocalBox();
    expect(
      await unpublishItem(localTransport(box), { id: ID, feedId: "notes" }),
    ).toEqual({ kind: "unpublished" });
    expect(deletes).toEqual([ID]);
  });
});
