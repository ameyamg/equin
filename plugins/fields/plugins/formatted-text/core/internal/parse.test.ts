import { describe, expect, it } from "bun:test";
import {
  formattedPlainText,
  parseFormattedText,
  plainFormattedText,
} from "./parse";

const t = (text: string) => ({ kind: "text", text }) as const;

describe("parseFormattedText", () => {
  it("reads plain text as one run, line breaks kept", () => {
    const src =
      "Use ⌥+Click / Alt+Click on any link.\n\nThis works on any links — Drop & Close.";
    expect(parseFormattedText(src)).toEqual([t(src)]);
    expect(parseFormattedText("")).toEqual([]);
  });

  it("reads bold, key caps and links", () => {
    expect(
      parseFormattedText(
        "Use the **note** button, <kbd>⌘</kbd>+Click, or [the tips](/about/tips).",
      ),
    ).toEqual([
      t("Use the "),
      { kind: "strong", children: [t("note")] },
      t(" button, "),
      { kind: "key", text: "⌘" },
      t("+Click, or "),
      { kind: "link", href: "/about/tips", children: [t("the tips")] },
      t("."),
    ]);
  });

  it("nests key caps and links in bold, and bold and keys in a link", () => {
    expect(
      parseFormattedText("**Press <kbd>F</kbd> [here](https://x.y)**"),
    ).toEqual([
      {
        kind: "strong",
        children: [
          t("Press "),
          { kind: "key", text: "F" },
          t(" "),
          { kind: "link", href: "https://x.y", children: [t("here")] },
        ],
      },
    ]);
    expect(parseFormattedText("[**Go** <kbd>↓</kbd>](mailto:a@b.c)")).toEqual([
      {
        kind: "link",
        href: "mailto:a@b.c",
        children: [
          { kind: "strong", children: [t("Go")] },
          t(" "),
          { kind: "key", text: "↓" },
        ],
      },
    ]);
  });

  it("leaves unclosed or ill-formed markers literal", () => {
    for (const src of [
      "2 ** 3",
      "**open",
      "** spaced**",
      "**",
      "****",
      "<kbd></kbd>",
      "<kbd>a",
      "<kbd>a\nb</kbd>",
      "[text]",
      "[text](",
      "[](https://x.y)",
      "a < b > c",
      "[x](//evil.com)",
    ]) {
      expect(parseFormattedText(src)).toEqual([t(src)]);
    }
  });

  it("refuses unsafe link targets", () => {
    expect(parseFormattedText("[x](javascript:alert(1))")).toEqual([
      t("[x](javascript:alert(1))"),
    ]);
    expect(parseFormattedText("[x](data:text/html,hi)")).toEqual([
      t("[x](data:text/html,hi)"),
    ]);
    // A browser reads `\` as `/`: `/\evil.com` would leave the site.
    expect(parseFormattedText("[x](/\\evil.com)")).toEqual([
      t("[x](/\\evil.com)"),
    ]);
  });

  it("does not let spans overlap", () => {
    // The bold closes inside the link's text: the link is not read.
    expect(parseFormattedText("**a [b** c](/x)")).toEqual([
      { kind: "strong", children: [t("a [b")] },
      t(" c](/x)"),
    ]);
  });

  it("writes escaped markers literally", () => {
    expect(
      parseFormattedText("\\*\\*not bold\\*\\* \\<kbd>x\\</kbd> \\[a](/b)"),
    ).toEqual([t("**not bold** <kbd>x</kbd> [a](/b)")]);
    expect(parseFormattedText("C:\\path")).toEqual([t("C:\\path")]);
  });
});

describe("parseFormattedText on crafted input", () => {
  it("stays fast when no opener closes", () => {
    for (const unit of ["**[ ", "[ **a ", "**<kbd>[ "]) {
      const src = unit.repeat(5000);
      const t0 = performance.now();
      expect(formattedPlainText(parseFormattedText(src))).toBe(src);
      expect(performance.now() - t0).toBeLessThan(500);
    }
  });
});

describe("formattedPlainText / plainFormattedText", () => {
  it("drops the formatting", () => {
    expect(
      formattedPlainText(parseFormattedText("**Hit** <kbd>⌘</kbd>+[K](/k)")),
    ).toBe("Hit ⌘+K");
  });

  it("wraps plain text without reading markup", () => {
    expect(plainFormattedText("**x**")).toEqual([t("**x**")]);
    expect(plainFormattedText("")).toEqual([]);
  });
});
