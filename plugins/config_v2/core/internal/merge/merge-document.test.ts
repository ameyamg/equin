import { describe, expect, test } from "bun:test";
import { boolField } from "@plugins/fields/plugins/bool/plugins/config/core";
import { listField } from "@plugins/fields/plugins/list/plugins/config/core";
import { textField } from "@plugins/fields/plugins/text/plugins/config/core";
import { defineConfig } from "../define-config";
import type { JsonValue } from "../types";
import { objectField } from "@plugins/fields/plugins/object/plugins/config/core";
import { mergeConfigDocument, mergeConflictFields } from "./merge-document";
import { buildMergeRecord } from "./merge-record";
import { mergeReviewFields } from "./merge-review";

const descriptor = defineConfig({
  name: "merge-test",
  fields: {
    enabled: boolField({ label: "Enabled", default: false }),
    prompt: textField({ label: "Prompt", default: "p1" }),
    model: textField({ label: "Model", default: "opus" }),
    rows: listField({
      label: "Rows",
      itemFields: { label: textField({}), note: textField({}) },
    }),
  },
});

const merge = (base: JsonValue, yours: JsonValue, theirs: JsonValue) =>
  mergeConfigDocument({ descriptor, base, yours, theirs });

const BASE = { enabled: false, prompt: "p1", model: "opus", rows: [] };

