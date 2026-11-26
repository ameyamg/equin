import { describe, expect, test } from "bun:test";
import { createBootTally } from "./boot-tally";
import type { EventsRead } from "./event-reader";

const read = (bytes: number, events: number, whole: boolean): EventsRead => ({
  events: Array.from(
    { length: events },
    () => ({}) as EventsRead["events"][number],
  ),
  position: null,
  bytes,
  whole,
});

describe("createBootTally", () => {
  test("names the slowest follow, the slowest and biggest catch-up, and paid whole reads", () => {
    const t = createBootTally();
    t.opened("a", 2);
    t.opened("b", 30);
    t.read("a", read(2048, 3, false));
    t.read("b", read(10_240, 5, true));
    t.read("c", read(0, 0, true)); // nothing on disk: not a re-read
    t.caughtUp("a", 40);
    t.caughtUp("b", 12);
    t.caughtUp("c", 1);
    t.current("d");
    expect(t.summary()).toBe(
      "follows opened: 2, 32 ms summed (slowest b 30 ms); already current: 1; agents caught up: 3, 53 ms summed (queueing included), slowest a 40 ms; read 12 KB, 8 events (most b 10 KB); whole-file re-reads: b",
    );
  });

  test("an empty boot says so", () => {
    expect(createBootTally().summary()).toBe(
      "follows opened: 0, 0 ms summed; already current: 0; agents caught up: 0, 0 ms summed (queueing included); read 0 KB, 0 events; whole-file re-reads: none",
    );
  });
});
