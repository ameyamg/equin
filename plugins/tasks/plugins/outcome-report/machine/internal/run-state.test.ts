import { describe, expect, test } from "bun:test";
import { runEnd, userInRun, type RunState } from "./run-state";

const t = (minute: number) => new Date(Date.UTC(2026, 10, 25, 20, minute));

function state(over: Partial<RunState> = {}): RunState {
  return { userSpokeAt: null, handedBackAt: null, addressee: null, ...over };
}

describe("userInRun", () => {
  test("never spoken to: not in the run", () => {
    expect(userInRun(state())).toBe(false);
  });
  test("spoke, never handed back: in the run", () => {
    expect(userInRun(state({ userSpokeAt: t(1) }))).toBe(true);
  });
  test("spoke after the last hand-back: in the run", () => {
    expect(userInRun(state({ userSpokeAt: t(5), handedBackAt: t(2) }))).toBe(
      true,
    );
  });
  test("a hand-back after the user's word resets the run", () => {
    expect(userInRun(state({ userSpokeAt: t(2), handedBackAt: t(5) }))).toBe(
      false,
    );
  });
});

describe("runEnd", () => {
  test("an autonomous run that stops for good is handed back", () => {
    expect(runEnd(state(), [])).toBe("hand-back");
  });
  test("an autonomous run that will be woken is a pause", () => {
    expect(runEnd(state(), ["background work in flight"])).toBe("none");
  });
  test("with the user in the run and no addressee: the reply is theirs", () => {
    expect(runEnd(state({ userSpokeAt: t(1) }), [])).toBe("none");
  });
  test("with the user in the run, `user`: the reply is theirs", () => {
    expect(runEnd(state({ userSpokeAt: t(1), addressee: "user" }), [])).toBe(
      "none",
    );
  });
  test("with the user in the run, `supervisor`: handed back, waivers or not", () => {
    expect(
      runEnd(state({ userSpokeAt: t(1), addressee: "supervisor" }), [
        "background work in flight",
      ]),
    ).toBe("hand-back");
  });
});
