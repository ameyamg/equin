import type { z } from "zod";
import { parsedJson } from "@plugins/database/plugins/sql-column/server";
import type { StorageColumnFor } from "@plugins/fields/plugins/server-capabilities/server";
import type { MediaRef } from "@plugins/fields/plugins/media/core";

/**
 * The `jsonb` column holding a media value, decoded by the FIELD's own schema
 * (its `max`, its unique-ids refinement) on every read and write — the
 * `tags` sibling's arm. Every media schema narrows the column (the token
 * declares `MediaRef[]`), so every media column decodes.
 */
export const decode = <V extends MediaRef[]>(
  name: string,
  valueSchema: z.ZodType<V>,
): StorageColumnFor<V> => parsedJson(name, valueSchema);
