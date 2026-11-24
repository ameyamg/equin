import type { ReactNode } from "react";
import { findRootScope } from "../internal/find-root-scope";

/**
 * The region a `<FindBar>` searches: everything inside it, as drawn.
 * Adds no box of its own (`display: contents`), so wrapping content in it
 * changes no layout. Must sit under the same `<FindScope>` as its bar.
 */
export function FindRoot({ children }: { children: ReactNode }) {
  const ref = findRootScope.usePublishRef();
  return (
    <div ref={ref} data-find-root="" className="contents">
      {children}
    </div>
  );
}

/** The common ancestor of a `<FindRoot>` and its `<FindBar>`. */
export const FindScope = findRootScope.Provider;
