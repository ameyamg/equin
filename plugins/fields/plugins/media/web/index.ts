import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Fields } from "@plugins/fields/web";
import { mediaIdentity } from "../core";

export { MediaThumb } from "./components/media-thumb";
export type { MediaMetadata, MediaThumbProps } from "./components/media-thumb";

export default {
  description:
    "Media field type: identity, plus MediaThumb — one MediaRef as a small square (an image, a video's first frame, a file glyph) shared by the config renderer and the table cell.",
  contributions: [Fields.Identity({ identity: mediaIdentity })],
} satisfies PluginDefinition;
