import { describe, expect, test } from "bun:test";
import { textField } from "@plugins/fields/plugins/text/plugins/config/core";
import { multilineTextField } from "@plugins/fields/plugins/multiline-text/plugins/config/core";
import { mediaField } from "@plugins/fields/plugins/media/core";
import { siteFeedSearchText } from "./items";

const fields = {
  title: textField({ label: "Title" }),
  media: mediaField({ label: "Media", accept: ["image/*"], max: 2 }),
  body: multilineTextField({ label: "Text" }),
};

describe("siteFeedSearchText", () => {
  test("joins every text value in the feed's field order, skipping the rest", () => {
    expect(
      siteFeedSearchText(fields, {
        body: "Drag a tab.\nIt splits.",
        media: [{ attachmentId: "a" }],
        title: "Split a pane",
      }),
    ).toBe("Split a pane\nDrag a tab.\nIt splits.");
  });

  test("an empty or missing text adds nothing", () => {
    expect(siteFeedSearchText(fields, { title: "", media: [] })).toBe("");
  });
});
