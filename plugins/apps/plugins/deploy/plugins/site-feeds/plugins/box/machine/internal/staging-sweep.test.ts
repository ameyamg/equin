import { describe, expect, test } from "bun:test";
import { STAGED_FILE_TTL_MS, staleStaged } from "./staging-sweep";

describe("staleStaged", () => {
  test("only files modified before the TTL go", () => {
    const now = 10 * STAGED_FILE_TTL_MS;
    expect(
      staleStaged(
        [
          { name: "old", mtimeMs: now - STAGED_FILE_TTL_MS - 1 },
          { name: "edge", mtimeMs: now - STAGED_FILE_TTL_MS },
          { name: "new", mtimeMs: now - 1 },
        ],
        now,
      ),
    ).toEqual(["old"]);
  });
});
