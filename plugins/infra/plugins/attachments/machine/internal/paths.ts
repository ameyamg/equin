import { mkdir } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  isMain,
  runtimeNamespace,
} from "@plugins/infra/plugins/runtime-identity/core";
import { attachmentsDir } from "../../data-dirs";

/**
 * Every checkout's backend shares the one host-global attachments dir, and a
 * worktree's database is a fork of main's: it holds main's rows, keys and all.
 * So the bytes a key names belong to the checkout that WROTE them, and the key
 * says which — main's files sit at the dir's top level (where every file
 * written before this layout sits too), any other namespace's under
 * `checkouts/<namespace>/`. A store writes only into its own place and deletes
 * only keys in it ({@link ownsKey}): a worktree deleting a row it forked from
 * main, or importing an id main already holds, can never touch main's file.
 */
const checkoutsArea = attachmentsDir.subdir("checkouts");

/** The directory this process's checkout writes its attachment files into. */
async function ownDir(): Promise<string> {
  if (isMain()) return attachmentsDir.ensure();
  await checkoutsArea.ensure();
  const dir = checkoutsArea.file(runtimeNamespace());
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function ensureAttachmentsRoot(): Promise<string> {
  return ownDir();
}

export async function diskPathFor(
  id: string,
  filename: string,
): Promise<string> {
  const ext = extname(filename).toLowerCase() || ".bin";
  const dir = await ownDir();
  return join(dir, `${id}${ext}`);
}

/** `…/attachments/checkouts/<namespace>/<file>` — a non-main checkout's file. */
const CHECKOUT_KEY = /\/attachments\/checkouts\/([^/]+)\/[^/]+$/;

/**
 * The namespace whose file `key` is: the one its `checkouts/<namespace>/`
 * segment names, else `null`: main's (main's own files, and every file
 * written before per-checkout places existed — those stay main's, so no
 * worktree may remove them).
 */
export function keyOwner(key: string): string | null {
  return CHECKOUT_KEY.exec(key)?.[1] ?? null;
}

/** Whether this process's checkout wrote — and so may delete — the file at `key`. */
export function ownsKey(key: string): boolean {
  const owner = keyOwner(key);
  return isMain() ? owner === null : owner === runtimeNamespace();
}
