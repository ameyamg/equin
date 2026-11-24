// The looks a generated building can have: a closed set, local to the kit. Each
// look biases the archetype, the props beside the building and the setting it
// likes. Which look an app gets is the caller's key (Isle keys it on the app's
// region, so the buildings of one region look alike) hashed onto the set.

import { fnv1a32 } from "@plugins/packages/plugins/string-hash/core";
import { at } from "./colour";

/** Workshop, atelier, music hall, homestead, archive, fairground, mill. */
export const BUILDING_STYLES = [
  "work",
  "create",
  "music",
  "life",
  "data",
  "play",
  "system",
] as const;
export type BuildingStyle = (typeof BUILDING_STYLES)[number];

/** The look a key (a region id, any string) gives: the same key, the same look. */
export const buildingStyleOf = (key: string): BuildingStyle =>
  at(BUILDING_STYLES, (fnv1a32(key) >>> 3) % BUILDING_STYLES.length);
