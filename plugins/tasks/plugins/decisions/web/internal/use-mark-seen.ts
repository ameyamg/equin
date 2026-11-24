import { useEffect, useSyncExternalStore } from "react";
import { useEndpointMutation } from "@plugins/infra/plugins/endpoints/web";
import { useSurfaceShown } from "@plugins/apps-core/plugins/tabs/web";
import { markDecisionSeenEndpoint, type DecisionRow } from "../../core";

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}
const documentVisible = (): boolean => document.visibilityState === "visible";
// A static render is never seen by anyone: nothing is marked from it.
const notVisible = (): boolean => false;

/**
 * Marks a decision seen while the user can actually see it and it is new: on
 * open, and again each time the agent writes in its thread while it stays
 * open (`isNew` turns true again). Gated on the surface being shown (tabs are
 * keep-alive: a background tab's pane stays mounted) and on the page being
 * visible, so a reply landing in a tab nobody looks at keeps its new mark.
 */
export function useMarkDecisionSeen(
  decision: Pick<DecisionRow, "id" | "isNew"> | undefined,
): void {
  // TanStack's `mutate` is stable across renders.
  const { mutate } = useEndpointMutation(markDecisionSeenEndpoint);
  const shown = useSurfaceShown();
  const visible = useSyncExternalStore(
    subscribeVisibility,
    documentVisible,
    notVisible,
  );
  const id = decision?.id;
  const isNew = decision?.isNew === true;
  useEffect(() => {
    if (id === undefined || !isNew || !shown || !visible) return;
    mutate({ params: { decisionId: id } });
  }, [id, isNew, shown, visible, mutate]);
}
