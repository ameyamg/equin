import { link, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { lstat } from "@plugins/packages/plugins/timed-fs/core";
import { numberedName, recordingFileNames } from "../../core";

/**
 * Save a recording under the first free `<base>[ (n)]` stem: `video` linked
 * as `<stem>.mp4`, `pointerJson` (if any) written as `<stem>.pointer.json`.
 * The pair is named as one unit — a stem is taken if EITHER file exists, so a
 * pointer track left behind by an earlier recording (its video deleted) is
 * skipped, never attached to this video nor refused at the write. Neither a
 * link nor a `wx` write overwrites, so two recordings in one minute both
 * survive. Answers the video's file name.
 */
export async function saveFreePair(
  video: string,
  pointerJson: string | null,
  folder: string,
  base: string,
): Promise<string> {
  for (let n = 1; ; n++) {
    const names = recordingFileNames(numberedName(base, n));
    const pointerPath = join(folder, names.pointer);
    // The pointer name is claimed first: by the write itself, or (no track to
    // write) by seeing it free.
    if (pointerJson === null) {
      if (await exists(pointerPath)) continue;
    } else if (
      !(await created(() =>
        writeFile(pointerPath, pointerJson, { flag: "wx" }),
      ))
    ) {
      continue;
    }
    let linked = false;
    try {
      linked = await created(() => link(video, join(folder, names.video)));
    } finally {
      // The video's name was taken, or the link failed: a claimed track never
      // stays behind without its video.
      if (!linked && pointerJson !== null) await rm(pointerPath);
    }
    if (linked) return names.video;
  }
}

/** Runs a create that refuses an existing file: false when it was taken. */
async function created(create: () => Promise<void>): Promise<boolean> {
  try {
    await create();
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}
