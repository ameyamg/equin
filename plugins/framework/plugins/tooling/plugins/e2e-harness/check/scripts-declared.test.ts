import { describe, expect, test } from "bun:test";
import { e2eDeclarationProblems } from "./scripts-declared";
import { scanE2eModule } from "./scripts-declared.scan";

const DIR = "plugins/tasks/e2e";
const OTHER = "plugins/wish/e2e";
const TYPE_IMPORT = `import type { E2eScript } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/core";\n`;

/** Each module's source, and (as the module graph would answer) what it imports. */
function problems(
  files: Record<string, string>,
  edges: Record<string, string[]> = {},
): string[] {
  return e2eDeclarationProblems(
    Object.entries(files).map(([rel, src]) => scanE2eModule(src, rel)),
    new Map(Object.entries(edges)),
  );
}

const TEST = `${TYPE_IMPORT}export const e2e = { kind: "test", target: "build", writes: true, run: "auto" } satisfies E2eScript;\n`;

describe("e2e-harness:scripts-declared", () => {
  test("a declared script, a helper it imports and the barrel pass", () => {
    expect(
      problems(
        {
          [`${DIR}/index.ts`]: `export { help } from "./support/help";\n`,
          [`${DIR}/support/help.ts`]: `export const help = 1;\n`,
          [`${DIR}/flow.ts`]: `import { help } from "./support/help";\n${TEST}`,
        },
        { [`${DIR}/flow.ts`]: [`${DIR}/support/help.ts`] },
      ),
    ).toEqual([]);
  });

  test("an undeclared script is named", () => {
    const out = problems({ [`${DIR}/flow.ts`]: `console.log(1);\n` });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain(`${DIR}/flow.ts: nothing imports it`);
  });

  test("an imported module may not declare", () => {
    const out = problems(
      {
        [`${DIR}/a.ts`]: TEST,
        [`${DIR}/b.ts`]: `import "./a";\n${TEST}`,
      },
      { [`${DIR}/b.ts`]: [`${DIR}/a.ts`] },
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toContain(`${DIR}/a.ts:2: a helper declares nothing`);
  });

  test("a module reached through another plugin's barrel is a helper", () => {
    expect(
      problems(
        {
          [`${OTHER}/index.ts`]: `export * from "./lib";\n`,
          [`${OTHER}/lib.ts`]: `export const x = 1;\n`,
          [`${DIR}/flow.ts`]: `import { x } from "@plugins/wish/e2e";\n${TEST}`,
        },
        {
          [`${OTHER}/index.ts`]: [`${OTHER}/lib.ts`],
          [`${DIR}/flow.ts`]: [`${OTHER}/index.ts`],
        },
      ),
    ).toEqual([]);
  });

  test("a non-literal or unsatisfied declaration is refused", () => {
    expect(
      problems({
        [`${DIR}/a.ts`]: `const k = "test";\nexport const e2e = { kind: k } satisfies E2eScript;\n`,
        [`${DIR}/b.ts`]: `export const e2e = { kind: "test" };\n`,
      }),
    ).toEqual([
      `${DIR}/a.ts:2: \`k\` is not a literal — the declaration is read without running the script, so it holds literals only`,
      `${DIR}/b.ts:1: write it as \`export const e2e = { … } satisfies E2eScript;\``,
    ]);
  });

  test("the schema and the cross-field rules apply", () => {
    const out = problems({
      [`${DIR}/a.ts`]: `export const e2e = { kind: "test", target: "build", writes: true, run: { manual: [], why: "x" } } satisfies E2eScript;\n`,
      [`${DIR}/b.ts`]: `export const e2e = { kind: "tool", target: "none", writes: true, run: "auto" } satisfies E2eScript;\n`,
      [`${DIR}/c.ts`]: `await openDeployDb();\nexport const e2e = { kind: "test", target: "build", writes: false, run: "auto" } satisfies E2eScript;\n`,
      [`${DIR}/d.ts`]: `export const e2e = { kind: "helper", why: "bundled by ./a.ts" } satisfies E2eScript;\n`,
    });
    expect(out).toHaveLength(3);
    expect(out[0]).toContain(`${DIR}/a.ts:1: invalid declaration — run`);
    expect(out[1]).toContain(`${DIR}/b.ts:1: \`target: "none"\``);
    expect(out[2]).toContain(`${DIR}/c.ts:2: calls \`openDeployDb\``);
  });

  test("a test file under e2e/ is an importer, never a script", () => {
    expect(
      problems(
        {
          [`${DIR}/metrics.ts`]: `export const m = 1;\n`,
          [`${DIR}/metrics.test.ts`]: `import { m } from "./metrics";\n`,
        },
        { [`${DIR}/metrics.test.ts`]: [`${DIR}/metrics.ts`] },
      ),
    ).toEqual([]);
  });

  test("a module of declarations alone is a library, not a script", () => {
    expect(
      problems({
        [`${DIR}/types.ts`]: `export interface T { a: number }\nexport function f() { return 1; }\nexport const K = 3;\n`,
      }),
    ).toEqual([]);
    expect(
      problems({ [`${DIR}/top-await.ts`]: `const x = await fetch("/");\n` }),
    ).toHaveLength(1);
  });
});
