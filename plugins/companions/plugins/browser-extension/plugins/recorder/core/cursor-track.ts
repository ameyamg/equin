import {
  PointerTrackSchema,
  type PointerTrack,
} from "@plugins/companions/plugins/browser-extension/core";

/**
 * A recording's pointer track, carried inside its MP4: one top-level ISO
 * BMFF `uuid` box after the movie's other boxes, its payload the track as
 * UTF-8 JSON.
 *
 * Why a top-level box, appended after the remux (not a timed track): every
 * MP4 reader skips a box it does not know (ISO/IEC 14496-12 § 4.2), so
 * players, QuickTime, browsers and uploads see the video as it is; appended
 * after `mdat` it moves no sample offset and leaves the faststart `moov` at
 * the front; and nothing of it depends on what ffmpeg keeps through a remux
 * (a data stream of ours is a codec it does not know, and subtitles would
 * show up in players' menus). A tool that rewrites the file (an editor's
 * export) drops it — that file is no longer the recording.
 */

/** The box's extended type: names equin's pointer track (version 1 of the
 *  payload is `PointerTrack.version`). */
export const CURSOR_TRACK_UUID = "8f3c2a71-5d4e-4b9a-a6c1-0e7d2f9b3c58";

const UUID_BYTES = uuidBytes(CURSOR_TRACK_UUID);
/** size (4) + type (4) + extended type (16). */
const HEADER = 24;

function uuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error(`not a UUID: ${uuid}`);
  return Uint8Array.from({ length: 16 }, (_, i) =>
    Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16),
  );
}

/** The box to append to a recording's MP4. */
export function cursorTrackBox(track: PointerTrack): Uint8Array {
  const payload = new TextEncoder().encode(
    JSON.stringify(PointerTrackSchema.parse(track)),
  );
  const size = HEADER + payload.length;
  if (size > 0xffff_ffff)
    throw new Error(`a pointer track of ${size} bytes is past a box's size`);
  const box = new Uint8Array(size);
  const view = new DataView(box.buffer);
  view.setUint32(0, size);
  box.set(new TextEncoder().encode("uuid"), 4);
  box.set(UUID_BYTES, 8);
  box.set(payload, HEADER);
  return box;
}

/** What a video holds: its pointer track, or none (a video not recorded by
 *  the tab recorder, or recorded before tracks were kept inside). */
export type CursorTrackRead =
  { kind: "found"; track: PointerTrack } | { kind: "absent" };

/**
 * The pointer track inside an MP4, read by walking its top-level boxes —
 * only their headers are read (a `Blob` slice each: a browser `File` or a
 * `Bun.file` stays on disk), then the track's payload. A file that is not a
 * well-formed box sequence throws: never mistaken for "no track".
 */
export async function readCursorTrack(file: Blob): Promise<CursorTrackRead> {
  const end = file.size;
  let at = 0;
  while (at < end) {
    const head = await bytesOf(file, at, Math.min(at + 32, end));
    if (head.length < 8)
      throw new Error(`not an MP4: a box header cut short at byte ${at}`);
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const type = String.fromCharCode(...head.subarray(4, 8));
    let size = view.getUint32(0);
    let header = 8;
    if (size === 1) {
      if (head.length < 16)
        throw new Error(`not an MP4: a box header cut short at byte ${at}`);
      size = Number(view.getBigUint64(8));
      header = 16;
    } else if (size === 0) {
      // The last box, to the end of the file.
      size = end - at;
    }
    if (size < header || at + size > end)
      throw new Error(
        `not an MP4: box "${type}" at byte ${at} claims ${size} bytes (the file has ${end})`,
      );
    if (
      type === "uuid" &&
      size >= header + 16 &&
      head.length >= header + 16 &&
      UUID_BYTES.every((b, i) => head[header + i] === b)
    ) {
      const payload = await bytesOf(file, at + header + 16, at + size);
      return {
        kind: "found",
        track: PointerTrackSchema.parse(
          JSON.parse(new TextDecoder().decode(payload)),
        ),
      };
    }
    at += size;
  }
  return { kind: "absent" };
}

async function bytesOf(
  file: Blob,
  start: number,
  end: number,
): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}
