import { describe, expect, test } from "bun:test";
import { defineConfig } from "@plugins/config_v2/core";
import { promptField } from "./prompt-field";
import { fillPrompt, joinPrompts, promptList } from "./prompt-text";

const config = defineConfig({
  name: "test-prompts",
  fields: {
    greet: promptField({
      label: "Greeting",
      description: "Says hello.",
      default: "Hello {{name}}.",
      variables: [{ name: "name", description: "who" }],
    }),
    fixed: promptField({
      label: "Fixed",
      description: "No variable.",
      default: "Always the same.",
    }),
  },
});

describe("promptField", () => {
  test("its schema accepts a template using only its variables", () => {
    expect<unknown>(
      config.fields.greet.schema.safeParse("Hi {{ name }}!").success,
    ).toBe(true);
  });

  test("its schema refuses an unknown variable, naming it — so a save fails", () => {
    const parsed = config.fields.greet.schema.safeParse("Hi {{nmae}}");
    expect<unknown>(parsed.success).toBe(false);
    expect<unknown>(parsed.error?.issues[0]?.message).toContain("{{nmae}}");
    expect<unknown>(config.fields.fixed.schema.safeParse("{{x}}").success).toBe(
      false,
    );
  });

  test("the description lists the variables for whoever edits it", () => {
    expect<unknown>(config.fields.greet.meta.description).toBe(
      "Says hello. Filled at each use: {{name}} (who).",
    );
  });
});

describe("fillPrompt", () => {
  test("fills the saved template", () => {
    expect<unknown>(
      fillPrompt(
        config,
        { ...config.defaults, greet: "Yo {{name}}" },
        "greet",
        {
          name: "Ada",
        },
      ),
    ).toBe("Yo Ada");
  });

  test("a template naming a variable it is not filled with throws", () => {
    expect<unknown>(() =>
      fillPrompt(config, { ...config.defaults, fixed: "{{x}}" }, "fixed", {}),
    ).toThrow("{{x}}");
  });

  test("joins drop blank parts", () => {
    const a = fillPrompt(config, config.defaults, "fixed", {});
    const blank = fillPrompt(
      config,
      { ...config.defaults, fixed: " " },
      "fixed",
      {},
    );
    expect<unknown>(joinPrompts([a, blank, null, a])).toBe(
      "Always the same.\n\nAlways the same.",
    );
    expect<unknown>(joinPrompts([blank, null])).toBeNull();
    expect<unknown>(promptList([a, blank, a])).toBe(
      "- Always the same.\n- Always the same.",
    );
  });
});
