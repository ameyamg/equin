import { describe, expect, test } from "bun:test";
import type { DaemonBinaries, DaemonDepRow } from "../../core";
import { daemonBinariesVerdict } from "./daemon-health";

const refetch = async () => {};
const ready = (data: DaemonBinaries) =>
  daemonBinariesVerdict({ status: "ready", data, refetch });
const checked = (...rows: DaemonDepRow[]) =>
  ready({ kind: "checked", mainRoot: "/repo", rows });

const v = (version: string) => ({ identity: `id-${version}`, version });
const row = (
  id: string,
  running: DaemonDepRow["running"],
  declared: DaemonDepRow["declared"],
): DaemonDepRow => ({
  id,
  description: "",
  appliesAt: "the next restart",
  running,
  declared,
});

describe("daemonBinariesVerdict", () => {
  test("loading is unknown, never ok", () => {
    expect(daemonBinariesVerdict({ status: "loading", refetch })).toEqual({
      state: "unknown",
    });
  });

  test("every daemon on main's version, or never started, is ok", () => {
    expect(
      checked(
        row("postgres-binaries", v("18.1.0"), { kind: "same" }),
        row("pgbouncer-binary", null, {
          kind: "differs",
          install: v("1.24.1"),
          failed: null,
        }),
      ),
    ).toEqual({ state: "ok", summary: "Up to date with main" });
  });

  test("a version waiting for the next restart is ok, with a note", () => {
    expect(
      checked(
        row("postgres-binaries", v("18.1.0"), {
          kind: "differs",
          install: v("18.6.0"),
          failed: null,
        }),
      ),
    ).toEqual({
      state: "ok",
      summary: "postgres-binaries 18.6.0 at next restart",
    });
  });

  test("a start that fell back is attention, naming both versions", () => {
    expect(
      checked(
        row("postgres-binaries", v("18.1.0"), {
          kind: "differs",
          install: v("18.6.0"),
          failed: { at: "2026-11-23T10:00:00Z", error: "pg_ctl start failed" },
        }),
        row("pgbouncer-binary", v("1.24.1"), { kind: "same" }),
      ),
    ).toEqual({
      state: "attention",
      summary: "postgres-binaries 18.6.0 failed to start — running 18.1.0",
      title: "A daemon fell back to its previous binaries",
    });
  });

  test("an unreadable declaration is unknown", () => {
    expect(
      checked(
        row("postgres-binaries", v("18.1.0"), {
          kind: "unreadable",
          message: "no bun.lock",
        }),
      ),
    ).toEqual({
      state: "unknown",
      summary: "postgres-binaries: couldn't read what main declares",
    });
  });

  test("a release or a host without the computer is not applicable", () => {
    expect(ready({ kind: "not-applicable", reason: "A release" }).state).toBe(
      "not-applicable",
    );
    expect(
      daemonBinariesVerdict({ status: "unavailable", message: "Not here." }),
    ).toEqual({ state: "not-applicable", summary: "Not here." });
  });
});
