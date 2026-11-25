import { useDeploymentShipsEach } from "@plugins/apps/plugins/deploy/plugins/host-query/web";
import { useSiteFeedDeclarations } from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/box/web";

/**
 * The Feeds tab's gate: does the deployment ship any plugin declaring a feed?
 * `true` while loading and on a failed read (the tab shows either), so the
 * tab does not pop in a frame late.
 */
export function useFeedsAvailable({
  deploymentId,
}: {
  deploymentId: string;
}): boolean {
  const declarations = useSiteFeedDeclarations();
  const ships = useDeploymentShipsEach(
    deploymentId,
    declarations.map((d) => d.pluginId),
  );
  return ships.kind !== "ready" || ships.shipped.size > 0;
}
