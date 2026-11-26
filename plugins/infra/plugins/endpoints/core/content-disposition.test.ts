import { describe, expect, test } from "bun:test";
import { contentDisposition } from "./content-disposition";
import { rangedBlobResponse } from "./byte-range";

const header = (name: string) =>
  contentDisposition("inline", name)["Content-Disposition"];

describe("contentDisposition", () => {
  test("a plain ASCII name keeps both forms equal", () => {
    expect(header("clip.mp4")).toBe(
      `inline; filename="clip.mp4"; filename*=UTF-8''clip.mp4`,
    );
  });

  test("a non-ASCII name: ASCII fallback plus the exact UTF-8 name", () => {
    expect(
      contentDisposition(
        "attachment",
        "2026-11-25 13.42 Home — Agent Manager — equin.mp4",
      )["Content-Disposition"],
    ).toBe(
      `attachment; filename="2026-11-25 13.42 Home _ Agent Manager _ equin.mp4"; ` +
        `filename*=UTF-8''2026-11-25%2013.42%20Home%20%E2%80%94%20Agent%20Manager%20%E2%80%94%20equin.mp4`,
    );
  });

  test("an emoji (astral) becomes one fallback character", () => {
    expect(header("a😀.png")).toContain(`filename="a_.png"`);
  });

  test("quotes and backslashes are escaped in the fallback, encoded in filename*", () => {
    expect(header(`a"b\\c.txt`)).toBe(
      `inline; filename="a\\"b\\\\c.txt"; filename*=UTF-8''a%22b%5Cc.txt`,
    );
  });

  test("RFC 8187 attr-char: ' ( ) * are percent-encoded", () => {
    expect(header("it's (1)*.txt")).toContain(
      `filename*=UTF-8''it%27s%20%281%29%2A.txt`,
    );
  });

  test("a control character never reaches the header raw", () => {
    const h = header("a\r\nSet-Cookie: x.txt");
    expect(h).not.toMatch(/[\r\n]/);
    expect(h).toContain("%0D%0A");
  });

  test("a lone surrogate (a name cut mid-emoji) is encoded as U+FFFD", () => {
    expect(header("a\uD83D.png")).toBe(
      `inline; filename="a_.png"; filename*=UTF-8''a%EF%BF%BD.png`,
    );
    expect(header("\uDE00b")).toContain(`filename*=UTF-8''%EF%BF%BDb`);
  });

  test("the header is accepted by Response for any name", () => {
    for (const name of [
      "— é 中文 😀.mp4",
      `"\\'`,
      "\u0000\u007f\u00ff",
      "x\uD83D",
    ]) {
      const res = rangedBlobResponse(new Blob(["x"]), new Headers(), {
        ...contentDisposition("inline", name),
      });
      expect(res.headers.get("content-disposition")).toBe(header(name));
    }
  });
});
