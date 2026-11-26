/** One item the viewer can show: an image (the default), or a video. */
export interface ViewerImage {
  /**
   * `"video"`: the stage plays it in the themed media player (no zoom, pan,
   * minimap or copy); the strip and grid show its first frame with a play
   * mark. Omitted: an image.
   */
  kind?: "image" | "video";
  /** A `data:`, `blob:` or http(s) URL. Decides the file actions — see
   *  `imageCapabilities` in this plugin's `core/`. */
  src: string;
  /** Shown in the viewer's top bar, and the download's file name. */
  name: string;
  /** Where the image came from, as a short chip in the top bar: "Read",
   *  "Pasted", "Markdown", "Attached", … Omitted = no chip. */
  sourceLabel?: string;
  /** Alt text. Defaults to `name`. */
  alt?: string;
  /** Natural size, when the caller already knows it. Otherwise it is measured
   *  once the image loads. */
  width?: number;
  height?: number;
  /**
   * A URL of this same image, smaller: its long edge at least `edge` px (the
   * provider may round up), or the original's when that is smaller. The viewer
   * asks for one at thumbnail size for the strip and the grid, and at screen
   * size for the stage — where it is used only when `width` / `height` are
   * known, since the zoom is computed from the original's size. A URL that
   * fails to load falls back to `src`. Omitted: `src` everywhere.
   */
  resized?: (edge: number) => string;
}

/** "Is this still the picture on screen?" — two entries with the same address
 *  and name are the same picture, whatever object carries them. (Compared
 *  field by field rather than through a concatenated key: a pasted image's
 *  `src` is a multi-megabyte data: URI.) */
export function sameImage(a: ViewerImage, b: ViewerImage): boolean {
  return a.src === b.src && a.name === b.name;
}

/** Is this item a video (played, not zoomed)? */
export function isVideo(image: ViewerImage): boolean {
  return image.kind === "video";
}
