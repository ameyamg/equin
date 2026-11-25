import { describe, expect, test } from "bun:test";
import { mediaAttachmentIds } from "@plugins/fields/plugins/media/core";
import { tipsFeed } from "./tips-feed";

const ref = (attachmentId: string, mime: string) => ({
  attachmentId,
  mime,
  filename: `${attachmentId}.bin`,
  size: 1234,
});

describe("tipsFeed", () => {
  test("round-trips a tip through its values schema", () => {
    const tip = {
      title: "Split a pane",
      body: "Drag a tab to the edge.\nIt splits.",
      media: [ref("a", "image/png"), ref("b", "video/mp4")],
    };
    expect(tipsFeed.valuesSchema.parse(tip)).toEqual(tip);
    expect(mediaAttachmentIds(tipsFeed.fields, tip)).toEqual(["a", "b"]);
  });

  test("holds at most 10 files, and each once", () => {
    const many = Array.from({ length: 11 }, (_, i) =>
      ref(`m${i}`, "image/png"),
    );
    expect(() =>
      tipsFeed.valuesSchema.parse({ title: "", body: "", media: many }),
    ).toThrow();
    expect(() =>
      tipsFeed.valuesSchema.parse({
        title: "",
        body: "",
        media: [ref("x", "image/png"), ref("x", "image/png")],
      }),
    ).toThrow();
  });

  test("syndicates its title and text, its media as files", () => {
    expect(tipsFeed.syndicate).toEqual({
      text: ["title", "body"],
      media: "media",
    });
    expect(tipsFeed.publicLimit).toBe(60);
  });
});
