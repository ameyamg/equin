import {
  asAppPath,
  type AppPath,
} from "@plugins/infra/plugins/host-fs/plugins/user-path/core";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  eventsMayHaveLinesPast,
  mayHaveLinesPast,
  readAgentEvents,
  readEventsAfter,
} from "./event-reader";

let dir: string;
let path: AppPath;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sdk-events-"));
  path = asAppPath(join(dir, "events.jsonl"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const line = (seq: number) =>
  JSON.stringify({ seq, t: seq, kind: "sdk", payload: { type: "x" } }) + "\n";
const append = (file: string, ...seqs: number[]) =>
  appendFileSync(file, seqs.map(line).join(""));
/** What the sink does at its cap: shift every generation up by one. */
function rotate() {
  for (const n of [2, 1]) {
    try {
      renameSync(`${path}.${n}`, `${path}.${n + 1}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  renameSync(path, `${path}.1`);
}
const seqs = (r: Awaited<ReturnType<typeof readAgentEvents>>) =>
  r.events.map((e) => e.seq);

describe("readAgentEvents", () => {
  test("no file yet: nothing, and no position", async () => {
    expect(await readAgentEvents(path, null)).toEqual({
      events: [],
      position: null,
      bytes: 0,
      whole: true,
    });
  });

  test("reads on from where it stopped", async () => {
    append(path, 1, 2);
    const first = await readAgentEvents(path, null);
    expect(seqs(first)).toEqual([1, 2]);
    append(path, 3);
    expect(seqs(await readAgentEvents(path, first.position))).toEqual([3]);
  });

  test("leaves a line still being written for the next read", async () => {
    append(path, 1);
    appendFileSync(path, '{"seq":2,"t":2,"ki');
    const first = await readAgentEvents(path, null);
    expect(seqs(first)).toEqual([1]);
    appendFileSync(path, 'nd":"sdk","payload":{}}\n');
    expect(seqs(await readAgentEvents(path, first.position))).toEqual([2]);
  });

  test("follows a rotation: the rest of the old file, then the new one", async () => {
    append(path, 1, 2);
    const first = await readAgentEvents(path, null);
    append(path, 3);
    rotate();
    append(path, 4);
    expect(seqs(await readAgentEvents(path, first.position))).toEqual([3, 4]);
  });

  test("a fresh reader reads every generation oldest first", async () => {
    append(path, 1);
    rotate();
    append(path, 2);
    rotate();
    append(path, 3);
    expect(seqs(await readAgentEvents(path, null))).toEqual([1, 2, 3]);
  });

  test("a position rotated past every kept generation rereads what is left", async () => {
    append(path, 1);
    const first = await readAgentEvents(path, null);
    for (const s of [2, 3, 4, 5]) {
      rotate();
      append(path, s);
    }
    // Generation 1 (its inode) is gone: the reducer's cursor skips the
    // re-read lines and reports the jump.
    expect(seqs(await readAgentEvents(path, first.position))).toEqual([
      2, 3, 4, 5,
    ]);
  });

  test("an unreadable line throws, naming the file", async () => {
    writeFileSync(path, "not json\n");
    expect(readAgentEvents(path, null)).rejects.toThrow(/events\.jsonl/);
  });
});

describe("readEventsAfter", () => {
  test("a stored position reads on from the line after its cursor", async () => {
    append(path, 1, 2);
    const stored = (await readAgentEvents(path, null)).position;
    append(path, 3, 4);
    const read = await readEventsAfter(path, 2, stored);
    expect(seqs(read)).toEqual([3, 4]);
    expect(read.whole).toBe(false);
    expect(read.bytes).toBe(statSync(path).size - stored!.offset);
  });

  test("nothing appended since: nothing to read", async () => {
    append(path, 1, 2);
    const stored = (await readAgentEvents(path, null)).position;
    expect(seqs(await readEventsAfter(path, 2, stored))).toEqual([]);
  });

  test("a position into other bytes (its first line is past the cursor): the whole family", async () => {
    append(path, 1, 2, 3);
    const end = (await readAgentEvents(path, null)).position!;
    append(path, 4);
    // The cursor only reached 1, yet the position says 3: it is not this cursor's.
    const read = await readEventsAfter(path, 1, end);
    expect(seqs(read)).toEqual([1, 2, 3, 4]);
    // The whole family, on top of the read from the position that told.
    expect(read.whole).toBe(true);
    expect(read.bytes).toBe(
      statSync(path).size + (statSync(path).size - end.offset),
    );
  });

  test("a position past the end of the file that has its inode: the whole family", async () => {
    append(path, 1);
    const ino = statSync(path).ino;
    // Same inode, rewritten shorter than the stored offset (an inode reused).
    expect(
      seqs(await readEventsAfter(path, 0, { ino, offset: 10_000 })),
    ).toEqual([1]);
  });

  test("a position rotated past every kept generation reads what is left once", async () => {
    append(path, 1);
    const stored = (await readAgentEvents(path, null)).position;
    for (const seq of [2, 3, 4]) {
      rotate();
      append(path, seq);
    }
    expect(seqs(await readEventsAfter(path, 1, stored))).toEqual([2, 3, 4]);
  });
});

describe("mayHaveLinesPast", () => {
  const at = { ino: 7, offset: 100 };
  test("no only at the very end of the same file", () => {
    expect(mayHaveLinesPast(at, { ino: 7, size: 100 })).toBe(false);
    expect(mayHaveLinesPast(at, { ino: 7, size: 120 })).toBe(true); // appended
    expect(mayHaveLinesPast(at, { ino: 7, size: 40 })).toBe(true); // inode reused
    expect(mayHaveLinesPast(at, { ino: 8, size: 100 })).toBe(true); // rotated
    expect(mayHaveLinesPast(at, null)).toBe(true); // live file gone
    expect(mayHaveLinesPast(null, { ino: 7, size: 100 })).toBe(true);
  });

  test("agrees with a read from the position", async () => {
    append(path, 1, 2);
    const stored = (await readAgentEvents(path, null)).position;
    expect(await eventsMayHaveLinesPast(path, stored)).toBe(false);
    append(path, 3);
    expect(await eventsMayHaveLinesPast(path, stored)).toBe(true);
    expect(seqs(await readEventsAfter(path, 2, stored))).toEqual([3]);
  });
});
