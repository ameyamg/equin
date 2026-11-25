import { describe, expect, test } from "bun:test";
import { FIX_LEVELS } from "@plugins/reports/core";
import push from "./index";

// The declaration stays import-light (`--help` loads it alone), so its help
// spells the levels out rather than importing them: this keeps the two equal.
describe("push --fix-level help", () => {
  test("names every fix level", () => {
    const option = push.options?.find((o) => o.flags.startsWith("--fix-level"));
    expect(option).toBeDefined();
    for (const level of FIX_LEVELS)
      expect(option?.description).toContain(level);
  });
});
