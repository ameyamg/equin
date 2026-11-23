/**
 * Every test file whose digest moved between the merge base and HEAD — the
 * files the change can affect: its closure, its runner's inputs or the npm
 * resolutions changed, or it is new. A file gone at HEAD is nobody's test.
 * Sorted.
 */
export function affectedTests(
  head: ReadonlyMap<string, string>,
  base: ReadonlyMap<string, string>,
): string[] {
  return [...head]
    .filter(([path, digest]) => base.get(path) !== digest)
    .map(([path]) => path)
    .sort();
}
