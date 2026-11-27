import { describe, expect, test } from "bun:test";
import { formatterFor } from "@plugins/fields/plugins/date/plugins/format/core";
import type { BackupHealth } from "../../core";
import { backupHealthStatus } from "./backup-health";

const fmt = formatterFor({
  clock: "browser",
  dateOrder: "browser",
  numericDate: "browser",
});
const refetch = () => Promise.resolve();
const ready = (data: BackupHealth) =>
  backupHealthStatus({ status: "ready", data, refetch }, fmt);
const at = Date.UTC(2026, 10, 27, 3, 4);

describe("backupHealthStatus", () => {
  test("loading is unknown with no summary (Checking…), never ok", () => {
    expect(backupHealthStatus({ status: "loading", refetch }, fmt)).toEqual({
      state: "unknown",
    });
  });

  test("not activated is not-applicable, so it never moves the dot", () => {
    expect(ready({ kind: "inactive", reason: "no-schedule" })).toEqual({
      state: "not-applicable",
      summary: "Not activated — no backup schedule set",
    });
    expect(ready({ kind: "inactive", reason: "no-target" }).state).toBe(
      "not-applicable",
    );
    expect(ready({ kind: "elsewhere" }).state).toBe("not-applicable");
  });

  test("a good latest backup is ok", () => {
    const s = ready({
      kind: "active",
      running: false,
      last: { status: "ok", finishedAt: at },
    });
    expect(s.state).toBe("ok");
    expect(s.summary).toStartWith("Last backup ");
  });

  test("a partial or failed latest backup needs a look", () => {
    for (const status of ["partial", "failed"] as const) {
      expect(
        ready({
          kind: "active",
          running: false,
          last: { status, finishedAt: at },
        }).state,
      ).toBe("attention");
    }
  });

  test("a run in progress pulses and keeps the latest finished verdict", () => {
    const s = ready({
      kind: "active",
      running: true,
      last: { status: "failed", finishedAt: at },
    });
    expect(s).toMatchObject({ state: "attention", transitioning: true });
  });

  test("activated but never run is info, not green", () => {
    expect(ready({ kind: "active", running: false, last: null }).state).toBe(
      "info",
    );
  });
});
