import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { DataViewSlots } from "@plugins/primitives/plugins/data-view/web";
import { MediaCell } from "./components/media-cell";

export {
  MediaCellDataError,
  mediaFieldDef,
  type MediaFieldDefOptions,
} from "./components/media-cell";

export default {
  description:
    "Media field type: data-view table cell (the first file's thumbnail — a click opens the image viewer over all its images and videos — and how many more) plus the mediaFieldDef authoring helper.",
  contributions: [
    DataViewSlots.Cell({
      match: "media",
      companion: true,
      component: MediaCell,
    }),
  ],
} satisfies PluginDefinition;
