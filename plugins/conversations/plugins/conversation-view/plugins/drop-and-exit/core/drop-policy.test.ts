import { test, expect } from "bun:test";
import { exitSettlement } from "./drop-policy";

test("the manual Drop & Close drops unmerged commits, keeps landed work", () => {
  expect(exitSettlement("none", "drop-and-close")).toBe("drop");
  expect(exitSettlement("pending", "drop-and-close")).toBe("drop");
  expect(exitSettlement("landed", "drop-and-close")).toBe("keep");
});

test("the agent-driven close never drops: nothing to land is delivered work", () => {
  expect(exitSettlement("none", "exit-clean")).toBe("deliver");
  expect(exitSettlement("pending", "exit-clean")).toBe("keep");
  expect(exitSettlement("landed", "exit-clean")).toBe("keep");
});
