import { afterEach, describe, expect, test } from "bun:test";
import { RecoveryTracker, type LiveRecoveryEvent } from "./recovery-tracker";

const realNow = Date.now;
afterEach(() => {
  Date.now = realNow;
});

function tracked(): { t: RecoveryTracker; events: LiveRecoveryEvent[] } {
  const t = new RecoveryTracker();
  const events: LiveRecoveryEvent[] = [];
  t.subscribe((e) => events.push(e));
  return { t, events };
}

const entries = [
  { sub: "a\0", key: "a", id: 1 },
  { sub: "b\0x", key: "b", id: 2 },
  { sub: "b\0y", key: "b", id: 3 },
];

describe("RecoveryTracker", () => {
  test("a drop, its replay and every replayed answer make one recovery", () => {
    const { t, events } = tracked();
    t.noteDrop("worktree");
    expect(t.getRecoveries()).toMatchObject([
      { socket: "worktree", phase: "reconnecting", replayed: 0 },
    ]);
    t.noteReplay("worktree", entries);
    expect(t.getRecoveries()).toMatchObject([
      { phase: "replaying", replayed: 3 },
    ]);
    expect(t.pendingKeys("worktree", 8)).toEqual(["b×2", "a"]);
    t.noteAnswered("worktree", "a\0", 1);
    t.noteAnswered("worktree", "b\0x", 2);
    expect(t.getRecoveries()).toHaveLength(1);
    t.noteAnswered("worktree", "b\0y", 3);
    expect(t.getRecoveries()).toEqual([]);
    expect(events.map((e) => e.kind)).toEqual(["start", "replaying", "end"]);
    const end = events[2]!;
    if (end.kind !== "end") throw new Error("not an end");
    expect(end.end).toMatchObject({
      socket: "worktree",
      replayed: 3,
      reopens: 0,
      sleptMs: 0,
    });
  });

  test("an answer to an older request does not count; the resent one does", () => {
    const { t } = tracked();
    t.noteDrop("worktree");
    t.noteReplay("worktree", [entries[0]!]);
    t.noteResent("worktree", "a\0", 9);
    t.noteAnswered("worktree", "a\0", 1);
    expect(t.getRecoveries()).toHaveLength(1);
    t.noteAnswered("worktree", "a\0", 9);
    expect(t.getRecoveries()).toEqual([]);
  });

  test("a released read is no longer waited for", () => {
    const { t, events } = tracked();
    t.noteDrop("central");
    t.noteReplay("central", [entries[0]!]);
    t.noteReleased("central", "a\0");
    expect(events.at(-1)?.kind).toBe("end");
  });

  test("a replay outside a recovery is not one; an empty replay ends it at once", () => {
    const { t, events } = tracked();
    t.noteReplay("worktree", entries);
    expect(events).toEqual([]);
    t.noteDrop("worktree");
    t.noteReplay("worktree", []);
    expect(events.map((e) => e.kind)).toEqual(["start", "replaying", "end"]);
  });

  test("a second drop mid-replay keeps the first drop and waits for the next replay", () => {
    const { t, events } = tracked();
    t.noteDrop("worktree");
    const droppedAt = t.getRecoveries()[0]!.droppedAt;
    t.noteReplay("worktree", entries);
    t.noteDrop("worktree");
    expect(t.getRecoveries()).toMatchObject([
      { phase: "reconnecting", droppedAt },
    ]);
    // Told, so a reader of the phase (the Connection row, the ledger) moves too.
    expect(events.at(-1)?.kind).toBe("reconnecting");
    // The old socket's answers are not this replay's.
    t.noteAnswered("worktree", "a\0", 1);
    t.noteReplay("worktree", [{ sub: "a\0", key: "a", id: 7 }]);
    t.noteAnswered("worktree", "a\0", 7);
    const end = events.at(-1)!;
    if (end.kind !== "end") throw new Error("not an end");
    expect(end.end).toMatchObject({ droppedAt, reopens: 1, replayed: 1 });
  });

  test("a sleep since the last frame heard before the drop is measured", () => {
    const { t, events } = tracked();
    let wall = realNow();
    Date.now = () => wall;
    t.noteHeard("worktree");
    // The machine sleeps 30 s: the wall clock moves, the performance clock does not.
    wall += 30_000;
    t.noteDrop("worktree");
    expect(t.sleptSinceDrop("worktree")).toBeGreaterThanOrEqual(29_000);
    t.noteReplay("worktree", []);
    const end = events.at(-1)!;
    if (end.kind !== "end") throw new Error("not an end");
    expect(end.end.sleptMs).toBeGreaterThanOrEqual(29_000);
    expect(end.end.awakeMs).toBeLessThan(5_000);
  });

  test("the snapshot keeps its identity until something moves", () => {
    const { t } = tracked();
    t.noteDrop("worktree");
    const a = t.getRecoveries();
    t.noteResent("worktree", "zzz", 1);
    t.noteAnswered("worktree", "zzz", 1);
    expect(t.getRecoveries()).toBe(a);
  });

  test("a read given up on ends the wait, counted as unanswered", () => {
    const { t, events } = tracked();
    t.noteDrop("worktree");
    t.noteReplay("worktree", [entries[0]!, entries[1]!]);
    t.noteAnswered("worktree", "a\0", 1);
    t.noteAbandoned("worktree", "b\0x");
    const end = events.at(-1)!;
    if (end.kind !== "end") throw new Error("not an end");
    expect(end.end).toMatchObject({ replayed: 2, unanswered: 1 });
  });
});
