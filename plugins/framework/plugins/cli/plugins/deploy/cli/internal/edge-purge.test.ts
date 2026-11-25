import { describe, expect, test } from "bun:test";
import { purgeAfterRun, type EdgePurge } from "./edge-purge";

const zones = [{ id: "z1", name: "equin.ai" }];

describe("purgeAfterRun", () => {
  test("purges once the script ended, whatever it answered", async () => {
    let purged = 0;
    const purge: EdgePurge = {
      zones,
      tag: "equin-documents-website",
      purge: async () => {
        purged++;
      },
    };
    const failures: string[] = [];
    await purgeAfterRun(purge, failures)({ seenToEnd: true });
    await purgeAfterRun(purge, failures)({ seenToEnd: false });
    expect(purged).toBe(2);
    expect(failures).toEqual([]);
  });

  test("a failed purge is collected for after the script's verdict, not thrown", async () => {
    const purge: EdgePurge = {
      zones,
      tag: "equin-documents-website",
      purge: () =>
        Promise.reject(new Error("Authentication error (code 10000)")),
    };
    const failures: string[] = [];
    await purgeAfterRun(purge, failures)({ seenToEnd: true });
    expect(failures).toEqual(["Authentication error (code 10000)"]);
  });

  test("a non-Error rejection is not a purge failure: it escapes", async () => {
    const purge: EdgePurge = {
      zones,
      tag: "t",
      purge: () => Promise.reject("boom"),
    };
    expect(purgeAfterRun(purge, [])({ seenToEnd: true })).rejects.toBe("boom");
  });
});
