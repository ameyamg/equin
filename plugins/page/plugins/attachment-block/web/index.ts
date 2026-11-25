import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";

export { AttachmentUpload } from "./components/attachment-upload";

export default {
  description:
    "Shared web infra for attachment-owning page blocks: <AttachmentUpload>, the empty state — attachments' UploadDropzone wired to the block (Enter / Space open its picker through useBlockActivate, paste armed while the caret is on it).",
} satisfies PluginDefinition;
