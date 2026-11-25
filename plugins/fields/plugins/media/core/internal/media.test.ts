import { describe, expect, test } from "bun:test";
import { textField } from "@plugins/fields/plugins/text/plugins/config/core";
import { mediaField, mediaFieldDefOf, NotAMediaFieldError } from "./media";
import { mediaAttachmentIds, MediaValueError } from "./attachment-ids";

const ref = (id: string) => ({
  attachmentId: id,
  mime: "image/png",
  filename: `${id}.png`,
  size: 10,
});

describe("mediaField", () => {
  test("defaults to no files and keeps accept / max / maxBytes", () => {
    const f = mediaField({ label: "Photos", accept: "image/*", max: 2 });
    expect(f.defaultValue).toEqual([]);
    expect(f.accept).toBe("image/*");
    expect(f.max).toBe(2);
    expect(f.maxBytes).toBeUndefined();
    expect(mediaField({ accept: "video/*", maxBytes: 1024 }).maxBytes).toBe(
      1024,
    );
    expect(mediaFieldDefOf(f)).toBe(f);
  });

  test("the schema enforces max", () => {
    const f = mediaField({ accept: "*", max: 2 });
    expect(f.schema.safeParse([ref("a"), ref("b")]).success).toBe(true);
    expect(f.schema.safeParse([ref("a"), ref("b"), ref("c")]).success).toBe(
      false,
    );
  });

  test("no max: any number of files", () => {
    const f = mediaField({ accept: "*" });
    const many = Array.from({ length: 50 }, (_, i) => ref(`a${i}`));
    expect(f.schema.safeParse(many).success).toBe(true);
  });

  test("an attachment appears at most once", () => {
    const f = mediaField({ accept: "*" });
    expect(f.schema.safeParse([ref("a"), ref("a")]).success).toBe(false);
  });

  test("refuses a malformed ref", () => {
    const f = mediaField({ accept: "*" });
    expect(f.schema.safeParse([{ attachmentId: "a" }]).success).toBe(false);
  });

  test("refuses a bad max / maxBytes", () => {
    expect(() => mediaField({ accept: "*", max: 0 })).toThrow(RangeError);
    expect(() => mediaField({ accept: "*", maxBytes: 0.5 })).toThrow(
      RangeError,
    );
  });

  test("mediaFieldDefOf refuses another type's def", () => {
    const t = textField({ label: "Title" });
    expect(() => mediaFieldDefOf(t as never)).toThrow(NotAMediaFieldError);
  });
});

describe("mediaAttachmentIds", () => {
  const fields = {
    title: textField({ label: "Title" }),
    cover: mediaField({ label: "Cover", accept: "image/*", max: 1 }),
    clips: mediaField({ label: "Clips", accept: "video/*" }),
  };

  test("collects every id of every media field, in order", () => {
    expect(
      mediaAttachmentIds(fields, {
        title: "x",
        cover: [ref("c1")],
        clips: [ref("v1"), ref("v2")],
      }),
    ).toEqual(["c1", "v1", "v2"]);
  });

  test("no media fields → no ids", () => {
    expect(mediaAttachmentIds({ title: fields.title }, { title: "x" })).toEqual(
      [],
    );
  });

  test("a missing or malformed media value throws", () => {
    expect(() => mediaAttachmentIds(fields, { title: "x", cover: [] })).toThrow(
      MediaValueError,
    );
    expect(() =>
      mediaAttachmentIds(fields, { title: "x", cover: "nope", clips: [] }),
    ).toThrow(MediaValueError);
  });
});
