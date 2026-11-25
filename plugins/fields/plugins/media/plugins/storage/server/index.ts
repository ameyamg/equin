import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { Fields } from "@plugins/fields/plugins/server-capabilities/server";
import { mediaFieldType } from "@plugins/fields/plugins/media/core";
import { decode } from "./internal/storage";

export default {
  description:
    "Media field type: DB storage capability — a Postgres jsonb column decoded by the field's own MediaRef[] schema.",
  contributions: [Fields.Storage({ type: mediaFieldType, decode })],
} satisfies ServerPluginDefinition;
