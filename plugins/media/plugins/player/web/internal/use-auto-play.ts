import { useEffect, useRef } from "react";
import { playMedia } from "@plugins/primitives/plugins/dom/plugins/media-element/web";
import { muteMedia } from "./media-ops";

/**
 * `autoPlay={true}`: play once when opened, with sound when the browser
 * allows it, else muted (the one autoplay every browser allows without a
 * gesture) — a visitor arriving from a link elsewhere has given this page no
 * gesture yet, so a play with sound is refused and the media would sit paused
 * under its big play button. Muted, it plays, and the player's speaker is one
 * click from the sound.
 *
 * Asked for once per mount: a later pause is the user's, and a resumed player
 * (`useKeptPlayhead`) never gets here — `enabled` is false for it.
 */
export function useAutoPlay(
  enabled: boolean,
  el: HTMLMediaElement | null,
): void {
  const asked = useRef(false);
  useEffect(() => {
    if (!enabled || el === null || asked.current) return;
    asked.current = true;
    void (async () => {
      const outcome = await playMedia(el);
      // Overtaken (the user paused, a new src) or a failed source (onError
      // reports it): nothing to retry. Only the gesture refusal has an answer.
      if (outcome.kind !== "refused" || outcome.reason !== "no-gesture") return;
      muteMedia(el);
      await playMedia(el);
    })();
  }, [enabled, el]);
}
