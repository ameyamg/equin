import { link } from "node:fs/promises";
import { join } from "node:path";
import { numberedName } from "../../core";

/**
 * Save a recording's video under the first free `<base>[ (n)].mp4`: a link
 * never overwrites, so two recordings in one minute both survive. Its
 * pointer track is inside it (`cursorTrackBox`): one file per recording.
 * Answers the video's file name.
 */
export async function saveFreeName(
  video: string,
  folder: string,
  base: string,
): Promise<string> {
  for (let n = 1; ; n++) {
    const name = `${numberedName(base, n)}.mp4`;
    try {
      await link(video, join(folder, name));
      return name;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
}
