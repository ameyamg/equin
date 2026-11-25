import { describe, expect, test } from "bun:test";
import { textField } from "@plugins/fields/plugins/text/plugins/config/core";
import { mediaField } from "@plugins/fields/plugins/media/core";
import {
  defineSiteFeed,
  SITE_FEED_PUBLIC_LIMIT_MAX,
  SiteFeedDeclarationError,
} from "./define-site-feed";

const fields = {
  title: textField({ label: "Title" }),
  media: mediaField({ label: "Media", accept: "image/*", max: 2 }),
};

describe("defineSiteFeed", () => {
  test("keeps the declaration and derives the values schema", () => {
    const feed = defineSiteFeed({
      id: "news",
      label: "News",
      fields,
      syndicate: { text: ["title"], media: "media" },
      publicLimit: 10,
    });
    expect(feed.syndicate).toEqual({ text: ["title"], media: "media" });
    // A missing key heals to its field's default.
    expect(feed.valuesSchema.parse({ title: "Hi" })).toEqual({
      title: "Hi",
      media: [],
    });
    expect(() => feed.valuesSchema.parse({ title: 3 })).toThrow();
  });

  test("syndicate keys are typed against the fields (tsc)", () => {
    const declare = () => [
      defineSiteFeed({
        id: "a",
        label: "A",
        fields,
        // @ts-expect-error — "body" is not a field of this feed
        syndicate: { text: ["body"] },
        publicLimit: 1,
      }),
      defineSiteFeed({
        id: "b",
        label: "B",
        fields,
        // @ts-expect-error — "title" is a text field, not a media field
        syndicate: { text: ["title"], media: "title" },
        publicLimit: 1,
      }),
    ];
    // The same mistakes, past the types, throw at declaration.
    expect(declare).toThrow(SiteFeedDeclarationError);
  });

  test("an untyped caller is refused at declaration", () => {
    const loose = defineSiteFeed as (input: unknown) => unknown;
    const base = { id: "c", label: "C", fields, publicLimit: 5 };
    expect(() => loose({ ...base, syndicate: { text: ["body"] } })).toThrow(
      'syndicate.text names no field "body"',
    );
    expect(() =>
      loose({ ...base, syndicate: { text: ["title"], media: "title" } }),
    ).toThrow('syndicate.media "title" is not a media field');
    expect(() => loose({ ...base, id: "Bad Id" })).toThrow("the id must match");
    expect(() =>
      loose({ ...base, publicLimit: SITE_FEED_PUBLIC_LIMIT_MAX + 1 }),
    ).toThrow("publicLimit");
    expect(() => loose({ ...base, publicLimit: 0 })).toThrow("publicLimit");
    expect(() => loose({ ...base, fields: {} })).toThrow("at least one field");
  });
});
