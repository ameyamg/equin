import { useCallback, useEffect } from "react";
import {
  grooveSetting,
  songIdentityKey,
  useEditSongSetting,
  useSongDocument,
  useSongSetting,
} from "@plugins/apps/plugins/sonata/plugins/document/web";
import { useLive } from "@plugins/network/plugins/live/web";
import {
  combineResources,
  mapResource,
  type PortableGateInput,
  type ResourceResult,
} from "@plugins/network/plugins/live/plugins/live-state/web";
import {
  grooveEquals,
  type GrooveContent,
  type GrooveFields,
} from "../shared/groove";
import {
  DEFAULT_GROOVE_PRESET_ID,
  seedGroovePreset,
} from "../shared/groove-presets";
import { rhythms } from "../shared/resources";
import { useSaveRhythm } from "./actions";
import {
  confirmPendingPreset,
  NO_PENDING_PRESET,
  setPendingPreset,
  usePendingPreset,
} from "./pending-preset";

/** A known groove: the resolved fields and their writer. */
export type GrooveState = GrooveFields & {
  /**
   * Optimistically drive playback (the setting) and persist; the observer
   * re-affirms the same value on the next push.
   */
  commit: (next: GrooveFields) => void;
};

/**
 * The resolved groove for the open song, plus the optimistic-commit writer —
 * `loading` while the song's groove is not known yet (the controls render a
 * loading state, never the default patterns standing in for the song's own),
 * `error` when the song's rhythm row failed to load.
 */
export type Groove = ResourceResult<GrooveState>;

/**
 * Single source of the open song's groove for the accompaniment body
 * (`RhythmControls`) and its preset picker.
 *
 * Two halves, both needed before anything is shown: the setting carries the
 * groove's content and its optimistic live value (instant playback) — the
 * observer settles it from the song's row, or the default accompaniment for a
 * song never configured — and the song's `rhythms` row carries its preset
 * provenance. A song with no row reads as applied from the default preset,
 * whose seed is what it plays.
 *
 * `presetId` (the preset the groove was last applied from) is the row's
 * `groovePresetId` under an optimistic overlay (`pending-preset.ts`), so
 * "edited" never flickers between a commit and its push.
 *
 * A file document (a shared link previewed before it is added) has no row and
 * persists nothing: its groove is the setting alone, edited in memory, and its
 * preset id lives in the overlay only (keyed by the document) — at first the
 * default preset's when it plays the default accompaniment, else none.
 */
export function useGroove(): Groove {
  const { identity } = useSongDocument();
  const currentSongId =
    identity !== null && identity.kind === "library" ? identity.songId : null;
  const store = useSongSetting(grooveSetting);
  const setGroove = useEditSongSetting(grooveSetting);
  const saveRhythm = useSaveRhythm();
  const row = useLive(rhythms, { id: currentSongId });
  const overlayKey = identity === null ? null : songIdentityKey(identity);
  const pendingPreset = usePendingPreset(overlayKey);

  // The row has caught up with the last committed preset id → drop the
  // overlay (only that id: an older push never evicts a newer commit's). An
  // unsettled or absent row confirms nothing.
  let rowPresetId: string | null | undefined;
  switch (row.status) {
    case "loading":
    case "error":
      rowPresetId = undefined;
      break;
    case "ready":
      rowPresetId = row.found ? row.row.groovePresetId : undefined;
      break;
  }
  useEffect(() => {
    if (currentSongId === null || rowPresetId === undefined) return;
    confirmPendingPreset(
      songIdentityKey({ kind: "library", songId: currentSongId }),
      rowPresetId,
    );
  }, [currentSongId, rowPresetId, pendingPreset]);

  const commit = useCallback(
    (next: GrooveFields) => {
      if (identity === null || overlayKey === null) return;
      setGroove(identity, {
        hands: { bass: next.bass, chord: next.chord },
        bassFigurationId: next.bassFigurationId,
        chordFigurationId: next.chordFigurationId,
        bassVoicing: next.bassVoicing,
        chordVoicing: next.chordVoicing,
        restartOnChordChange: next.restartOnChordChange,
      });
      // The preset id is this plugin's own column (not in the setting): overlay
      // it until the row's push carries it, so "edited" never flickers.
      setPendingPreset(overlayKey, next.presetId);
      // Only a library song's groove persists; a file document's stays in memory.
      if (currentSongId === null) return;
      saveRhythm(currentSongId, {
        bass: next.bass,
        chord: next.chord,
        bassPatternId: next.bassFigurationId,
        chordPatternId: next.chordFigurationId,
        bassVoicing: next.bassVoicing,
        chordVoicing: next.chordVoicing,
        groovePresetId: next.presetId,
        restartOnChordChange: next.restartOnChordChange,
      });
    },
    [setGroove, saveRhythm, identity, overlayKey, currentSongId],
  );

  // Both halves gate the groove: the setting (a SongSetting — pending, failed
  // or settled) and the row read — loading until both have settled, and a
  // failure of either fails the groove. The setting enters the combine through
  // its state alone, so its failure keeps its error.
  const setting: PortableGateInput =
    store.kind === "failed"
      ? { status: "error", error: store.error }
      : { status: store.kind === "settled" ? "ready" : "loading" };
  const gate = combineResources({ setting, row });
  return mapResource(gate, (): GrooveState => {
    // `gate` is ready ⇒ both halves are settled.
    if (
      store.kind !== "settled" ||
      row.status === "loading" ||
      row.status === "error"
    ) {
      throw new Error("useGroove: a ready gate over an unsettled input");
    }
    const live = store.value;
    const content = {
      bass: live.hands.bass,
      chord: live.hands.chord,
      bassFigurationId: live.bassFigurationId,
      chordFigurationId: live.chordFigurationId,
      bassVoicing: live.bassVoicing,
      chordVoicing: live.chordVoicing,
      restartOnChordChange: live.restartOnChordChange,
    };
    return {
      presetId:
        pendingPreset !== NO_PENDING_PRESET
          ? pendingPreset
          : row.found
            ? row.row.groovePresetId
            : currentSongId !== null || playsDefaultPreset(content)
              ? DEFAULT_GROOVE_PRESET_ID
              : null,
      bass: live.hands.bass,
      chord: live.hands.chord,
      bassFigurationId: live.bassFigurationId,
      chordFigurationId: live.chordFigurationId,
      bassVoicing: live.bassVoicing,
      chordVoicing: live.chordVoicing,
      restartOnChordChange: live.restartOnChordChange,
      commit,
    };
  });
}

/** Whether `content` sounds like the built-in default preset. */
function playsDefaultPreset(content: GrooveContent): boolean {
  const preset = seedGroovePreset(DEFAULT_GROOVE_PRESET_ID);
  if (preset === null) {
    throw new Error(
      `rhythm-controls: no built-in "${DEFAULT_GROOVE_PRESET_ID}" groove preset`,
    );
  }
  return grooveEquals(content, preset);
}
