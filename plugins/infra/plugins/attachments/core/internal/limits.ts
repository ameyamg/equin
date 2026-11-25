/**
 * How large an upload may be when its caller declares nothing: 20 MB — an
 * image, a document, a short recording. Every upload before video was this.
 */
export const ATTACHMENT_DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

/**
 * The most any caller may declare for one upload (`maxBytes` on
 * `POST /api/attachments`, `importAttachment`): 500 MB.
 *
 * Not a raised limit: video is content the 20 MB default was never sized for
 * (a few minutes of screen recording), so a caller that holds video says so —
 * a media field declares its own `maxBytes` — and the bound stays explicit.
 * The upload is streamed to the blob store, never held in memory, so the cap
 * bounds disk, not the backend's heap.
 */
export const ATTACHMENT_MAX_BYTES = 500 * 1024 * 1024;
