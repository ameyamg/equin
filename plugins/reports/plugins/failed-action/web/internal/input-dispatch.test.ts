import { describe, expect, test } from "bun:test";
import { createInputDispatchWatch } from "./input-dispatch";

/**
 * Dispatch `type` on a fresh target, running `during` inside its listener. A
 * script dispatch: what it pins is the `eventPhase` bookkeeping, not the
 * microtask checkpoints a real (trusted) dispatch runs between listeners.
 */
function dispatchWith(type: string, during: (event: Event) => void): Event {
  const target = new EventTarget();
  const event = new Event(type);
  target.addEventListener(type, () => during(event));
  target.dispatchEvent(event);
  return event;
}

describe("an error is the user's action failing only inside the input's dispatch", () => {
  test("inside the handler, the input is current", () => {
    const watch = createInputDispatchWatch();
    let seen: Event | null = null;
    const click = dispatchWith("click", (e) => {
      watch.enter(e);
      seen = watch.current();
    });
    expect(seen === click).toBe(true);
  });

  test("once the dispatch has ended, nothing is current", () => {
    const watch = createInputDispatchWatch();
    dispatchWith("click", (e) => watch.enter(e));
    expect(watch.current()).toBeNull();
  });

  test("a later task (a timer, a live push) is never the input's", async () => {
    const watch = createInputDispatchWatch();
    let later: Event | null | "unset" = "unset";
    dispatchWith("keydown", (e) => {
      watch.enter(e);
      setTimeout(() => (later = watch.current()), 0);
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(later).toBeNull();
  });

  test("an inner dispatch ending leaves the outer one current", () => {
    const watch = createInputDispatchWatch();
    let afterInner: Event | null = null;
    const click = dispatchWith("click", (outer) => {
      watch.enter(outer);
      dispatchWith("submit", (inner) => watch.enter(inner));
      afterInner = watch.current();
    });
    expect(afterInner === click).toBe(true);
  });

  test("inside a nested dispatch, the innermost is current", () => {
    const watch = createInputDispatchWatch();
    let inside: Event | null = null;
    let submit: Event | null = null;
    dispatchWith("click", (outer) => {
      watch.enter(outer);
      submit = dispatchWith("submit", (inner) => {
        watch.enter(inner);
        inside = watch.current();
      });
    });
    expect(inside === submit).toBe(true);
  });
});
