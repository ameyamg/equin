import { describe, expect, test } from "bun:test";
import { AttachmentTooLargeError, pipeBounded } from "./blobs";

function streamOf(chunks: number[]): {
  stream: ReadableStream<Uint8Array>;
  cancelled: () => boolean;
} {
  let cancelled = false;
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < chunks.length) c.enqueue(new Uint8Array(chunks[i++]!));
      else c.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, cancelled: () => cancelled };
}

describe("pipeBounded", () => {
  test("hands every chunk to the sink and answers the byte count", async () => {
    const seen: number[] = [];
    const { stream } = streamOf([3, 4, 5]);
    const size = await pipeBounded(stream, 12, (c) => {
      seen.push(c.byteLength);
    });
    expect(size).toBe(12);
    expect(seen).toEqual([3, 4, 5]);
  });

  test("past the bound: throws, cancels the stream, never sinks the chunk that crossed it", async () => {
    const seen: number[] = [];
    const { stream, cancelled } = streamOf([5, 5, 5]);
    const outcome = await pipeBounded(stream, 9, (c) => {
      seen.push(c.byteLength);
    }).then(
      () => "resolved",
      (err: unknown) => err,
    );
    expect(outcome).toBeInstanceOf(AttachmentTooLargeError);
    expect(seen).toEqual([5]);
    expect(cancelled()).toBe(true);
  });
});
