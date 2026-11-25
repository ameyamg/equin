import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Fields } from "@plugins/config_v2/plugins/fields/web";
import { mediaSample } from "../core";
import { MediaRenderer } from "./components/media-renderer";

export default {
  description:
    "Media field type: config-render capability — reorderable thumbnails, remove, and the upload dropzone (accept / max / maxBytes from the field), each upload held for a day until its owner links it.",
  contributions: [Fields.Renderer(MediaRenderer), Fields.Sample(mediaSample)],
} satisfies PluginDefinition;
