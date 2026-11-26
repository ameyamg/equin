import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getWorktreeRoot } from "@plugins/infra/plugins/spawn/core";
import {
  WRAPPER_FILE,
  STUB_SCRIPT,
  stubFindings,
  wrapperFindings,
} from "./rebase-first-stub";

const root = await getWorktreeRoot();
const equin = readFileSync(join(root, WRAPPER_FILE), "utf8");
const stub = readFileSync(join(root, STUB_SCRIPT), "utf8");

describe("push:rebase-first-stub", () => {
  test("the committed wrapper and stub pass", () => {
    expect(wrapperFindings(equin)).toEqual([]);
    expect(stubFindings(stub)).toEqual([]);
  });

  test("a step above the stub in ./equin is refused", () => {
    const moved = equin.replace(
      'cd "$(dirname "$0")"\n',
      'cd "$(dirname "$0")"\n. plugins/infra/plugins/paths/scripts/declare-data-root.sh\n',
    );
    expect(wrapperFindings(moved)).toEqual([
      expect.stringContaining("declare-data-root.sh` runs before"),
    ]);
  });

  test("a step inside the stub's block, before it, is refused", () => {
    const moved = equin.replace(
      "  first=0\n",
      "  first=0\n  . plugins/infra/plugins/paths/scripts/declare-data-root.sh\n",
    );
    expect(wrapperFindings(moved)).toEqual([
      expect.stringContaining("inside its block"),
    ]);
  });

  test("a wrapper that never runs the stub is refused", () => {
    expect(wrapperFindings("#!/bin/sh\nset -e\nexec bun x.ts\n")).toHaveLength(
      1,
    );
  });

  test("a stub reaching bun, ./equin, a repo path or a sourced file is refused", () => {
    const bad = [
      "bun run x.ts",
      "./equin check",
      "x=$(cat plugins/a/b.ts)",
      ". ./lib.sh",
      "ls node_modules",
      'eval "$cmd"',
      'sh -c "x"',
      '"$(git rev-parse --show-toplevel)/equin" check',
    ];
    for (const line of bad)
      expect(stubFindings(`#!/bin/sh\n${line}\n`).length).toBeGreaterThan(0);
  });

  test("messages may name ./equin: heredocs and comments are not commands", () => {
    const text =
      "#!/bin/sh\n# runs ./equin push\ncat >&2 <<EOF\n  Re-run ./equin push\nEOF\necho ok\n";
    expect(stubFindings(text)).toEqual([]);
  });
});
