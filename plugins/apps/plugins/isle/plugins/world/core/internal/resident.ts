import type { BuildingSpec } from "@plugins/apps/plugins/isle/plugins/buildings/core";
import { signHalfWidth, type Resident } from "./placement";

/**
 * An app and its building, as placement reads them. `group` / `region` are the
 * app's category as its caller read it (the leaf tag and its root, `NO_GROUP`
 * for an uncategorised app) — placement never reads the category tree itself.
 */
export function residentOf(
  app: {
    readonly id: string;
    readonly name: string;
    readonly group: string;
    readonly region: string;
  },
  building: BuildingSpec,
): Resident {
  return {
    id: app.id,
    group: app.group,
    region: app.region,
    footprint: building.footprint,
    setting: building.setting ?? [],
    ...(building.signX !== undefined && { signX: building.signX }),
    signHalf: signHalfWidth(app.name),
  };
}