describe("mergeConfigDocument", () => {
  test("a partial override is completed by its base: only its keys are the user's", () => {
    const result = merge(BASE, { enabled: true }, { ...BASE, prompt: "p2" });
    expect(result).toEqual({
      status: "merged",
      document: { enabled: true, prompt: "p2", model: "opus", rows: [] },
      decisions: [],
      placements: [],
    });
  });

  test("both sides changed the same scalar: the user's wins and is listed", () => {
    const result = merge(
      BASE,
      { ...BASE, model: "sonnet" },
      { ...BASE, model: "haiku" },
    );
    expect(result.status).toBe("merged");
    expect(result.document.model).toBe("sonnet");
    expect(result.decisions).toEqual([
      {
        kind: "yours-won",
        path: ["model"],
        base: "opus",
        yours: "sonnet",
        theirs: "haiku",
      },
    ]);
  });

  test("a row the user deleted stays deleted when the update leaves it", () => {
    const base = { ...BASE, rows: [{ label: "a" }, { label: "b" }] };
    const theirs = {
      ...base,
      rows: [{ label: "a" }, { label: "b" }, { label: "c" }],
    };
    const result = merge(base, { ...base, rows: [{ label: "b" }] }, theirs);
    expect(result.status).toBe("merged");
    expect(
      (result.document.rows as { label: string }[]).map((r) => r.label),
    ).toEqual(["b", "c"]);
  });

  test("a field the user changed that no longer exists is dropped and listed", () => {
    const base = { ...BASE, legacy: "x" };
    const result = merge(base, { ...base, legacy: "mine" }, BASE);
    expect(result.status).toBe("merged");
    expect(result.document).not.toHaveProperty("legacy");
    expect(result.decisions).toEqual([
      { kind: "removed-dropped", path: ["legacy"], yours: "mine" },
    ]);
  });

  test("a retired field the user changed is carried to its new key", () => {
    const renamed = defineConfig({
      name: "merge-rename",
      fields: {
        instructions: textField({ label: "Instructions", default: "p1" }),
        model: textField({ label: "Model", default: "opus" }),
      },
      retiredFields: {
        prompt: {
          renamedTo: "instructions",
          reason: "renamed to instructions",
        },
      },
    });
    const base = { prompt: "p1", model: "opus" };
    const result = mergeConfigDocument({
      descriptor: renamed,
      base,
      yours: { ...base, prompt: "mine" },
      theirs: { instructions: "p2", model: "sonnet" },
    });
    expect(result).toEqual({
      status: "merged",
      document: { instructions: "mine", model: "sonnet" },
      decisions: [
        {
          kind: "removed-renamed",
          path: ["prompt"],
          to: ["instructions"],
          yours: "mine",
        },
      ],
      placements: [],
    });
  });

  test("a retired field the user did not change goes with no decision", () => {
    const renamed = defineConfig({
      name: "merge-rename-untouched",
      fields: { instructions: textField({ label: "I", default: "p1" }) },
      retiredFields: { prompt: { renamedTo: "instructions", reason: "r" } },
    });
    const result = mergeConfigDocument({
      descriptor: renamed,
      base: { prompt: "p1" },
      yours: { prompt: "p1" },
      theirs: { instructions: "p2" },
    });
    expect(result).toEqual({
      status: "merged",
      document: { instructions: "p2" },
      decisions: [],
      placements: [],
    });
  });

  test("a retired list the user never touched is not their change, seeded row ids aside", () => {
    const renamed = defineConfig({
      name: "merge-rename-list",
      fields: {
        rows: listField({
          label: "Rows",
          itemFields: { label: textField({}) },
        }),
      },
      retiredFields: { items: { renamedTo: "rows", reason: "renamed" } },
    });
    const result = mergeConfigDocument({
      descriptor: renamed,
      base: { items: [{ label: "a" }] },
      // What setConfig saved: the same rows, with seeded ids.
      yours: { items: [{ id: "auto-000000000001", label: "a" }] },
      theirs: { rows: [{ label: "b" }] },
    });
    expect(result.status).toBe("merged");
    expect(result.decisions).toEqual([]);
    expect(
      (result.document.rows as { label: string }[]).map((r) => r.label),
    ).toEqual(["b"]);
  });

  test("a rename into an object field: the review's yours holds the carried value", () => {
    const nested = defineConfig({
      name: "merge-rename-nested",
      fields: {
        limits: objectField({
          subFields: {
            maxRuns: textField({ default: "3" }),
            other: textField({ default: "o" }),
          },
        }),
      },
      retiredFields: {
        "limits.max": { renamedTo: "limits.maxRuns", reason: "renamed" },
      },
    });
    const base = { limits: { max: "3", other: "o" } };
    const yours = { limits: { max: "9", other: "o" } };
    const theirs = { limits: { maxRuns: "3", other: "o2" } };
    const result = mergeConfigDocument({
      descriptor: nested,
      base,
      yours,
      theirs,
    });
    expect(result.status).toBe("merged");
    expect(result.document).toEqual({ limits: { maxRuns: "9", other: "o2" } });
    const record = buildMergeRecord({
      id: "r",
      now: new Date(0),
      fromHash: "a",
      toHash: "b",
      base,
      yours,
      theirs,
      result: result.document,
      decisions: result.decisions,
      placements: [],
      undo: {
        override: { content: yours, hash: "a" },
        ancestor: { content: base, hash: "a" },
      },
    });
    const [limits] = mergeReviewFields(record);
    expect(limits?.outcome).toBe("carried");
    expect(limits?.yours).toEqual({ maxRuns: "9", other: "o" });
  });

  test("a removed field declared retired is dropped with its reason", () => {
    const removed = defineConfig({
      name: "merge-removed",
      fields: { model: textField({ label: "Model", default: "opus" }) },
      retiredFields: { legacy: { reason: "the legacy mode is gone" } },
    });
    const base = { model: "opus", legacy: "x" };
    const result = mergeConfigDocument({
      descriptor: removed,
      base,
      yours: { ...base, legacy: "mine" },
      theirs: { model: "opus" },
    });
    expect(result.status).toBe("merged");
    expect(result.document).toEqual({ model: "opus" });
    expect(result.decisions).toEqual([
      {
        kind: "removed-dropped",
        path: ["legacy"],
        yours: "mine",
        reason: "the legacy mode is gone",
      },
    ]);
  });

  test("a merged document that fails the schema is a conflict with its issues", () => {
    const result = merge(
      BASE,
      { ...BASE, enabled: "yes" },
      { ...BASE, prompt: "p2" },
    );
    expect(result.status).toBe("conflict");
    expect(result.status === "conflict" && result.issues?.[0]?.path).toEqual([
      "enabled",
    ]);
    expect(mergeConflictFields(result)).toEqual(["enabled"]);
  });

  test("both sides changing a list whose rows have no key is a conflict", () => {
    const base = { ...BASE, rows: [{ note: "x" }] };
    const result = merge(
      base,
      { ...base, rows: [{ note: "x" }, { note: "mine" }] },
      { ...base, rows: [{ note: "theirs" }] },
    );
    expect(result.status).toBe("conflict");
    expect(result.status === "conflict" && result.reasons).toEqual([
      { kind: "unkeyed-list", path: ["rows"] },
    ]);
  });

  test("rows are paired by label", () => {
    const base = {
      ...BASE,
      rows: [
        { label: "a", note: "1" },
        { label: "b", note: "1" },
      ],
    };
    const result = merge(
      base,
      {
        ...base,
        rows: [
          { label: "a", note: "mine" },
          { label: "b", note: "1" },
        ],
      },
      {
        ...base,
        rows: [
          { label: "a", note: "1" },
          { label: "b", note: "new" },
        ],
      },
    );
    expect(result.status).toBe("merged");
    expect(
      (result.document.rows as { label: string; note: string }[]).map((r) => [
        r.label,
        r.note,
      ]),
    ).toEqual([
      ["a", "mine"],
      ["b", "new"],
    ]);
  });

  test("seeded auto- ids on the user's rows do not read as a delete plus an add", () => {
    const base = { ...BASE, rows: [{ note: "x" }] };
    const yours = {
      ...base,
      enabled: true,
      rows: [{ id: "auto-0123456789ab", note: "x" }],
    };
    const result = merge(base, yours, { ...base, prompt: "p2" });
    expect(result.status).toBe("merged");
    expect(result.document.prompt).toBe("p2");
    expect(
      (result.document.rows as { note: string }[]).map((r) => r.note),
    ).toEqual(["x"]);
  });

  test("an authored id that starts with auto- is a key, not a seeded id", () => {
    const base = { ...BASE, rows: [{ id: "auto-merged", note: "x" }] };
    const yours = {
      ...base,
      rows: [{ id: "auto-merged", note: "mine" }],
    };
    const result = merge(base, yours, { ...base, prompt: "p2" });
    expect(result.status).toBe("merged");
    expect(result.document.rows).toEqual([{ id: "auto-merged", note: "mine" }]);
  });

  test("an input that is not a document fails loudly", () => {
    expect(() => merge(BASE, [], BASE)).toThrow(
      /override document is not an object/,
    );
  });
});

