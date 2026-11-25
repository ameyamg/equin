import { useRef } from "react";
import type { IconRef } from "@plugins/ui/plugins/icons/core";
import type { UploadedAttachment } from "@plugins/infra/plugins/attachments/web";
import {
  UploadDropzone,
  type UploadDropzoneHandle,
} from "@plugins/infra/plugins/attachments/plugins/upload-dropzone/web";
import { useBlockActivate } from "@plugins/page/plugins/editor/web";

/**
 * The empty state of an attachment-owning page block: the shared
 * `UploadDropzone` (one file), wired to the block.
 *
 * **It is not a focus target.** The block's caret host is: it is the focusable
 * box, it reports focus to the editor, and it answers the keyboard. Enter /
 * Space are declared through {@link useBlockActivate} — an unfilled media
 * block is a PROMPT, so its primary action is to fill it — and open the
 * dropzone's picker; a click still opens it directly. Outside a caret host the
 * hook is a documented no-op, so a caller never has to know its surface.
 */
export function AttachmentUpload({
  accept,
  label,
  icon,
  isFocused,
  onUploaded,
}: {
  accept: string;
  label: string;
  icon: IconRef;
  /**
   * Does the editor's caret sit on this block? Arms the dropzone's window
   * `paste` listener — BEHAVIOUR (Cmd+V into an empty media block fills it),
   * not a cue — so at most one block's listener is live.
   */
  isFocused: boolean;
  onUploaded: (res: UploadedAttachment) => void;
}) {
  const dropzone = useRef<UploadDropzoneHandle>(null);
  useBlockActivate(() => dropzone.current?.openPicker());
  return (
    <UploadDropzone
      handleRef={dropzone}
      accept={accept}
      label={label}
      icon={icon}
      pasteArmed={isFocused}
      onUploaded={onUploaded}
    />
  );
}
