import { describe, expect, test } from "bun:test";
import { envName } from "@plugins/infra/plugins/launcher/plugins/env-names/core";
import { createContext } from "../context";
import type { BashInput, Verdict } from "../types";
import { MAX_FOREGROUND_TIMEOUT_MS, callDeadlineGuard } from "./call-deadline";

function patch(input: BashInput) {
  const v = callDeadlineGuard.check(input, createContext("/tmp")) as Verdict;
  return v.kind === "rewrite" ? v.patch : undefined;
}

const EXPORT_RE = new RegExp(`^export ${envName("CALL_DEADLINE")}=(\\d+); `);

function deadlineOf(p: ReturnType<typeof patch>): number {
  const m = String(p?.command).match(EXPORT_RE);
  expect(m).not.toBeNull();
  return Number(m![1]);
}

describe("call-deadline guard", () => {
  test("a foreground check gets the deadline exported and the full limit", () => {
    const before = Date.now();
    const p = patch({ command: "./equin check type-check", timeout: 120_000 });
    expect(p?.timeout).toBe(MAX_FOREGROUND_TIMEOUT_MS);
    const deadline = deadlineOf(p);
    // Inside the call's window, short of its limit.
    expect(deadline).toBeGreaterThan(before);
    expect(deadline).toBeLessThan(before + MAX_FOREGROUND_TIMEOUT_MS);
    expect(String(p?.command)).toEndWith("; ./equin check type-check");
  });

  test("a background build gets the deadline of the limit in force", () => {
    const before = Date.now();
    const p = patch({
      command: "./equin build",
      run_in_background: true,
      timeout: 7_200_000,
    });
    expect(p?.timeout).toBe(7_200_000);
    const deadline = deadlineOf(p);
    expect(deadline).toBeGreaterThan(before + 7_000_000);
    expect(deadline).toBeLessThan(before + 7_200_000);
  });

  test("a background push with no timeout named is held to the harness default", () => {
    const before = Date.now();
    const p = patch({ command: "./equin push -m x", run_in_background: true });
    const deadline = deadlineOf(p);
    expect(deadline).toBeLessThan(before + 1_800_000);
    expect(deadline).toBeGreaterThan(before + 1_600_000);
  });

  test("a chain reaches every op in it", () => {
    expect(
      String(patch({ command: "cd x && ./equin test plugins/a" })?.command),
    ).toMatch(EXPORT_RE);
  });

  test("other ops and instant flags are untouched", () => {
    expect(patch({ command: "./equin format" })).toBeUndefined();
    expect(patch({ command: "./equin check --list" })).toBeUndefined();
    expect(
      patch({ command: "./equin release", run_in_background: true }),
    ).toBeUndefined();
    expect(patch({ command: "ls" })).toBeUndefined();
  });
});
