import { describe, expect, test } from "bun:test";
import { inlineImageToken } from "../../core";
import { withInlineImages } from "./inline-images";

describe("withInlineImages", () => {
  test("each token takes its src; a tenth token is never read as the first", () => {
    const tokens = Array.from({ length: 11 }, (_, i) => inlineImageToken(i));
    const html = tokens.map((t) => `<img src="${t}">`).join("");
    const srcs = tokens.map((_, i) => `data:image/png;base64,${i}`);
    expect(withInlineImages(html, srcs, srcs.length)).toBe(
      srcs.map((s) => `<img src="${s}">`).join(""),
    );
  });

  test("unresolved images draw nothing", () => {
    const html = `<img src="${inlineImageToken(0)}">`;
    expect(withInlineImages(html, null, 1)).toBe(`<img src="">`);
  });
});
