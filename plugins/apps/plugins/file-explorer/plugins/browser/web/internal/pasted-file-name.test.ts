import { describe, expect, test } from "bun:test";
import { pastedFileName } from "./pasted-file-name";

describe("pastedFileName", () => {
  test("a browser's clipboard image is a pasted image of its extension", () => {
    expect(pastedFileName({ name: "image.png", type: "image/png" })).toBe(
      "Pasted image.png",
    );
  });
  test("no name: the extension comes from the type", () => {
    expect(pastedFileName({ name: "", type: "image/jpeg" })).toBe(
      "Pasted image.jpg",
    );
    expect(pastedFileName({ name: "", type: "image/svg+xml" })).toBe(
      "Pasted image.svg",
    );
    expect(pastedFileName({ name: "", type: "" })).toBe("Pasted image");
  });
  test("a file's own name is kept, made a valid entry name", () => {
    expect(pastedFileName({ name: "holiday.jpg", type: "image/jpeg" })).toBe(
      "holiday.jpg",
    );
    expect(pastedFileName({ name: "a/b.txt", type: "text/plain" })).toBe(
      "a-b.txt",
    );
  });
});
