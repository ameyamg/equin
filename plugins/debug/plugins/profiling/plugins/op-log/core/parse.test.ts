import { describe, expect, test } from "bun:test";
import { foldOpLines } from "./internal/fold";
import { parseOpLine, parseOpLines } from "./internal/parse";

// The real lines that crashed every reader on 2026-11-23 (report-1795395698-
// luccqp): an unpushed checkout wrote a v2 `progress` event — a kind no reader
// knew — into the shared op log, and `applyV2Change` returned undefined for it.
const SLEEP = {
  boot: "B25F1FC6-798F-412D-B0DA-B41350248582",
  asleepMs: 814189888,
  wakeAtMs: 1795387968452,
};
const OP = "93056763-23e6-4742-9b8b-25987f469c45";
const requested = {
  v: 2,
  opId: OP,
  seq: 1,
  at: "2026-11-23T01:01:23.620Z",
  t: 0,
  sleep: SLEEP,
  e: "requested",
  pid: 4242,
  kind: "build",
  opSlug: "att-x",
  branch: "claude-web/att-x",
  conversationId: null,
  lane: null,
  mode: "worktree",
  buildId: null,
};
const progress = {
  v: 2,
  opId: OP,
  seq: 4,
  at: "2026-11-23T01:01:38.417Z",
  t: 14797,
  sleep: SLEEP,
  e: "progress",
};
const granted = {
  v: 2,
  opId: OP,
  seq: 5,
  at: "2026-11-23T01:01:40.000Z",
  t: 16380,
  sleep: SLEEP,
  e: "granted",
};

describe("parseOpLine", () => {
  test("an event kind newer than the reader is skipped, naming the kind", () => {
    expect(parseOpLine(progress)).toEqual({
      kind: "skipped",
      reason: "unknown-kind",
      detail: "progress",
    });
  });

  test("a known event and a legacy snapshot are lines", () => {
    expect(parseOpLine(requested).kind).toBe("line");
    expect(parseOpLine({ phase: "granted", opId: OP }).kind).toBe("line");
    expect(parseOpLine({ phase: "paused", opId: OP })).toEqual({
      kind: "skipped",
      reason: "unknown-kind",
      detail: "paused",
    });
  });

  test("a value with no opId is not an op line", () => {
    expect(parseOpLine({ e: "granted" }).kind).toBe("skipped");
    expect(parseOpLine(null).kind).toBe("skipped");
    expect(parseOpLine("x").kind).toBe("skipped");
  });

  test("the crashing stream folds, the unknown line counted", () => {
    const { lines, skipped } = parseOpLines([requested, progress, granted]);
    expect(skipped).toEqual(new Map([["unknown-kind:progress", 1]]));
    const state = foldOpLines(lines).get(OP);
    expect(state?.grantedAt).toBe(granted.at);
    expect(state?.lastSeq).toBe(5);
  });
});
