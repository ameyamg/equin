import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import {
  installStorage,
  QuotaStorage,
} from "@plugins/primitives/plugins/dom/plugins/web-storage/web/testing";
import {
  flushKept,
  KeepScope,
} from "@plugins/primitives/plugins/kept-state/web";
import { WithShortcuts } from "@plugins/primitives/plugins/shortcuts/web/testing";
import { MediaPlayer } from "../components/media-player";
import { DURATION, installMediaStub } from "./media-stub";

let media: ReturnType<typeof installMediaStub>;

beforeAll(() => {
  installStorage("local", new QuotaStorage());
  installStorage("session", new QuotaStorage());
});
beforeEach(() => {
  media = installMediaStub();
});
afterEach(cleanup);

let n = 0;

/** One mount of an autoplaying player in `place` — a reload mounts it again. */
function open(place: string, keep: string | null = "clip") {
  const r = render(
    <WithShortcuts>
      <KeepScope segment="t:tab">
        <KeepScope segment={place}>
          <MediaPlayer
            kind="video"
            src="clip.mp4"
            label="Clip"
            keep={keep}
            autoPlay
          />
        </KeepScope>
      </KeepScope>
    </WithShortcuts>,
  );
  const root = document.querySelector<HTMLElement>("[data-media-player]")!;
  const video = root.querySelector("video")!;
  act(() => {
    video.dispatchEvent(new Event("loadedmetadata"));
  });
  return { ...r, root, video };
}

/** Leave the page: unmount and write what is pending, as `pagehide` does. */
function leave(r: { unmount(): void }) {
  r.unmount();
  flushKept();
}

describe("the kept playhead", () => {
  it("autoplays a first open", () => {
    const { video } = open(`p:${++n}`);
    expect(video.paused).toBe(false);
    expect(video.muted).toBe(false);
  });

  it("a first open the browser refuses sound for plays muted", async () => {
    media.play.mockImplementationOnce(() =>
      Promise.reject(new DOMException("no gesture", "NotAllowedError")),
    );
    const { video } = open(`p:${++n}`);
    await act(async () => {});
    expect(media.play).toHaveBeenCalledTimes(2);
    expect(video.muted).toBe(true);
    expect(video.paused).toBe(false);
  });

  it("a reload after the video ended stays at the end, paused — no replay", () => {
    const place = `p:${++n}`;
    const first = open(place);
    act(() => {
      first.video.currentTime = DURATION;
      first.video.dispatchEvent(new Event("ended"));
    });
    leave(first);
    // The first open's own autoplay is not the reload's.
    media.play.mockClear();

    const again = open(place);
    expect(again.video.currentTime).toBe(DURATION);
    expect(again.video.paused).toBe(true);
    expect(media.play).not.toHaveBeenCalled();
    // It has played: no big play button over where it stopped.
    expect(again.root.hasAttribute("data-unplayed")).toBe(false);
  });

  it("a reload mid-way resumes paused where it was", () => {
    const place = `p:${++n}`;
    const first = open(place);
    act(() => {
      first.video.currentTime = 12.5;
      first.video.dispatchEvent(new Event("pause"));
    });
    leave(first);

    const again = open(place);
    expect(again.video.paused).toBe(true);
    expect(again.video.currentTime).toBe(12.5);
  });

  it("another place, or another key, is a fresh open", () => {
    const place = `p:${++n}`;
    const first = open(place);
    act(() => {
      first.video.currentTime = 30;
      first.video.dispatchEvent(new Event("pause"));
    });
    leave(first);

    const elsewhere = open(`p:${++n}`);
    expect(elsewhere.video.paused).toBe(false);
    leave(elsewhere);
    const otherFile = open(place, "other");
    expect(otherFile.video.paused).toBe(false);
  });

  it("keep={null} keeps nothing", () => {
    const place = `p:${++n}`;
    const first = open(place, null);
    act(() => {
      first.video.currentTime = 30;
      first.video.dispatchEvent(new Event("pause"));
    });
    leave(first);
    expect(open(place, null).video.paused).toBe(false);
  });
});
