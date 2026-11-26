import { useShipsGate } from "@plugins/apps/plugins/deploy/plugins/host-query/web";
import type { TabBadge } from "@plugins/primitives/plugins/tabbed-view/web";
import { INTAKE_PLUGIN_ID } from "./intake-plugin-id";
import { useNewMessagesCount } from "./use-new-messages";

/**
 * The section gate: does the deployment's composition ship the intake? `true`
 * while loading (the card shows its own loading state rather than popping in a
 * frame late) and when the answer failed, so the card can show that failure.
 */
export function useMessagesAvailable({
  deploymentId,
}: {
  deploymentId: string;
}): boolean {
  return useShipsGate(deploymentId, INTAKE_PLUGIN_ID);
}

/**
 * The Messages tab's badge: the site's new messages — accepted ones received
 * since the tab was last opened ({@link useNewMessagesCount}, the same count
 * as the health report's "N new messages"). Opening the tab moves the seen
 * mark, so the badge clears there. No badge while the count is not known (the
 * tab shows why) and none at zero.
 */
export function useNewMessagesBadge({
  deploymentId,
}: {
  deploymentId: string;
}): TabBadge | null {
  const fresh = useNewMessagesCount(deploymentId);
  return fresh.kind === "ready" && fresh.count > 0
    ? { count: fresh.count }
    : null;
}
