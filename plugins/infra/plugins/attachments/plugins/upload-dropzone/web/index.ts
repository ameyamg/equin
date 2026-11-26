import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";

export { UploadDropzone } from "./internal/upload-dropzone";
export type {
  UploadDropzoneFocus,
  UploadDropzoneHandle,
  UploadDropzoneProps,
} from "./internal/upload-dropzone";
export type { UploadAccept } from "./internal/accept";

export default {
  description:
    "<UploadDropzone>: click, drop or paste one or several files into the attachments store — mime (accept), size (maxBytes) and count (maxFiles) checked before upload, uploading / error state, one onUploaded per file. Focus is owned by the host (a page block opens the picker through handleRef and arms a window paste listener while its caret is on it) or by the dropzone itself (a form field: Tab to it, Enter / Space open the picker, Cmd+V while it is focused uploads).",
  contributions: [],
} satisfies PluginDefinition;
