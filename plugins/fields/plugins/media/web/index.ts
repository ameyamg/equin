import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Fields } from "@plugins/fields/web";
import { mediaIdentity } from "../core";

export {
  MediaSetThumb,
  MediaThumb,
  ViewableMediaThumb,
} from "./components/media-thumb";
export type {
  MediaMetadata,
  MediaSetThumbProps,
  MediaThumbProps,
} from "./components/media-thumb";

export default {
  description:
    "Media field type: identity, plus MediaThumb — one MediaRef as a small square (an image, a video's first frame, a file glyph) shared by the config renderer and the table cell; ViewableMediaThumb opens it (image or video) in the enclosing ImageGallery's viewer; MediaSetThumb draws a set as its first file and opens the viewer over the whole set (the table cell).",
  contributions: [Fields.Identity({ identity: mediaIdentity })],
} satisfies PluginDefinition;
