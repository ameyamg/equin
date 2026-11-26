import type { PointerTrack } from "@plugins/companions/plugins/browser-extension/core";
import type { Upload } from "./upload-store";

/**
 * A recording whose last chunk is this old, with no save asked for, was
 * left by its browser (closed, crashed, the extension reloaded): equin saves
 * what it holds. A pause sends no chunk either, so a recording paused longer
 * than this is saved as it stands, and a resume after it is refused.
 */
export const ABANDONED_AFTER_MS = 60 * 60_000;

/** What the save job does with a recording on one run. */
export type SaveStep =
  /** Nothing to save: saved already, or discarded. */
  | { kind: "gone" }
  /** Holds no byte: nothing was recorded — its files go. */
  | { kind: "empty" }
  | { kind: "save"; pointer: PointerTrack | null }
  /** Still recording: look again at `atMs` (epoch ms). */
  | { kind: "wait"; atMs: number };

/**
 * The step for `upload` at `nowMs`: a save asked for runs now; a partial that
 * takes no more chunks (no readable cursor — from before cursors, or broken)
 * is saved now; one left without a chunk for `ABANDONED_AFTER_MS` is saved
 * without its pointer track (only the extension had it); anything else is
 * still recording.
 */
export function saveStep(upload: Upload | null, nowMs: number): SaveStep {
  if (upload === null) return { kind: "gone" };
  const requested = upload.cursor?.finishRequested ?? null;
  const left =
    upload.cursor === null || nowMs - upload.writtenAt >= ABANDONED_AFTER_MS;
  if (requested === null && !left)
    return { kind: "wait", atMs: upload.writtenAt + ABANDONED_AFTER_MS };
  if (upload.bytes === 0) return { kind: "empty" };
  return { kind: "save", pointer: requested?.pointer ?? null };
}