describe("mergeConfigDocument inputs and conflict fields", () => {
  test("the caller's documents are left as they were", () => {
    const base = { ...BASE, legacy: "x" };
    const yours = { legacy: "mine" };
    merge(base, yours, BASE);
    expect(base).toEqual({ ...BASE, legacy: "x" });
    expect(yours).toEqual({ legacy: "mine" });
  });

  test("a conflict naming no field implicates every field", () => {
    expect(
      mergeConflictFields({
        status: "conflict",
        document: { a: 1, b: 2 },
        decisions: [],
        reasons: [],
        issues: [{ path: [], message: "whole document" }],
      }),
    ).toEqual(["a", "b"]);
  });
});

describe("deep merge order", () => {
  const reorder = defineConfig({
    name: "reorder-test",
    fields: {
      items: listField({ label: "Items", itemFields: { id: textField({}) } }),
      other: listField({ label: "Other", itemFields: { id: textField({}) } }),
    },
  });
  const ids = (xs: string[]) => xs.map((id) => ({ id }));
  const run = (key: "items" | "other", b: string[], y: string[], t: string[]) =>
    mergeConfigDocument({
      descriptor: reorder,
      base: { items: [], other: [], [key]: ids(b) },
      yours: { items: [], other: [], [key]: ids(y) },
      theirs: { items: [], other: [], [key]: ids(t) },
    });

  test("in a reorder tree's items the user's order wins", () => {
    const result = run(
      "items",
      ["a", "b", "c"],
      ["c", "b", "a"],
      ["b", "a", "c"],
    );
    expect(result.status).toBe("merged");
    expect(
      (result.document.items as { id: string }[]).map((r) => r.id),
    ).toEqual(["c", "b", "a"]);
  });

  test("elsewhere, both sides reordering differently is a conflict", () => {
    const result = run(
      "other",
      ["a", "b", "c"],
      ["c", "b", "a"],
      ["b", "a", "c"],
    );
    expect(result.status === "conflict" && result.reasons).toEqual([
      { kind: "order", path: ["other"] },
    ]);
  });

  test("a new row goes after its neighbour from the side that added it", () => {
    const result = run(
      "items",
      ["a", "b", "c"],
      ["c", "a", "b"],
      ["a", "n", "b", "c"],
    );
    expect(
      (result.document.items as { id: string }[]).map((r) => r.id),
    ).toEqual(["c", "a", "n", "b"]);
  });
});
