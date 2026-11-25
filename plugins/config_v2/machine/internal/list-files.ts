import { relative, sep } from "node:path";
import { readdir } from "@plugins/packages/plugins/timed-fs/core";

/**
 * Every `.jsonc` file under `dir`, by dir-relative forward-slash path; `[]`
 * when `dir` does not exist.
 *
 * ONE recursive listing, not a walk awaiting each directory in turn: a user
 * layer is ~430 directories, and every awaited `readdir` is an event-loop turn
 * — 26 ms on an idle process, 0.5–4 s on a busy backend, where each turn
 * queues behind everything else the backend is doing.
 */
export async function listConfigFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true, recursive: true });
  } catch (err) {
    // Only the dir itself missing means "nothing there"; anything else is loud.
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT" && (e.path === undefined || e.path === dir))
      return [];
    throw err;
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".jsonc")) continue;
    const rel = relative(dir, `${e.parentPath}${sep}${e.name}`);
    out.push(sep === "/" ? rel : rel.split(sep).join("/"));
  }
  return out;
}
