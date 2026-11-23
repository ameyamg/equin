import { useSession } from "@plugins/apps/plugins/sonata/plugins/session/web";
import {
  swingSetting,
  type SongSettingFailure,
  useEditSongSetting,
  useSongDocument,
  useSongSetting,
} from "@plugins/apps/plugins/sonata/plugins/document/web";
import {
  swingOverrideFor,
  type Swing,
  type SwingOverride,
} from "@plugins/apps/plugins/sonata/plugins/score/core";
import { DEFAULT_SWING } from "../core";
import { useFetchEndpoint } from "@plugins/infra/plugins/endpoints/web";
import { saveSwing } from "./actions";

export type SwingState =
  | { kind: "none" }
  | { kind: "pending" }
  | ({ kind: "failed" } & SongSettingFailure)
  | {
      kind: "ready";
      override: SwingOverride;
      /** Whether the song plays swung now. */
      on: boolean;
      /**
       * The feel: the one playing, or — while off — the one turning swing back
       * on plays (the last one chosen, else the content's own, else 8ths 2:1).
       */
      feel: Swing;
      /** The feel the song's content marks; absent = none. */
      authored: Swing | undefined;
      /** Play `feel` when `on`, else straight keeping `feel`; persisted for this song. */
      set: (on: boolean, feel: Swing) => void;
      /** Back to the song's own feel. */
      reset: () => void;
    };

/**
 * The loaded song's swing: the override, the feel it plays (the pipeline's
 * `meta.swing`), the feel its content marks, and the writes — persisted for a
 * library song, kept in memory for a file document (a shared link previewed,
 * which "Add to library" then keeps). `none` before a song is loaded.
 */
export function useSwing(): SwingState {
  const { identity } = useSongDocument();
  const setting = useSongSetting(swingSetting);
  const write = useEditSongSetting(swingSetting);
  const { score } = useSession();
  const fetchEndpoint = useFetchEndpoint();
  if (identity === null) return { kind: "none" };
  if (setting.kind === "pending") return { kind: "pending" };
  if (setting.kind === "failed")
    return { kind: "failed", error: setting.error, refetch: setting.refetch };
  const override = setting.value;
  const authored =
    override.kind === "score" ? score.meta.swing : score.meta.authoredSwing;
  const playing = score.meta.swing;
  const feel =
    playing ??
    (override.kind === "straight" ? override.feel : undefined) ??
    authored ??
    DEFAULT_SWING;
  const apply = (next: SwingOverride) => {
    write(identity, next); // optimistic: playback follows at once
    if (identity.kind === "library") {
      saveSwing(fetchEndpoint, identity.songId, next);
    }
  };
  return {
    kind: "ready",
    override,
    on: playing !== undefined,
    feel,
    authored,
    set: (on, next) => apply(swingOverrideFor(on, next, authored)),
    reset: () => apply({ kind: "score" }),
  };
}
