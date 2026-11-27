/**
 * The declaration's forbidden combinations, as type errors.
 *
 * Each `@ts-expect-error` fails `./equin check type-check` the day its
 * combination becomes spellable. The declarations live in a function that is
 * never called, so nothing is defined at runtime.
 */
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { LogChannel } from "@plugins/primitives/plugins/log-channels/server";
import { defineSupervisedJob } from "./define-supervised-job";

const description = "Test job.";
const channel = { publishAll: () => {} } as unknown as LogChannel;
const input = z.object({ target: z.string().default("t") });
const argv = () => ({ argv: ["true"] });
const run = () => Promise.resolve();
const steps = () => Promise.resolve();
const acrossSwitch = { finish: "test work stays valid on any commit" };
const ledger = {
  kindId: "typetest",
  claim: () => Promise.resolve("r"),
  listUnfinished: () => Promise.resolve([]),
  setPid: () => Promise.resolve(),
  closeRow: () => Promise.resolve(),
};

describe("DefineSupervisedJobSpec", () => {
  test("forbids the combinations the design rules out", () => {
    const typeOnly = () => {
      // Allowed shapes, for contrast.
      defineSupervisedJob({
        name: "a.ok1",
        description,
        input,
        channel,
        acrossSwitch,
        argv,
      });
      defineSupervisedJob({
        name: "a.ok2",
        description,
        input,
        channel,
        acrossSwitch,
        run,
        lock: (i) => i.target,
      });
      defineSupervisedJob({
        name: "a.ok3",
        description,
        input,
        channel,
        acrossSwitch,
        run,
        ledger,
        runAttempts: 2,
      });
      defineSupervisedJob({
        name: "a.ok4",
        description,
        input,
        channel,
        acrossSwitch,
        steps,
        ledger,
        hold: "seconds",
      });
      defineSupervisedJob({
        name: "a.ok5",
        description,
        input,
        channel,
        acrossSwitch,
        run,
        schedule: { cron: "0 * * * *" },
      });
      defineSupervisedJob({
        name: "a.ok6",
        description,
        input,
        channel,
        acrossSwitch,
        run,
        lock: (i) => i.target,
        admission: "worktree-prepare",
      });

      // @ts-expect-error — two bodies
      defineSupervisedJob({
        name: "a.e1",
        description,
        input,
        channel,
        acrossSwitch,
        argv,
        run,
      });
      // @ts-expect-error — `run` and `steps`
      defineSupervisedJob({
        name: "a.e2",
        description,
        input,
        channel,
        acrossSwitch,
        run,
        steps,
        ledger,
      });
      // @ts-expect-error — no body at all
      defineSupervisedJob({
        name: "a.e3",
        description,
        input,
        channel,
        acrossSwitch,
      });
      // @ts-expect-error — `lock` with an own ledger
      defineSupervisedJob({
        name: "a.e4",
        description,
        input,
        channel,
        acrossSwitch,
        argv,
        ledger,
        lock: () => "k",
      });
      // @ts-expect-error — `steps` without a ledger
      defineSupervisedJob({
        name: "a.e5",
        description,
        input,
        channel,
        acrossSwitch,
        steps,
      });
      // @ts-expect-error — `runAttempts` with `steps`
      defineSupervisedJob({
        name: "a.e6",
        description,
        input,
        channel,
        acrossSwitch,
        steps,
        ledger,
        runAttempts: 2,
      });
      // `minutes` on `steps` (the error lands on the property)
      defineSupervisedJob({
        name: "a.e7",
        description,
        input,
        channel,
        acrossSwitch,
        steps,
        ledger,
        // @ts-expect-error — `minutes` on `steps`
        hold: "minutes",
      });
      // any `hold` on a single-child body (the error lands on the property)
      defineSupervisedJob({
        name: "a.e8",
        description,
        input,
        channel,
        acrossSwitch,
        run,
        // @ts-expect-error — any `hold` on a single-child body
        hold: "instant",
      });
      // `minutes` on a single-child body (the error lands on the property)
      defineSupervisedJob({
        name: "a.e9",
        description,
        input,
        channel,
        acrossSwitch,
        argv,
        // @ts-expect-error — `minutes` on a single-child body
        hold: "minutes",
      });
      // @ts-expect-error — `channel` is required
      defineSupervisedJob({
        name: "a.e10",
        description,
        input,
        acrossSwitch,
        argv,
      });
      // `admission` on an argv body (the error lands on the property)
      defineSupervisedJob({
        name: "a.e11",
        description,
        input,
        channel,
        acrossSwitch,
        argv,
        // @ts-expect-error — `admission` on an argv body (not our child to admit)
        admission: "worktree-prepare",
      });
      defineSupervisedJob({
        name: "a.e12",
        description,
        input,
        channel,
        acrossSwitch,
        run,
        // @ts-expect-error — `admission` names a declared host pool
        admission: "no-such-pool",
      });
      // @ts-expect-error — `acrossSwitch` is required
      defineSupervisedJob({ name: "a.e13", description, input, channel, argv });
      defineSupervisedJob({
        name: "a.e14",
        description,
        input,
        channel,
        argv,
        ledger,
        // @ts-expect-error — `cancel` with an own ledger (its runs finish)
        acrossSwitch: { cancel: "x" },
      });
      defineSupervisedJob({
        name: "a.e15",
        description,
        input,
        channel,
        steps,
        ledger,
        // @ts-expect-error — `cancel` on `steps` (a sequence's runs finish)
        acrossSwitch: { cancel: "x" },
      });
      defineSupervisedJob({
        name: "a.e16",
        description,
        input,
        channel,
        argv,
        // @ts-expect-error — `finish` and `cancel` at once
        acrossSwitch: { finish: "x", cancel: "y" },
      });
      // `cancel` with the built-in ledger, for contrast
      defineSupervisedJob({
        name: "a.ok7",
        description,
        input,
        channel,
        argv,
        acrossSwitch: { cancel: "its own boot hook asks again" },
      });
    };
    expect(typeof typeOnly).toBe("function");
  });
});
