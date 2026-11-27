/**
 * Whether two JSON values are the same value: objects compared by their keys
 * whatever their order, arrays in order. A record's values are JSON (they are
 * stored in a jsonb column), so nothing else needs comparing.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    // An absent key and an undefined one are the same JSON.
    if (!jsonEqual(ao[k], bo[k])) return false;
  }
  return true;
}

/**
 * The keys of `fieldKeys` whose value in `next` differs from `base`'s, in the
 * fields' order — what a proposal changes. For a new record, `base` is the
 * type's defaults.
 */
export function changedKeys(
  fieldKeys: readonly string[],
  base: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
): string[] {
  return fieldKeys.filter((k) => !jsonEqual(base[k], next[k]));
}

/**
 * The values an accept writes over main's record: for a plain accept, only
 * the keys the proposal changed (so a field the user edited on main since
 * stays theirs); for an accept with the user's own edits, exactly the keys
 * the user's copy sets (the proposal's changed keys and the ones the user
 * edited — never a key read before a newer edit of the record).
 */
export function acceptedSet(args: {
  fieldKeys: readonly string[];
  proposed: Readonly<Record<string, unknown>>;
  changed: readonly string[];
  edited: Readonly<Record<string, unknown>> | null;
}): Record<string, unknown> {
  const { fieldKeys, proposed, changed, edited } = args;
  if (edited === null) {
    // A field the record's type dropped since is not written.
    return Object.fromEntries(
      changed.filter((k) => fieldKeys.includes(k)).map((k) => [k, proposed[k]]),
    );
  }
  return Object.fromEntries(
    fieldKeys.filter((k) => k in edited).map((k) => [k, edited[k]]),
  );
}
