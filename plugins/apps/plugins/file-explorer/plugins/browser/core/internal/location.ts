import type { BrowsableFileSystem } from "@plugins/infra/plugins/paths/plugins/file-systems/core";

/**
 * Where a file explorer is: the file system it browses, the folder it lists,
 * and the file open beside it. Both paths are in display form (`~/…` under
 * the system's home, absolute elsewhere).
 */
export interface ExplorerLocation {
  fs: BrowsableFileSystem;
  dir: string;
  /** The file previewed beside the listing, or `null` for none. */
  open: string | null;
}

/** One string per location, for comparing two of them. */
export function locationKey(location: ExplorerLocation): string {
  return `${location.fs}\u0000${location.dir}\u0000${location.open ?? ""}`;
}
