import { describe, expect, test } from "bun:test";
import type { MailAccountStatus } from "../../core";
import { mailHealth } from "./status-view";
import {
  createDateFormatter,
  DEFAULT_DATE_FORMAT_PREFS,
} from "@plugins/fields/plugins/date/plugins/format/core/testing";

const fmt = createDateFormatter(DEFAULT_DATE_FORMAT_PREFS);

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
    push: { kind: "none" },
    everyMs: 30_000,
    idleEveryMs: 600_000,
    watching: true,
    ticking: true,
  },
  mailboxColors: null,
  syncedAt: "2026-11-26T10:00:00.000Z",
  syncFailure: null,
  ...over,
});

describe("the Mail row", () => {
  test("is absent until Mail holds an account", () => {
    expect(mailHealth(ready({ kind: "none" }), fmt)).toEqual({
      state: "absent",
    });
    expect(mailHealth({ status: "unavailable", message: "x" }, fmt)).toEqual({
      state: "absent",
    });
  });

  test("not known yet is unknown, never ok", () => {
    expect(mailHealth({ status: "loading" } as never, fmt)).toEqual({
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
      fmt,
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
      fmt,
    );
    expect(failing.state).toBe("attention");
    expect(failing.summary).toContain("boom");
    expect(
      mailHealth(ready(account({ connection: "offline" })), fmt).state,
    ).toBe("unknown");
  });

  test("synced says how changes arrive", () => {
    const open = mailHealth(ready(account()), fmt);
    expect(open.state).toBe("ok");
    expect(open.summary).toContain("every 30 s while Mail is open");
    const idle = mailHealth(
      ready(
        account({
          changeSignal: {
            push: { kind: "none" },
            everyMs: 30_000,
            idleEveryMs: 600_000,
            watching: false,
            ticking: false,
          },
        }),
      ),
      fmt,
    );
    expect(idle.summary).toContain("every 10 min");
  });

  test("push live says instant updates; not set up says so beside the fallback", () => {
    const signal = (
      push: Extract<
        MailAccountStatus,
        { kind: "account" }
      >["changeSignal"]["push"],
      ticking: boolean,
    ) =>
      account({
        changeSignal: {
          push,
          everyMs: 30_000,
          idleEveryMs: 600_000,
          watching: true,
          ticking,
        },
      });
    const live = mailHealth(
      ready(signal({ kind: "live", since: "2026-11-26T10:00:00.000Z" }, false)),
      fmt,
    );
    expect(live.state).toBe("ok");
    expect(live.summary).toContain("instant updates (push)");
    expect(live.summary).not.toContain("every 30 s");
    const notSetUp = mailHealth(
      ready(signal({ kind: "not-set-up" }, true)),
      fmt,
    );
    expect(notSetUp.state).toBe("ok");
    expect(notSetUp.summary).toContain("every 30 s while Mail is open");
    expect(notSetUp.summary).toContain("not set up");
  });

  test("push set up but down needs attention, naming why and the fallback", () => {
    const h = mailHealth(
      ready(
        account({
          changeSignal: {
            push: {
              kind: "down",
              since: "2026-11-26T10:00:00.000Z",
              message: "subscription deleted",
            },
            everyMs: 30_000,
            idleEveryMs: 600_000,
            watching: true,
            ticking: true,
          },
        }),
      ),
      fmt,
    );
    expect(h.state).toBe("attention");
    expect(h.summary).toContain("subscription deleted");
    expect(h.summary).toContain("every 30 s");
  });
});
