/**
 * `.githooks/prepare-commit-msg` cannot import this leaf, so it spells the
 * conversation trailer's keys itself. Run for real on a message file, it must
 * stamp the current key, and treat a message already carrying ANY of the keys
 * (a commit from before the rename, replayed by a rebase) as stamped.
 */
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnExpectOk } from "@plugins/infra/plugins/spawn/core";
import { envEntries } from "@plugins/infra/plugins/launcher/plugins/env-names/core";
import { CONVERSATION_TRAILER } from "./trailers";

const HOOK = resolve(
  import.meta.dir,
  "../../../../../../../../.githooks/prepare-commit-msg",
);

async function runHook(message: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "commit-trailers-hook-"));
  try {
    await spawnExpectOk(["git", "init", "-q", dir], { timeoutMs: 30_000 });
    const file = join(dir, "MSG");
    writeFileSync(file, message);
    await spawnExpectOk(["sh", HOOK, file], {
      cwd: dir,
      env: { ...process.env, ...envEntries({ CONVERSATION_ID: "conv-new" }) },
      timeoutMs: 30_000,
    });
    return readFileSync(file, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the hook stamps the current key", async () => {
  const out = await runHook("subject\n");
  expect(out).toContain(`${CONVERSATION_TRAILER.key}: conv-new`);
});

test("a message already stamped under any key is left alone", async () => {
  for (const key of CONVERSATION_TRAILER.readKeys) {
    const message = `subject\n\n${key}: conv-old\n`;
    expect(await runHook(message)).toBe(message);
  }
});
