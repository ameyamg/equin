import { describe, expect, test } from "bun:test";
import { formatterFor } from "@plugins/fields/plugins/date/plugins/format/core";
import type { BackupHealth } from "../../core";
import { backupVerdict } from "./backup-health";

const fmt = formatterFor({
  clock: "browser",
  dateOrder: "browser",
  numericDate: "browser",
});
const refetch = () => Promise.resolve();
const at = Date.UTC(2026, 10, 27, 3, 4);
const DAY = 86_400_000;
// A nightly schedule's instants after a run started at `at`.
const owed = { dueAt: at + DAY, staleAt: at + 2 * DAY };
const verdict = (data: BackupHealth, now = at + 60_000) =>
  backupVerdict({ status: "ready", data, refetch }, now, fmt);
const ready = (data: BackupHealth, now?: number) => verdict(data, now).status;

describe("backupVerdict", () => {
  test("loading is unknown with no summary (Checking…), never ok", () => {
    expect(
      backupVerdict({ status: "loading", refetch }, at, fmt).status,
    ).toEqual({ state: "unknown" });
  });

  test("not activated is not-applicable, so it never moves the dot", () => {
    expect(ready({ kind: "inactive", reason: "no-schedule" })).toEqual({
      state: "not-applicable",
      summary: "Not activated — no backup schedule set",
    });
    expect(ready({ kind: "elsewhere" }).state).toBe("not-applicable");
  });

  test("a good latest backup is ok, and changes on its own at staleAt", () => {
    const v = verdict({
      kind: "active",
      running: false,
      last: { status: "ok", finishedAt: at },
      owed,
    });
    expect(v.status.state).toBe("ok");
    expect(v.status.summary).toStartWith("Last backup ");
    expect(v.nextChangeAt).toBe(owed.staleAt);
  });

  test("one missed firing is not yet stale; a second one is", () => {
    const data: BackupHealth = {
      kind: "active",
      running: false,
      last: { status: "ok", finishedAt: at },
      owed,
    };
    expect(ready(data, owed.dueAt + 60_000).state).toBe("ok");
    const stale = verdict(data, owed.staleAt);
    expect(stale.status).toMatchObject({
      state: "attention",
      title: "Scheduled backups stopped",
    });
    expect(stale.status.summary).toStartWith("No backup since ");
    expect(stale.nextChangeAt).toBeNull();
  });

  test("a run wedged in progress past staleAt is stale too", () => {
    expect(
      ready(
        {
          kind: "active",
          running: true,
          last: { status: "ok", finishedAt: at - DAY },
          owed,
        },
        owed.staleAt + 1,
      ),
    ).toMatchObject({ state: "attention", transitioning: true });
  });

  test("a partial or failed latest backup needs a look", () => {
    for (const status of ["partial", "failed"] as const) {
      expect(
        ready({
          kind: "active",
          running: false,
          last: { status, finishedAt: at },
          owed,
        }).state,
      ).toBe("attention");
    }
  });

  test("a run in progress pulses and keeps the latest finished verdict", () => {
    const s = ready({
      kind: "active",
      running: true,
      last: { status: "failed", finishedAt: at },
      owed,
    });
    expect(s).toMatchObject({ state: "attention", transitioning: true });
  });

  test("activated but never run is info, not green, with no timer", () => {
    const v = verdict({
      kind: "active",
      running: false,
      last: null,
      owed: null,
    });
    expect(v.status.state).toBe("info");
    expect(v.nextChangeAt).toBeNull();
  });
});
