import { describe, expect, test } from "bun:test";
import { numberedName, recordingBaseName } from "./file-name";

const AT = new Date(2026, 10, 25, 9, 5);

describe("recordingBaseName", () => {
  test("stamps the local time before the title", () => {
    expect(recordingBaseName("The guide · equin", AT)).toBe(
      "2026-11-25 09.05 The guide · equin",
    );
  });

  test("drops what a file name cannot hold", () => {
    expect(recordingBaseName(' a/b\\c: "d" <e>|\n', AT)).toBe(
      "2026-11-25 09.05 a b c d e",
    );
    expect(recordingBaseName("..hidden", AT)).toBe("2026-11-25 09.05 hidden");
  });

  test("an empty title still names the file", () => {
    expect(recordingBaseName("  ", AT)).toBe("2026-11-25 09.05 Recording");
  });

  test("numbers a taken name", () => {
    expect(numberedName("x", 1)).toBe("x");
    expect(numberedName("x", 2)).toBe("x (2)");
  });
});
