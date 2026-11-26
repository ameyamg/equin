import { describe, expect, test } from "bun:test";
import {
  ASKING_USER,
  firstSentence,
  restingOnUser,
  WAITING_ON_USER,
} from "./annotation";

describe("firstSentence", () => {
  test("drops headings and emphasis, cuts at the first sentence end", () => {
    expect(
      firstSentence("## Problem\n\n**Problem** — the cache leaked. It grew."),
    ).toBe("Problem");
    expect(firstSentence("**Problem** — the cache leaked. It grew.")).toBe(
      "Problem — the cache leaked.",
    );
  });
  test("caps a long first line", () => {
    const s = firstSentence("x".repeat(500));
    expect(s.length).toBe(120);
    expect(s.endsWith("…")).toBe(true);
  });
});

describe("restingOnUser", () => {
  const declaredAt = new Date("2026-11-26T02:06:00Z");
  const user = { to: "user" as const, awaiting: "Ship A or B?", declaredAt };
  const base = {
    status: "waiting" as const,
    waitingFor: null,
    declared: user,
    userSpokeAt: new Date("2026-11-26T02:04:00Z"),
  };

  test("its last turn said `user`, and the user has not spoken since", () => {
    expect(restingOnUser(base)).toBe(`${WAITING_ON_USER}: Ship A or B?`);
    expect(restingOnUser({ ...base, status: "gone" })).toBe(
      `${WAITING_ON_USER}: Ship A or B?`,
    );
  });
  test("`supervisor` (handed back or about to be), or nothing declared", () => {
    expect(
      restingOnUser({ ...base, declared: { ...user, to: "supervisor" } }),
    ).toBeNull();
    expect(restingOnUser({ ...base, declared: null })).toBeNull();
  });
  test("the user spoke after the declaration: it is their turn's agent now", () => {
    expect(
      restingOnUser({ ...base, userSpokeAt: new Date("2026-11-26T03:00:00Z") }),
    ).toBeNull();
  });
  test("waiting on its AskUserQuestion", () => {
    expect(
      restingOnUser({ ...base, waitingFor: "question", declared: null }),
    ).toBe(ASKING_USER);
  });
  test("held on a turn it has not started, busy, or closed: no word", () => {
    expect(restingOnUser({ ...base, waitingFor: "stuck-turn" })).toBeNull();
    expect(restingOnUser({ ...base, status: "working" })).toBeNull();
    expect(restingOnUser({ ...base, status: "done" })).toBeNull();
  });
});
