import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { FloatingAction, FloatingActionFadeIn } from "../index";

/**
 * A press on a closed control opens it. With a mouse the pointer is ON it (it
 * collapsed under the pointer — dropped after a drag, closed by Esc — so no
 * enter fired): that is a hover, and leaving closes it. Only a touch press,
 * which has no hover, pins it open until an outside press.
 */

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  const utils = render(
    <FloatingAction label="Bar" trigger={<span>dot</span>}>
      <FloatingActionFadeIn>
        <button>item</button>
      </FloatingActionFadeIn>
    </FloatingAction>,
  );
  return utils.getByLabelText("Bar");
}

const isOpen = (wrapper: HTMLElement) => wrapper.hasAttribute("data-open");

describe("FloatingAction press on a closed control", () => {
  it("a mouse press opens it as a hover, which leaving closes", () => {
    const wrapper = setup();
    fireEvent.pointerDown(wrapper, { pointerType: "mouse" });
    expect(isOpen(wrapper)).toBe(true);

    fireEvent.pointerMove(document.body);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(isOpen(wrapper)).toBe(false);
  });

  it("a touch press pins it open until an outside press", () => {
    const wrapper = setup();
    fireEvent.pointerDown(wrapper, { pointerType: "touch" });
    expect(isOpen(wrapper)).toBe(true);

    fireEvent.pointerMove(document.body);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(isOpen(wrapper)).toBe(true);

    fireEvent.pointerDown(document.body);
    expect(isOpen(wrapper)).toBe(false);
  });
});
