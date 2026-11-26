import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { WithShortcuts } from "@plugins/primitives/plugins/shortcuts/web/testing";
import { MediaPlayer } from "../components/media-player";
import { installMediaStub } from "./media-stub";

/** The one observer the player builds; `show(ratio)` reports its root that much on screen. */
class FakeIntersectionObserver {
  static live: FakeIntersectionObserver | null = null;
  target: Element | null = null;
  constructor(public cb: IntersectionObserverCallback) {
    FakeIntersectionObserver.live = this;
  }
  observe(el: Element): void {
    this.target = el;
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  show(ratio: number): void {
    const entry = {
      target: this.target,
      intersectionRatio: ratio,
      isIntersecting: ratio > 0,
    } as unknown as IntersectionObserverEntry;
    act(() => this.cb([entry], this as unknown as IntersectionObserver));
  }
}

let media: ReturnType<typeof installMediaStub>;

beforeEach(() => {
  media = installMediaStub();
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  FakeIntersectionObserver.live = null;
});

function setup() {
  render(
    <WithShortcuts>
      <MediaPlayer
        kind="video"
        src="clip.mp4"
        label="Clip"
        keep={null}
        autoPlay="in-view"
      />
    </WithShortcuts>,
  );
  const root = document.querySelector<HTMLElement>("[data-media-player]")!;
  const video = root.querySelector("video")!;
  const io = FakeIntersectionObserver.live!;
  return { root, video, io };
}

const pauseButton = (root: HTMLElement) =>
  Array.from(root.querySelectorAll("button")).find(
    (b) => b.getAttribute("aria-label") === "Pause",
  )!;

describe('autoPlay="in-view"', () => {
  it("starts muted and looping, not by the native autoplay attribute", () => {
    const { video, io } = setup();
    expect(io.target).not.toBeNull();
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.autoplay).toBe(false);
    expect(video.paused).toBe(true);
  });

  it("plays while half on screen and pauses when it leaves", () => {
    const { video, io } = setup();
    io.show(0.2);
    expect(video.paused).toBe(true);
    io.show(0.6);
    expect(video.paused).toBe(false);
    io.show(0);
    expect(video.paused).toBe(true);
    io.show(1);
    expect(video.paused).toBe(false);
    expect(media.play).toHaveBeenCalledTimes(2);
  });

  it("a pause by the user is theirs: coming back into view does not resume", () => {
    const { root, video, io } = setup();
    io.show(1);
    fireEvent.click(pauseButton(root));
    expect(video.paused).toBe(true);
    io.show(0);
    io.show(1);
    expect(video.paused).toBe(true);
  });
});
