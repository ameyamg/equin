import { useEndpointMutation } from "@plugins/infra/plugins/endpoints/web";
import { computerFileTrash } from "@plugins/infra/plugins/paths/plugins/file-systems/core";
import { useOpenInFiles } from "@plugins/apps/plugins/file-explorer/plugins/browser/web";
import type { ExtensionHost } from "@plugins/companions/plugins/browser-extension/web";
import type { SavedRecording } from "@plugins/companions/plugins/browser-extension/core";
import { pointerTrackPathOf } from "../../core";

/**
 * The saved recording's two actions:
 *
 * - **Show in Files** — the file explorer on its folder with the video
 *   previewed (the explorer's own route), in a new tab;
 * - **Delete** — the video and its pointer track beside it (if any) moved to
 *   the Trash through the explorer's own file operation (`computerFileTrash`,
 *   Put Back works); the row leaves, the Trash is the undo. The pair goes
 *   together: a track left behind would hold its name against the next save.
 */
export function useSavedActions(
  host: Extract<ExtensionHost, { kind: "present" }>,
  recording: SavedRecording,
  forget: () => Promise<void>,
): { reveal: () => Promise<void>; trash: () => Promise<void> } {
  const files = useOpenInFiles({
    fs: "computer",
    dir: recording.folder,
    open: recording.path,
  });
  const trashFile = useEndpointMutation(computerFileTrash);
  const { openTab } = host;
  return {
    reveal: async () => {
      if (openTab === null)
        throw new Error("This extension cannot open a tab.");
      await openTab(new URL(files.href(), window.location.origin).href);
    },
    trash: async () => {
      if (trashFile.kind === "unavailable")
        throw new Error("Moving to the Trash needs equin on the computer.");
      const paths = [recording.path, pointerTrackPathOf(recording.path)];
      const { results } = await trashFile.mutateAsync({ body: { paths } });
      const [video, track] = results;
      if (video === undefined || track === undefined || results.length > 2)
        throw new Error(
          `${recording.name} was not moved to the Trash (${results.length} answers for ${paths.length} files).`,
        );
      const done = (kind: string): boolean =>
        kind === "removed" || kind === "missing";
      if (!done(video.kind))
        throw new Error(
          `${recording.name} was not moved to the Trash (${video.kind}).`,
        );
      // The video is in the Trash: the row goes, whatever its track did.
      await forget();
      if (!done(track.kind))
        throw new Error(
          `${recording.name} is in the Trash, but its pointer track ${paths[1]} is not (${track.kind}).`,
        );
    },
  };
}
