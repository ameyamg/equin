import { createContext, useContext, type ReactNode } from "react";
import { useScrollAcrossReload } from "./use-scroll-across-reload";

/**
 * The place the scrollers under it belong to, stable across a reload — a pane
 * instance (its tab, pane, address and views). `undefined` keeps nothing.
 */
const KeepScrollScopeContext = createContext<string | undefined>(undefined);

/**
 * Opens a keep scope: every scroller under it that names itself
 * ({@link useKeptScroll}, `<Scroll keep="…">`) keeps its offset across a reload
 * under `scope` + its name. The pane primitive opens one per pane instance
 * (`PaneScroll`), so a body that scrolls in a box of its own — a file preview,
 * a code listing — is kept like the pane's own scroller, not only that one.
 */
export function KeepScrollScope({
  scope,
  children,
}: {
  scope: string | undefined;
  children: ReactNode;
}) {
  return (
    <KeepScrollScopeContext.Provider value={scope}>
      {children}
    </KeepScrollScopeContext.Provider>
  );
}

/**
 * A callback ref keeping its scroller's offset across a reload
 * ({@link useScrollAcrossReload}), keyed by the enclosing {@link KeepScrollScope}
 * and `name` — what this scroller is among the scope's scrollers, so two kept
 * scrollers of one place (the pane's, and the file preview's inside it) never
 * share an entry. Outside a scope, or with no name, nothing is kept.
 */
export function useKeptScroll(
  name: string | undefined,
): (el: HTMLElement | null) => void {
  const scope = useContext(KeepScrollScopeContext);
  return useScrollAcrossReload(
    scope === undefined || name === undefined ? undefined : `${scope}#${name}`,
  );
}
