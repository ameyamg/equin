import { describe, expect, test } from "bun:test";
import { textField } from "@plugins/fields/plugins/text/plugins/config/core";
import { objectField } from "@plugins/fields/plugins/object/plugins/config/core";
import { defineConfig } from "../core/internal/define-config";
import { defineConfigMigration } from "../core/internal/config-migration";
import type { ConfigRegistration } from "./config-registrations";
import { undeclaredFieldRemovals } from "./fields-retired";

const STORE = "config_v2/retired-fixture.jsonc";

const reg = (descriptor: unknown): ConfigRegistration => ({
  runtime: "server",
  registrar: "config_v2",
  owner: "config_v2",
  storePath: STORE,
  barrel: "plugins/config_v2/server/index.ts",
  descriptor,
});

/** The merge base's origin: the config before the rename (`prompt`, `limits.max`). */
const OLD_ORIGIN = `// @hash 000000000000
{ "prompt": "p1", "model": "opus", "limits": { "max": 3 } }
`;
const origins = new Map([[STORE, OLD_ORIGIN]]);

const fields = {
  instructions: textField({ default: "p1" }),
  model: textField({ default: "opus" }),
  limits: objectField({ subFields: { maxRuns: textField({ default: "3" }) } }),
};

describe("undeclaredFieldRemovals", () => {
  test("a field renamed with no declaration fails, top-level and inside an object field", () => {
    const d = defineConfig({ fields });
    expect(undeclaredFieldRemovals([reg(d), reg(d)], origins)).toEqual([
      { storePath: STORE, path: "limits.max" },
      { storePath: STORE, path: "prompt" },
    ]);
  });

  test("a rename declared by retiredFields passes", () => {
    const d = defineConfig({
      fields,
      retiredFields: {
        prompt: { renamedTo: "instructions", reason: "renamed" },
        "limits.max": { renamedTo: "limits.maxRuns", reason: "renamed" },
      },
    });
    expect(undeclaredFieldRemovals([reg(d)], origins)).toEqual([]);
  });

  test("a rename declared by a migration's renames / removes passes", () => {
    const d = defineConfig({
      fields,
      migrations: [
        defineConfigMigration({
          id: "prompt-to-instructions",
          renames: { prompt: "instructions" },
          removes: ["limits.max"],
          apply: (doc) => doc,
        }),
      ],
    });
    expect(undeclaredFieldRemovals([reg(d)], origins)).toEqual([]);
  });

  test("a config with no origin at the merge base is not judged", () => {
    const d = defineConfig({ fields });
    expect(undeclaredFieldRemovals([reg(d)], new Map())).toEqual([]);
  });
});

describe("retiredFields declarations", () => {
  test("a rename onto a field the config does not declare throws", () => {
    expect(() =>
      defineConfig({
        fields,
        retiredFields: { prompt: { renamedTo: "nope", reason: "renamed" } },
      }),
    ).toThrow(/not one of its fields/);
  });

  test("retiring a field the config still declares throws", () => {
    expect(() =>
      defineConfig({
        fields,
        retiredFields: { model: { reason: "gone" } },
      }),
    ).toThrow(/still declares/);
  });
});
