import { describe, expect, test } from "bun:test";
import type { MailAccountStatus } from "../../core";
import { mailHealth } from "./status-view";

const refetch = async () => {};
const ready = (data: MailAccountStatus) =>
  ({ status: "ready", data, refetch }) as const;
const account = (
  over: Partial<Extract<MailAccountStatus, { kind: "account" }>> = {},
): MailAccountStatus => ({
  kind: "account",
  address: "me@example.com",
  connection: "connected",
  changeSignal: {
    kind: "tick",
    everyMs: 30_000,
    idleEveryMs: 600_000,
    watching: true,
  },
  syncedAt: "2026-11-26T10:00:00.000Z",
  syncFailure: null,
  ...over,
});

describe("the Mail row", () => {
  test("is absent until Mail holds an account", () => {
    expect(mailHealth(ready({ kind: "none" }))).toEqual({ state: "absent" });
    expect(mailHealth({ status: "unavailable", message: "x" })).toEqual({
      state: "absent",
    });
  });

  test("not known yet is unknown, never ok", () => {
    expect(mailHealth({ status: "loading" } as never)).toEqual({
      state: "unknown",
    });
  });

  test("a disconnected account needs attention", () => {
    const h = mailHealth(
      ready({
        kind: "not-connected",
        address: "me@example.com",
        message: "consent revoked",
      }),
    );
    expect(h.state).toBe("attention");
    expect(h.summary).toContain("consent revoked");
  });

  test("a failing sync needs attention; offline is grey", () => {
    const failing = mailHealth(
      ready(
        account({
          syncFailure: {
            at: "2026-11-26T10:01:00.000Z",
            kind: "fault",
            message: "boom",
          },
        }),
      ),
    );
    expect(failing.state).toBe("attention");
    expect(failing.summary).toContain("boom");
    expect(mailHealth(ready(account({ connection: "offline" }))).state).toBe(
      "unknown",
    );
  });

  test("synced says how changes arrive", () => {
    const open = mailHealth(ready(account()));
    expect(open.state).toBe("ok");
    expect(open.summary).toContain("every 30 s while Mail is open");
    const idle = mailHealth(
      ready(
        account({
          changeSignal: {
            kind: "tick",
            everyMs: 30_000,
            idleEveryMs: 600_000,
            watching: false,
          },
        }),
      ),
    );
    expect(idle.summary).toContain("every 10 min");
  });
});
