import { fieldSample } from "@plugins/config_v2/plugins/fields/core";
import { mediaField } from "@plugins/fields/plugins/media/core";

/**
 * The media field's fixed gallery sample (see `FieldSample`). Empty: a ref
 * names a stored attachment, which no machine has in common, so the row shows
 * what a fresh field shows — the dropzone.
 */
export const mediaSample = fieldSample(
  mediaField({
    label: "Screenshots",
    description: "Images or short clips shown with the post, in this order.",
    accept: ["image/*", "video/*"],
    max: 6,
  }),
  [],
);
