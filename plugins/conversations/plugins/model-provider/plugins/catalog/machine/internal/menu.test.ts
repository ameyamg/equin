import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BASELINE_MODELS,
  ConversationModelSchema,
  cliFlagFor,
} from "@plugins/conversations/plugins/model-provider/core";
import { parseInitializeModels, type CliModel } from "./cli-models";
import { readMenu } from "./menu";

const id = (raw: string) => ConversationModelSchema.parse(raw);
// A CLI model name spelled from the id, as everything outside the registry must.
const cliName = (raw: string) => cliFlagFor(id(raw));

const RECORDED = parseInitializeModels(
  (
    JSON.parse(
      readFileSync(
        join(import.meta.dir, "initialize-response.fixture.json"),
        "utf8",
      ),
    ) as { response: { response: { models: unknown } } }
  ).response.response.models,
);

const alias = (value: string, resolved: string): CliModel => ({
  value,
  resolvedModel: resolved,
});

describe("readMenu", () => {
  test("the recorded menu: each family's current version, every offered version, no problem", () => {
    const menu = readMenu(RECORDED);
    expect(menu.current).toEqual({
      opus: id("opus-5-5"),
      fable: id("fable-5-1"),
      sonnet: id("sonnet-5-5"),
      haiku: id("haiku-4-5"),
    });
    // Exactly the baseline: the versions this code shipped knowing.
    expect([...menu.offered].sort()).toEqual(
      BASELINE_MODELS.versions.map((v) => v.id).sort(),
    );
    expect(menu.problems).toEqual([]);
  });

  test("`default` is ignored: it is the CLI's pick of a family, not one", () => {
    const menu = readMenu([alias("default", cliName("opus-9"))]);
    expect(menu.offered).toEqual([]);
    expect(menu.current).toEqual({});
  });

  test("an unknown alias, a name outside the grammar, a cross-family alias: reported, nothing placed", () => {
    const menu = readMenu([
      ...RECORDED,
      alias("mythos", "claude-mythos-1"),
      alias("sonnet-latest", cliName("sonnet-9")),
      alias("claude-3-5-sonnet", "claude-3-5-sonnet-20241022"),
    ]);
    expect(menu.problems).toEqual([
      {
        problem: "unknown-alias",
        value: "mythos",
        resolvedModel: "claude-mythos-1",
      },
      {
        problem: "unknown-alias",
        value: "sonnet-latest",
        resolvedModel: cliName("sonnet-9"),
      },
      {
        problem: "unknown-alias",
        value: "claude-3-5-sonnet",
        resolvedModel: "claude-3-5-sonnet-20241022",
      },
    ]);
    expect(menu.offered).not.toContain(id("sonnet-9"));

    const renamed = readMenu([
      alias("opus", "claude-opus-next"),
      alias("sonnet", cliName("opus-9")),
    ]);
    expect(renamed.problems.slice(0, 2)).toEqual([
      {
        problem: "not-a-model-id",
        value: "opus",
        resolvedModel: "claude-opus-next",
      },
      {
        problem: "family-mismatch",
        value: "sonnet",
        resolvedModel: cliName("opus-9"),
      },
    ]);
    expect(renamed.current).toEqual({});
    expect(renamed.offered).toEqual([]);
  });

  test("a family runs the newest version of it the menu offers, even before its alias moves", () => {
    const menu = readMenu([
      ...RECORDED,
      alias(cliName("fable-5-2"), cliName("fable-5-2")),
    ]);
    expect(menu.current.fable).toBe(id("fable-5-2"));
    expect(menu.offered).toContain(id("fable-5-1"));
    expect(menu.problems).toEqual([]);
  });

  test("the user's own pick with a context variant, listed in place of its family's alias: that family, no problem", () => {
    // Recorded (2026-11-24): settings `model: "claude-fable-5-2[1m]"` turns
    // the `fable` row into this one.
    const menu = readMenu([
      ...RECORDED.filter((m) => m.value !== "fable"),
      alias(`${cliName("fable-5-2")}[1m]`, cliName("fable-5-2")),
    ]);
    expect(menu.current.fable).toBe(id("fable-5-2"));
    expect(menu.offered).toContain(id("fable-5-2"));
    expect(menu.problems).toEqual([]);
  });

  test("a family offered by name only runs its newest offered version", () => {
    const menu = readMenu([
      alias(cliName("haiku-4-5"), cliName("haiku-4-5")),
      alias(cliName("haiku-5-5"), cliName("haiku-5-5")),
    ]);
    expect(menu.current.haiku).toBe(id("haiku-5-5"));
  });

  test("a family the menu offers no version of is reported", () => {
    // The recorded menu offers Haiku through its alias only.
    const menu = readMenu(RECORDED.filter((m) => m.value !== "haiku"));
    expect(menu.current.haiku).toBeUndefined();
    expect(menu.problems).toEqual([
      { problem: "family-missing", value: "haiku", resolvedModel: null },
    ]);
  });
});
