import { describe, expect, test } from "bun:test";
import {
  FIT_HEIGHT_MESSAGE,
  FIT_MAX_HEIGHT,
  fitDocument,
  mintNonce,
  reportedHeight,
} from "./fit-document";

describe("fitDocument", () => {
  test("the policy and the reporter come first, after the doctype", () => {
    const doc = fitDocument("<!DOCTYPE html><html><body>x</body>", "N0nce");
    expect(doc.startsWith("<!DOCTYPE html><meta")).toBe(true);
    expect(doc).toContain(`script-src 'nonce-N0nce'`);
    expect(doc).toContain(`<script nonce="N0nce">`);
    expect(doc.endsWith("<html><body>x</body>")).toBe(true);
  });

  test("no doctype: prepended", () => {
    expect(fitDocument("<p>x</p>", "n").startsWith("<meta")).toBe(true);
  });

  test("a nonce is fresh each time", () => {
    expect(mintNonce()).not.toBe(mintNonce());
  });
});

describe("reportedHeight", () => {
  test("reads the reporter's message only", () => {
    expect(reportedHeight({ type: FIT_HEIGHT_MESSAGE, height: 12.2 })).toBe(13);
    expect(reportedHeight({ type: "other", height: 12 })).toBeNull();
    expect(
      reportedHeight({ type: FIT_HEIGHT_MESSAGE, height: "1" }),
    ).toBeNull();
    expect(reportedHeight({ type: FIT_HEIGHT_MESSAGE, height: -1 })).toBeNull();
    expect(reportedHeight(null)).toBeNull();
    expect(
      reportedHeight({ type: FIT_HEIGHT_MESSAGE, height: FIT_MAX_HEIGHT * 2 }),
    ).toBe(FIT_MAX_HEIGHT);
  });
});
