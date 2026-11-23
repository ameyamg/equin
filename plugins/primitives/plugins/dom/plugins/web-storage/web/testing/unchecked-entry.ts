import { writeUncheckedEntry } from "../internal/store";

/**
 * Writes `value` under a declared owner's page-scope key `id`, stamped with
 * the owner's current schema but never parsed against it — an entry this
 * build wrote that its own schema refuses (a corrupt one). Tests use it
 * instead of hand-writing the storage format (key prefix, envelope, stamp),
 * so a change to that format cannot leave them testing another schema's
 * entry by accident.
 */
export function writeEntryUnchecked(
  owner: string,
  id: string,
  value: unknown,
): void {
  writeUncheckedEntry(owner, id, value);
}
