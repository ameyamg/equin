import { describe, expect, test } from "bun:test";
import { createContext } from "../context";
import type { Verdict } from "../types";
import { REPO_ROOT } from "@plugins/infra/plugins/paths/plugins/repo-root/core";
import { bareTscGuard } from "./bare-tsc";

function kind(command: string, cwd: string = REPO_ROOT): Verdict["kind"] {
  return (bareTscGuard.check({ command }, createContext(cwd)) as Verdict).kind;
}

// A directory in no git repo: classifyRepo walks up from it and finds none.
const OUTSIDE = "/";

describe("bare-tsc guard", () => {
  describe("the TypeScript compiler run over a checkout is denied", () => {
    for (const cmd of [
      "npx tsc --noEmit -p .",
      "bunx tsc --noEmit -p .",
      "npm exec tsc -- --noEmit -p .",
      "npm exec -- tsc --noEmit -p tsconfig.json",
      "bun x tsc --noEmit",
      "bun run tsc --noEmit",
      "pnpm tsc --noEmit",
      "yarn tsc",
      "npx -p typescript tsc --noEmit",
      "tsc --noEmit -p .",
      "./node_modules/.bin/tsc --noEmit",
      "node node_modules/.bin/tsc --noEmit -p .",
      "node node_modules/typescript/lib/tsc.js -p .",
      "bun node_modules/typescript/bin/tsc -p .",
      "timeout 300 npx tsc --noEmit -p . 2>&1 | grep error | head",
      "cd plugins && npx tsc --noEmit -p ..",
      "npx tsc@5.6 --noEmit -p .",
      "npx tsc --listFilesOnly -p .",
      "npx tsc -b",
      "env FOO=1 npx tsc --noEmit",
      "echo . | xargs tsc --noEmit -p",
      "npx tsc --noEmit plugins/foo/a.ts",
    ]) {
      test(cmd, () => expect(kind(cmd)).toBe("deny"));
    }
    test("a project flag naming the checkout from outside it", () => {
      expect(kind(`npx tsc --noEmit -p ${REPO_ROOT}`, OUTSIDE)).toBe("deny");
      expect(
        kind(`npx tsc --noEmit --project ${REPO_ROOT}/tsconfig.json`, OUTSIDE),
      ).toBe("deny");
    });
  });

  describe("everything else passes", () => {
    for (const cmd of [
      "npx tsc --version",
      "bunx tsc -v",
      "tsc --help",
      "npx tsc --showConfig -p .",
      "./equin check type-check",
      "npx prettier --check .",
      "npm exec eslint .",
      "bun install",
      "rg -n tsc plugins",
      "echo npx tsc --noEmit",
      "npm test",
      "npm run tsc-foo",
      "bun run typecheck",
      "npx -p tsc eslint",
      "npx tsc --noEmit /tmp/x.ts",
      "npx tsc -p /tmp/proj",
      "cd /tmp/proj && npx tsc --noEmit",
    ]) {
      test(cmd, () => expect(kind(cmd)).toBe("allow"));
    }
    test("tsc outside any equin checkout", () => {
      expect(kind("npx tsc --noEmit -p .", OUTSIDE)).toBe("allow");
    });
  });
});
