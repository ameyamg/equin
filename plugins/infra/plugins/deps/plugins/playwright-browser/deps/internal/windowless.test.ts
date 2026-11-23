import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { playwrightArgv, windowlessArgv } from "./playwright-browser";

describe("windowless persistent launch", () => {
  test("reads the argv Playwright launches with, from a stub executable", async () => {
    const { chromium } = await import("playwright");
    const profile = mkdtempSync(join(tmpdir(), "windowless-profile-"));
    try {
      const argv = await playwrightArgv(chromium, profile, {
        headless: false,
        args: ["--x-caller-flag"],
        ignoreDefaultArgs: ["--enable-automation"],
      });
      expect(argv).toContain(`--user-data-dir=${profile}`);
      expect(argv).toContain("--remote-debugging-pipe");
      expect(argv).toContain("--use-mock-keychain");
      expect(argv).toContain("--x-caller-flag");
      expect(argv).not.toContain("--enable-automation");
      expect(argv.at(-1)).toBe("about:blank");
    } finally {
      rmSync(profile, { recursive: true, force: true });
    }
  });

  test("drops the startup page and starts with no window", () => {
    expect(windowlessArgv(["--a", "about:blank"])).toEqual([
      "--a",
      "--no-startup-window",
    ]);
  });

  test("refuses an argv that does not open exactly about:blank", () => {
    expect(() => windowlessArgv(["--a"])).toThrow(/about:blank/);
    expect(() => windowlessArgv(["--a", "https://x.test"])).toThrow(
      /about:blank/,
    );
  });
});
