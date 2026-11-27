import { describe, expect, it } from "bun:test";
import { defineSiteFeed } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import { textField } from "@plugins/fields/plugins/text/plugins/config/core";
import { multilineTextField } from "@plugins/fields/plugins/multiline-text/plugins/config/core";
import { formattedTextField } from "@plugins/fields/plugins/formatted-text/plugins/config/core";
import { syndicatedText } from "./compose";

const feed = defineSiteFeed({
  id: "compose-test",
  label: "Compose test",
  fields: {
    title: formattedTextField(),
    body: formattedTextField(),
    note: multilineTextField(),
  },
  syndicate: { text: ["title", "body", "note"] },
  publicLimit: 10,
});

describe("syndicatedText", () => {
  it("reads a formatted field's markup, takes a plain field's text as written", () => {
    expect(
      syndicatedText(feed, {
        title: " **Split** a pane ",
        body: "Press <kbd>⌘</kbd>",
        note: "**not bold**",
      }),
    ).toEqual({
      title: "Split a pane",
      paragraphs: [
        [
          { kind: "text", text: "Press " },
          { kind: "key", text: "⌘" },
        ],
        [{ kind: "text", text: "**not bold**" }],
      ],
    });
  });

  it("drops empty paragraphs and an empty title", () => {
    expect(syndicatedText(feed, { title: "", body: "  ", note: "" })).toEqual({
      title: null,
      paragraphs: [],
    });
  });

  it("is null for a feed that is never posted", () => {
    const quiet = defineSiteFeed({
      id: "quiet",
      label: "Quiet",
      fields: { title: textField() },
      publicLimit: 10,
    });
    expect(syndicatedText(quiet, { title: "x" })).toBeNull();
  });
});
