/** Bytes in one MB of the upload limit setting — the decimal megabyte, a little under Discord's own. */
export const MB = 1_000_000;

/** What a multipart request spends besides the files: the JSON part, the headers. */
export function requestOverheadBytes(
  contentChars: number,
  files: number,
): number {
  // Content is UTF-8 (≤ 4 bytes a character); each part has its boundary and headers.
  return 4096 + contentChars * 4 + files * 512;
}

export interface UploadCandidate {
  filename: string;
  mime: string;
  size: number;
}

/** One file's fate in a request: sent as it is, or re-encoded to fit `budgetBytes`. */
export type UploadStep =
  | { index: number; action: "send" }
  | { index: number; action: "transcode"; budgetBytes: number };

export type UploadPlan =
  { kind: "plan"; steps: UploadStep[] } | { kind: "refused"; message: string };

const isVideo = (f: UploadCandidate) => f.mime.startsWith("video/");

/** A size in words: `12.3 MB`. */
export function sizeText(bytes: number): string {
  return `${(bytes / MB).toFixed(1)} MB`;
}

/** Every file and its size, for a refusal: `a.png 3.1 MB, b.mp4 40.0 MB`. */
export function sizesText(
  files: readonly { filename: string; size: number }[],
): string {
  return files.map((f) => `${f.filename} ${sizeText(f.size)}`).join(", ");
}

/**
 * How a post's files fit ONE request of at most `limitBytes` (Discord's
 * limit is per request, every file together), after `reservedBytes` for
 * the rest of the request:
 *
 * - everything fits → each is sent as it is;
 * - a file that is not a video (an image) is never re-encoded: over the
 *   limit on its own, or leaving no room for the videos, the post is refused;
 * - otherwise the videos share what the other files leave: the smaller ones
 *   that fit their equal share are sent as they are, the rest are re-encoded,
 *   each to an equal share of what is left.
 *
 * A refusal names each file's size and the limit — the user trims or splits
 * the item. Never a link instead of a file.
 */
export function planUploads(
  files: readonly UploadCandidate[],
  limitBytes: number,
  reservedBytes: number,
): UploadPlan {
  const budget = limitBytes - reservedBytes;
  const limit = sizeText(limitBytes);
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total <= budget) {
    return {
      kind: "plan",
      steps: files.map((_, index) => ({ index, action: "send" as const })),
    };
  }
  const stills = files.filter((f) => !isVideo(f));
  const tooBig = stills.filter((f) => f.size > budget);
  if (tooBig.length > 0) {
    return {
      kind: "refused",
      message: `Over Discord's ${limit} upload limit, and only a video can be re-encoded: ${sizesText(tooBig)}.`,
    };
  }
  let left = budget - stills.reduce((n, f) => n + f.size, 0);
  const videos = files
    .map((f, index) => ({ f, index }))
    .filter(({ f }) => isVideo(f))
    .sort((a, b) => a.f.size - b.f.size);
  if (videos.length === 0 || left <= 0) {
    return {
      kind: "refused",
      message: `These files together are over Discord's ${limit} upload limit for one message (${sizesText(files)}) — remove some, or post them in two items.`,
    };
  }
  const steps = new Map<number, UploadStep>();
  files.forEach((f, index) => {
    if (!isVideo(f)) steps.set(index, { index, action: "send" });
  });
  let n = videos.length;
  for (const { f, index } of videos) {
    const share = Math.floor(left / n);
    if (f.size <= share) {
      steps.set(index, { index, action: "send" });
      left -= f.size;
    } else {
      steps.set(index, { index, action: "transcode", budgetBytes: share });
      left -= share;
    }
    n -= 1;
  }
  return {
    kind: "plan",
    steps: files.map((_, index) => steps.get(index) as UploadStep),
  };
}
