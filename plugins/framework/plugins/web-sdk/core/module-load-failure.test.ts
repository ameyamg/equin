import { describe, expect, test } from "bun:test";
import { moduleLoadFailureOf } from "./module-load-failure";

// Each engine's own sentence, as the browser rejects `import()` with it.
// Firefox and WebKit strings measured in Playwright (Firefox 159, WebKit 27.2);
// Chromium's from V8's message templates.
describe("moduleLoadFailureOf", () => {
  test.each([
    // fetch
    [
      "fetch",
      new TypeError(
        "Failed to fetch dynamically imported module: https://x/a.js",
      ),
    ],
    ["fetch", new TypeError("Importing a module script failed.")],
    [
      "fetch",
      new TypeError(
        "error loading dynamically imported module: https://x/a.js",
      ),
    ],
    // link
    [
      "link",
      new SyntaxError(
        "The requested module 'https://x/a.js' does not provide an export named 'b'",
      ),
    ],
    [
      "link",
      new SyntaxError(
        "The requested module 'https://x/a.js' doesn't provide an export named: 'b'",
      ),
    ],
    ["link", new SyntaxError("Importing binding name 'b' is not found.")],
    [
      "link",
      new SyntaxError(
        "The requested module 'https://x/a.js' contains conflicting star exports for name 'b'",
      ),
    ],
    [
      "link",
      new SyntaxError(
        "The requested module 'https://x/a.js' contains ambiguous star export: 'b' from 'c' and 'd'",
      ),
    ],
    [
      "link",
      new SyntaxError(
        "Importing binding name 'b' cannot be resolved by star export entries.",
      ),
    ],
    [
      "link",
      new Error("Module function declarations have already been instantiated"),
    ],
    // other: what the module's code threw, a parse error, an unknown sentence
    ["other", new TypeError("x is not a function")],
    ["other", new SyntaxError("Unexpected token '<'")],
    ["other", new Error("Failed to fetch dynamically imported module")],
    ["other", new TypeError("NetworkError when attempting to fetch resource.")],
    ["other", "Failed to fetch dynamically imported module"],
    ["other", undefined],
  ] as const)("%s ← %p", (kind, err) => {
    expect(moduleLoadFailureOf(err)).toBe(kind);
  });
});
