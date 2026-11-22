import { expect, test } from "bun:test";
import type { JobRowOpts, QueuedJob } from "./queue";
import type { JobTaskPayload } from "./registry";
import { createOwnRunGate, type GatedJob } from "./own-run-gate";

const scheduled: GatedJob = {
  name: "test.scheduled",
  hold: "instant",
  schedule: { cron: "* * * * *" },
  maxAttempts: 3,
};
const unscheduled: GatedJob = {
  name: "test.unscheduled",
  hold: "instant",
  maxAttempts: 3,
};
const tick = (n: number): JobTaskPayload => ({
  jobName: scheduled.name,
  input: { n },
});

/** Bounds armed by the gate, fired by hand. */
function fakeBounds() {
  const armed: { ms: number; fire: () => void; cancelled: boolean }[] = [];
  const armBound = (ms: number, fire: () => void) => {
    const bound = { ms, fire, cancelled: false };
    armed.push(bound);
    return () => {
      bound.cancelled = true;
    };
  };
  return { armed, armBound };
}

function harness(bounds = fakeBounds()) {
  const requeued: {
    job: QueuedJob;
    payload: JobTaskPayload;
    opts: JobRowOpts;
  }[] = [];
  const gate = createOwnRunGate(
    async (job, payload, opts) => {
      requeued.push({ job, payload, opts });
    },
    { armBound: bounds.armBound },
  );
  return { gate, requeued, armed: bounds.armed };
}

test("a scheduled job's second row folds while its first runs", async () => {
  const { gate } = harness();
  const first = gate.enter(scheduled, tick(1));
  expect(first.kind).toBe("run");
  expect(gate.enter(scheduled, tick(2)).kind).toBe("folded");
  expect(gate.live()).toEqual([scheduled.name]);
  if (first.kind === "run") await first.release("threw");
});

test("a run nothing folded into ends with no trailing run", async () => {
  const { gate, requeued } = harness();
  const entry = gate.enter(scheduled, tick(1));
  if (entry.kind !== "run") throw new Error("expected a run");
  await entry.release("settled");
  expect(requeued).toEqual([]);
  expect(gate.live()).toEqual([]);
  expect(gate.enter(scheduled, tick(2)).kind).toBe("run");
});

test("every fold collapses into ONE trailing singleton run, the newest payload", async () => {
  const { gate, requeued } = harness();
  const entry = gate.enter(scheduled, tick(1));
  if (entry.kind !== "run") throw new Error("expected a run");
  gate.enter(scheduled, tick(2));
  gate.enter(scheduled, tick(3));
  await entry.release("settled");
  expect(requeued).toEqual([
    {
      job: scheduled,
      payload: tick(3),
      opts: { jobKey: "test.scheduled:_", maxAttempts: 3 },
    },
  ]);
});

test("a run that threw requeues nothing: its retry is the later run", async () => {
  const { gate, requeued } = harness();
  const entry = gate.enter(scheduled, tick(1));
  if (entry.kind !== "run") throw new Error("expected a run");
  gate.enter(scheduled, tick(2));
  await entry.release("threw");
  expect(requeued).toEqual([]);
  expect(gate.live()).toEqual([]);
});

test("a run that never settles lets go at a zombie's age, once", async () => {
  const { gate, requeued, armed } = harness();
  const first = gate.enter(scheduled, tick(1));
  if (first.kind !== "run") throw new Error("expected a run");
  // The instant class's deadline plus the unwind grace.
  expect(armed.map((b) => b.ms)).toEqual([90_000]);
  gate.enter(scheduled, tick(2));
  armed[0]!.fire();
  await Promise.resolve();
  expect(gate.live()).toEqual([]);
  // The folded tick's trailing run is queued, to run beside the zombie.
  expect(requeued.map((r) => r.payload)).toEqual([tick(2)]);
  const second = gate.enter(scheduled, tick(3));
  expect(second.kind).toBe("run");
  // The zombie finally settles: its release no longer touches the new claim.
  await first.release("settled");
  expect(requeued).toHaveLength(1);
  expect(gate.live()).toEqual([scheduled.name]);
  expect(gate.enter(scheduled, tick(4)).kind).toBe("folded");
});

test("a run that settles in time cancels its bound", async () => {
  const { gate, armed } = harness();
  const entry = gate.enter(scheduled, tick(1));
  if (entry.kind !== "run") throw new Error("expected a run");
  await entry.release("settled");
  expect(armed[0]!.cancelled).toBe(true);
});

test("an unscheduled job and a resume row are never gated", async () => {
  const { gate } = harness();
  const plain: JobTaskPayload = { jobName: unscheduled.name, input: {} };
  expect(gate.enter(unscheduled, plain).kind).toBe("run");
  expect(gate.enter(unscheduled, plain).kind).toBe("run");

  const first = gate.enter(scheduled, tick(1));
  expect(first.kind).toBe("run");
  const resume: JobTaskPayload = {
    ...tick(0),
    workflowRunId: "test.scheduled:job:42",
  };
  expect(gate.enter(scheduled, resume).kind).toBe("run");
  expect(gate.live()).toEqual([scheduled.name]);
  if (first.kind === "run") await first.release("threw");
});

test("one job's live run does not hold another's", () => {
  const { gate } = harness();
  const other: GatedJob = { ...scheduled, name: "test.other" };
  expect(gate.enter(scheduled, tick(1)).kind).toBe("run");
  expect(gate.enter(other, { jobName: other.name, input: {} }).kind).toBe(
    "run",
  );
});

test("a failed trailing enqueue rejects the release, loud", () => {
  const gate = createOwnRunGate(async () => {
    throw new Error("queue down");
  });
  const entry = gate.enter(scheduled, tick(1));
  if (entry.kind !== "run") throw new Error("expected a run");
  gate.enter(scheduled, tick(2));
  expect(entry.release("settled")).rejects.toThrow("queue down");
});
