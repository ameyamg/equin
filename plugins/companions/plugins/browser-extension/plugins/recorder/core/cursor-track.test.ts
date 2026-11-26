import { describe, expect, test } from "bun:test";
import type { PointerTrack } from "@plugins/companions/plugins/browser-extension/core";
import { cursorTrackBox, readCursorTrack } from "./cursor-track";

const track: PointerTrack = {
  version: 1,
  viewport: { width: 1280, height: 720 },
  samples: [
    [0, 10, 20, "move"],
    [16, 12, 22, "down"],
    [80, 12, 22, "up"],
    [1500, 400, 300, "move"],
  ],
};

/** A plain box: size, type, payload. */
function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(payload, 8);
  return out;
}

function file(...parts: Uint8Array[]): Blob {
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  return new Blob([bytes]);
}

const ftyp = box("ftyp", new TextEncoder().encode("isom\0\0\0\x01isomavc1"));
const moov = box("moov", new Uint8Array(40));
const mdat = box("mdat", new Uint8Array(1000).fill(7));

describe("the pointer track inside an MP4", () => {
  test("reads back what was appended after the movie", async () => {
    expect(
      await readCursorTrack(file(ftyp, moov, mdat, cursorTrackBox(track))),
    ).toEqual({ kind: "found", track });
  });

  test("a video without one says so", async () => {
    expect(await readCursorTrack(file(ftyp, moov, mdat))).toEqual({
      kind: "absent",
    });
  });

  test("another uuid box is skipped", async () => {
    const other = box("uuid", new Uint8Array(30).fill(1));
    expect(
      await readCursorTrack(file(ftyp, other, mdat, cursorTrackBox(track))),
    ).toEqual({ kind: "found", track });
  });

  test("walks a 64-bit box size", async () => {
    const big = new Uint8Array(16 + 100);
    const view = new DataView(big.buffer);
    view.setUint32(0, 1);
    big.set(new TextEncoder().encode("mdat"), 4);
    view.setBigUint64(8, BigInt(big.length));
    expect(
      await readCursorTrack(file(ftyp, big, cursorTrackBox(track))),
    ).toEqual({ kind: "found", track });
  });

  test("a box past the file's end is refused, not read as no track", async () => {
    const cut = mdat.subarray(0, 500);
    expect(readCursorTrack(file(ftyp, cut))).rejects.toThrow(/claims 1008/);
  });

  test("a track that does not parse is refused", async () => {
    const bad = cursorTrackBox(track);
    bad[bad.length - 2] = 0x21; // the JSON's last character but one
    expect(readCursorTrack(file(ftyp, bad))).rejects.toThrow();
  });
});
