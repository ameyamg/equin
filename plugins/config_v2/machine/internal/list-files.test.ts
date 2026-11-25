import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { listConfigFiles } from "./list-files";

describe("listConfigFiles", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "config-list-files-"));
    for (const rel of [
      "a/config.origin.jsonc",
      "a/b/@app/mail/config.jsonc",
      "a/config.jsonc.tmp-123",
      ".config-migrations-applied.json",
    ]) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), "{}");
    }
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("every .jsonc under the dir, by relative path", async () => {
    expect((await listConfigFiles(dir)).sort()).toEqual([
      "a/b/@app/mail/config.jsonc",
      "a/config.origin.jsonc",
    ]);
  });

  test("a missing dir holds nothing", async () => {
    expect(await listConfigFiles(join(dir, "absent"))).toEqual([]);
  });
});
