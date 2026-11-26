import { useCallback, useEffect, useRef } from "react";
import { useInView } from "@plugins/primitives/plugins/dom/plugins/in-view/web";
import { playMedia } from "@plugins/primitives/plugins/dom/plugins/media-element/web";
import { muteMedia } from "./media-ops";

/** How much of the player must be on screen for it to play. */
const IN_VIEW_THRESHOLD = 0.5;

/**
 * `autoPlay="in-view"`: the media starts muted (the one autoplay every
 * browser allows without a gesture) and plays while at least half the player
 * is on screen, pausing when it leaves — a page of clips plays the one being
 * read, and fetches a clip only once it is first scrolled to (`preload` stays
 * `metadata` until a play).
 *
 * The moment the user plays or pauses it themselves (`takeOver`, called from
 * the player's one toggle) the player is theirs: visibility drives it no more.
 * Unmuting is not a take-over — a clip the user turned the sound on keeps
 * following the view. In its own picture-in-picture window the player is off
 * the page on purpose: leaving the view there pauses nothing.
 */
export function useInViewPlay(
  enabled: boolean,
  el: HTMLMediaElement | null,
  root: HTMLElement | null,
  inOwnWindow: boolean,
): { takeOver(): void } {
  const takenOver = useRef(false);

  // Muted from the start, before the first play is asked for.
  useEffect(() => {
    if (enabled && el) muteMedia(el);
  }, [enabled, el]);

  const inOwnWindowRef = useRef(inOwnWindow);
  useEffect(() => {
    inOwnWindowRef.current = inOwnWindow;
  }, [inOwnWindow]);

  useInView(
    () => (enabled ? root : null),
    (entry) => {
      if (!el || takenOver.current || inOwnWindowRef.current) return;
      const visible = entry.intersectionRatio >= IN_VIEW_THRESHOLD;
      // A refusal (a low-power mode that blocks even muted playback, a
      // source that failed — the element's error event reports that) leaves
      // it paused under its big play button.
      if (visible && el.paused) void playMedia(el);
      else if (!visible && !el.paused) el.pause();
    },
    { threshold: [0, IN_VIEW_THRESHOLD], deps: [enabled, root, el] },
  );

  const takeOver = useCallback(() => {
    takenOver.current = true;
  }, []);
  return { takeOver };
}
