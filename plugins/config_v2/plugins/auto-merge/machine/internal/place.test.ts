import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  buildMergeRecord,
  type ConfigDescriptor,
  type ConfigMergeRecord,
} from "@plugins/config_v2/core";
import type {
  AutoMergeState,
  PlacementSettlement,
} from "@plugins/config_v2/server";
import {
  ClaudeCliError,
  ClaudeUsageLimitError,
} from "@plugins/infra/plugins/claude-cli/server";
import { placeAutoMerge, type PlacementDeps } from "./place";

// The job's own decisions with the model stubbed: what it asks, when it asks
// nothing, and what it hands the registry. What the registry then writes (a
// permutation only, never over an edit) is `registry.test.ts`'s.

const LIST = {
  path: ["items"],
  order: ["s:c", "s:a", "s:b", "s:n"],
  movable: ["s:n"],
};

function record(): ConfigMergeRecord {
  return buildMergeRecord({
    id: "rec-1",
    now: new Date(0),
    fromHash: "a",
    toHash: "b",
    base: { items: ["a", "b", "c"] },
    yours: { items: ["c", "a", "b"] },
    theirs: { items: ["a", "b", "n", "c"] },
    result: { items: ["c", "a", "b", "n"] },
    decisions: [],
    placements: [LIST],
    undo: {
      override: { content: { items: ["c", "a", "b"] }, hash: "a" },
      ancestor: { content: { items: ["a", "b", "c"] }, hash: "a" },
    },
  });
}

const descriptor = {
  fields: { items: { meta: { label: "Items", description: "What shows" } } },
  schema: z.object({}),
} as unknown as ConfigDescriptor;

function harness(
  ask: PlacementDeps["ask"],
  opts: {
    state?: Partial<AutoMergeState>;
    ready?: boolean;
  } = {},
) {
  const settled: PlacementSettlement[] = [];
  const prompts: string[] = [];
  const deps: PlacementDeps = {
    read: () =>
      Promise.resolve({
        record: record(),
        status: "current",
        editedFields: [],
        ...opts.state,
      }),
    settle: (_path, _id, settlement) => {
      settled.push(settlement);
      return Promise.resolve(null);
    },
    descriptor: () => descriptor,
    readiness: () =>
      Promise.resolve(
        opts.ready === false
          ? { kind: "blocked", block: { kind: "signed-out", version: "2" } }
          : { kind: "ready" },
      ),
    ask: (input) => {
      prompts.push(input.prompt);
      return ask(input);
    },
  };
  return { deps, settled, prompts };
}

const target = { storePath: "p/delta.jsonc", recordId: "rec-1" };

describe("the placement job, model stubbed", () => {
  test("a valid answer is handed to the registry, per list", async () => {
    const h = harness(() => Promise.resolve('[["s:c","s:n","s:a","s:b"]]'));
    await placeAutoMerge(target, h.deps);
    expect(h.settled).toEqual([
      {
        kind: "answered",
        model: "sonnet",
        answers: [["s:c", "s:n", "s:a", "s:b"]],
      },
    ]);
    // The prompt names the field and which keys may move.
    expect(h.prompts[0]).toContain("items (Items — What shows)");
    expect(h.prompts[0]).toContain('New keys you may move: ["s:n"]');
  });

  test("a non-permutation answer is handed over as is: the registry refuses it", async () => {
    const h = harness(() => Promise.resolve('[["s:n","s:x"]]'));
    await placeAutoMerge(target, h.deps);
    expect(h.settled).toEqual([
      { kind: "answered", model: "sonnet", answers: [["s:n", "s:x"]] },
    ]);
  });

  test("prose is every list's (refused) answer", async () => {
    const h = harness(() => Promise.resolve("Put n first."));
    await placeAutoMerge(target, h.deps);
    expect(h.settled).toEqual([
      { kind: "answered", model: "sonnet", answers: ["Put n first."] },
    ]);
  });

  test("a usage limit skips quietly", async () => {
    const h = harness(() =>
      Promise.reject(new ClaudeUsageLimitError("limit", "system")),
    );
    await placeAutoMerge(target, h.deps);
    expect(h.settled).toEqual([{ kind: "skipped", reason: "usage-limit" }]);
  });

  test("a failed call skips with its words", async () => {
    const h = harness(() => Promise.reject(new ClaudeCliError("timed out")));
    await placeAutoMerge(target, h.deps);
    expect(h.settled).toEqual([
      { kind: "skipped", reason: "failed", detail: "timed out" },
    ]);
  });

  test("any other error is thrown", async () => {
    const h = harness(() => Promise.reject(new TypeError("bug")));
    expect(placeAutoMerge(target, h.deps)).rejects.toThrow("bug");
  });

  test("no Claude account that can run: nothing is asked", async () => {
    const h = harness(() => Promise.reject(new Error("never called")), {
      ready: false,
    });
    await placeAutoMerge(target, h.deps);
    expect(h.prompts).toEqual([]);
    expect(h.settled).toEqual([
      { kind: "skipped", reason: "no-claude-account", detail: "signed-out" },
    ]);
  });

  test("an undone merge or a field edited since asks nothing", async () => {
    const undone = harness(() => Promise.reject(new Error("never")), {
      state: { status: "undone" },
    });
    await placeAutoMerge(target, undone.deps);
    expect(undone.settled).toEqual([{ kind: "skipped", reason: "undone" }]);

    const edited = harness(() => Promise.reject(new Error("never")), {
      state: { status: "edited", editedFields: ["items"] },
    });
    await placeAutoMerge(target, edited.deps);
    expect(edited.settled).toEqual([{ kind: "skipped", reason: "edited" }]);
  });

  test("a replaced or settled record is left alone", async () => {
    const replaced = harness(() => Promise.reject(new Error("never")));
    expect(
      await placeAutoMerge({ ...target, recordId: "other" }, replaced.deps),
    ).toBeNull();
    const settledRecord = harness(() => Promise.reject(new Error("never")), {
      state: { record: { ...record(), placement: { status: "not-needed" } } },
    });
    await placeAutoMerge(target, settledRecord.deps);
    expect(settledRecord.settled).toEqual([]);
  });
});
