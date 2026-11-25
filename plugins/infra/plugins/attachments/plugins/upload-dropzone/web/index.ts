import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";

export { UploadDropzone } from "./internal/upload-dropzone";
export type {
  UploadDropzoneHandle,
  UploadDropzoneProps,
} from "./internal/upload-dropzone";
export type { UploadAccept } from "./internal/accept";

export default {
  description:
    "<UploadDropzone>: click, drop or paste one or several files into the attachments store — mime (accept), size (maxBytes) and count (maxFiles) checked before upload, uploading / error state, one onUploaded per file. Owns no focus: a host opens the picker through handleRef (a page block's Enter / Space) and arms paste (pasteArmed).",
  contributions: [],
} satisfies PluginDefinition;
