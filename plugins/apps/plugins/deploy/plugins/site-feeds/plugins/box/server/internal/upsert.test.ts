import { describe, expect, test } from "bun:test";
import { defineSiteFeed } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import { textField } from "@plugins/fields/plugins/text/plugins/config/core";
import { mediaField } from "@plugins/fields/plugins/media/core";
import { judgeUpsertValues, missingIds } from "./upsert";

const feed = defineSiteFeed({
  id: "notes",
  label: "Notes",
  fields: {
    title: textField({ label: "Title" }),
    media: mediaField({ label: "Media", accept: "*", max: 3 }),
  },
  publicLimit: 5,
});

const ref = (attachmentId: string) => ({
  attachmentId,
  mime: "image/png",
  filename: "a.png",
  size: 10,
});

describe("judgeUpsertValues", () => {
  test("valid values resolve with defaults and name their files", () => {
    expect(judgeUpsertValues(feed, { media: [ref("u1"), ref("u2")] })).toEqual({
      kind: "valid",
      values: { title: "", media: [ref("u1"), ref("u2")] },
      attachmentIds: ["u1", "u2"],
    });
  });

  test("a value the declaration refuses is invalid-values with zod's issues", () => {
    const judged = judgeUpsertValues(feed, { title: 42 });
    expect(judged.kind).toBe("invalid-values");
    if (judged.kind !== "invalid-values") throw new Error("unreachable");
    expect(judged.issues[0]?.path).toEqual(["title"]);
  });

  test("a field this box does not declare is skew, never silently dropped", () => {
    const judged = judgeUpsertValues(feed, { title: "x", subtitle: "y" });
    expect(judged).toEqual({
      kind: "invalid-values",
      issues: [
        {
          path: ["subtitle"],
          message: 'this site\'s feed "notes" declares no field "subtitle"',
        },
      ],
    });
  });

  test("more files than the field holds is invalid", () => {
    const judged = judgeUpsertValues(feed, {
      media: [ref("a"), ref("b"), ref("c"), ref("d")],
    });
    expect(judged.kind).toBe("invalid-values");
  });
});

describe("missingIds", () => {
  test("the referenced ids with no attachment here, once each, in order", () => {
    expect(missingIds(["a", "b", "a", "c"], new Set(["b"]))).toEqual([
      "a",
      "c",
    ]);
    expect(missingIds([], new Set())).toEqual([]);
  });
});
