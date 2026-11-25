/**
 * A recording's file name, without its extension: `<YYYY-MM-DD HH.MM> <tab
 * title>` in local time — sortable, and free of what a file name cannot hold.
 */
export function recordingBaseName(title: string, at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}.${pad(at.getMinutes())}`;
  const clean = title
    // Path separators, the characters Windows and the Finder refuse, controls.
    .replace(/[/\\:*?"<>|\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // A leading dot would hide the file.
    .replace(/^\.+/, "")
    .slice(0, 80)
    .trim();
  return clean === "" ? `${stamp} Recording` : `${stamp} ${clean}`;
}

/** The `n`th candidate for a taken name: `name`, `name (2)`, `name (3)`… */
export function numberedName(base: string, n: number): string {
  return n === 1 ? base : `${base} (${n})`;
}

/**
 * The files one recording is saved as, named as one unit from one stem: the
 * video and its pointer track beside it. A stem is free only while both are.
 */
export function recordingFileNames(stem: string): {
  video: string;
  pointer: string;
} {
  return { video: `${stem}.mp4`, pointer: `${stem}.pointer.json` };
}

/** The pointer track's path beside a saved video's (`<stem>.mp4`). */
export function pointerTrackPathOf(videoPath: string): string {
  if (!videoPath.endsWith(".mp4"))
    throw new Error(`not a recording's video: ${videoPath}`);
  return recordingFileNames(videoPath.slice(0, -".mp4".length)).pointer;
}
