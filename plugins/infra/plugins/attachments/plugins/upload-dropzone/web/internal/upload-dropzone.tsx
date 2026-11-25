import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import { Icon } from "@plugins/ui/plugins/icons/web";
import type { IconRef } from "@plugins/ui/plugins/icons/core";
import { cn } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Placeholder } from "@plugins/primitives/plugins/css/plugins/placeholder/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import {
  uploadAttachment,
  type UploadedAttachment,
} from "@plugins/infra/plugins/attachments/web";
import { ATTACHMENT_DEFAULT_MAX_BYTES } from "@plugins/infra/plugins/attachments/core";
import {
  useFetchEndpoint,
  type FetchEndpoint,
} from "@plugins/infra/plugins/endpoints/web";
import { inputAccept, matchesAccept, type UploadAccept } from "./accept";

/** What a host drives a dropzone with: the file picker, as its own action. */
export interface UploadDropzoneHandle {
  /** Open the file picker (a no-op while an upload runs). */
  openPicker(): void;
}

export interface UploadDropzoneProps {
  accept: UploadAccept;
  label: string;
  icon: IconRef;
  /** Take several files at once (picker, drop, paste); each is uploaded in turn. */
  multiple?: boolean;
  /** The bound per file, sent with the upload; default ATTACHMENT_DEFAULT_MAX_BYTES. */
  maxBytes?: number;
  /**
   * With `multiple`: take at most this many files at once (the room a host
   * has left — a media field's `max`). More is refused before any upload, so
   * nothing is uploaded that the host would have to drop.
   */
  maxFiles?: number;
  /**
   * Arm the window `paste` listener: Cmd+V uploads the clipboard's files.
   * The host decides when (a page block: while the caret is on it), so at
   * most one dropzone answers a paste.
   */
  pasteArmed: boolean;
  /** One call per uploaded file, in order. The host persists it. */
  onUploaded: (res: UploadedAttachment) => void;
  /** The host's handle on the picker (a page block's Enter / Space). */
  handleRef?: Ref<UploadDropzoneHandle>;
}

/**
 * Upload `files` one after another, handing each result over as it lands.
 * The first failure stops the rest and is answered as the message to show
 * (`null`: every file uploaded). Module-level: the component calls it, so the
 * React Compiler never meets the try/catch.
 */
async function uploadInTurn(
  fetchEndpoint: FetchEndpoint,
  files: readonly File[],
  maxBytes: number,
  onUploaded: (res: UploadedAttachment) => void,
  onProgress: (done: number) => void,
): Promise<string | null> {
  for (const [i, file] of files.entries()) {
    onProgress(i);
    let res: UploadedAttachment;
    try {
      res = await uploadAttachment(
        fetchEndpoint,
        file,
        file.name || "file",
        file.type,
        { maxBytes },
      );
    } catch (e) {
      // Fail loud — surface the upload error, never swallow it.
      return `${file.name}: ${e instanceof Error ? e.message : String(e)}`;
    }
    onUploaded(res);
  }
  return null;
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * The upload funnel: click, drop or paste files into the attachments store.
 * Validates each file's mime against `accept` and its size against `maxBytes`
 * before uploading, shows the uploading / error state, and hands each result
 * to the host. It owns no focus and no keyboard: a host that has a keyboard
 * action for it (a page block's Enter / Space) calls `handleRef.openPicker()`.
 */
export function UploadDropzone({
  accept,
  label,
  icon,
  multiple = false,
  maxBytes = ATTACHMENT_DEFAULT_MAX_BYTES,
  maxFiles,
  pasteArmed,
  onUploaded,
  handleRef,
}: UploadDropzoneProps) {
  const fetchEndpoint = useFetchEndpoint();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const uploading = progress !== null;

  useImperativeHandle(
    handleRef,
    () => ({
      openPicker() {
        if (!uploading) inputRef.current?.click();
      },
    }),
    [uploading],
  );

  // Funnel for all three inputs (picker / drop / paste). Every file is checked
  // before the first upload starts, so a refused file uploads nothing.
  const ingest = useCallback(
    async (files: readonly File[]) => {
      const taken = multiple ? files : files.slice(0, 1);
      if (taken.length === 0) return;
      if (maxFiles !== undefined && taken.length > maxFiles) {
        setError(`${taken.length} files given, room for ${maxFiles} more.`);
        return;
      }
      const refused = taken.find((f) => !matchesAccept(accept, f.type));
      if (refused) {
        setError(`Unsupported file type: ${refused.name}`);
        return;
      }
      const tooLarge = taken.find((f) => f.size > maxBytes);
      if (tooLarge) {
        setError(`${tooLarge.name} is too large (max ${megabytes(maxBytes)}).`);
        return;
      }
      setError(null);
      const failure = await uploadInTurn(
        fetchEndpoint,
        taken,
        maxBytes,
        onUploaded,
        (done) => setProgress({ done, of: taken.length }),
      );
      setProgress(null);
      setError(failure);
    },
    [accept, multiple, maxBytes, maxFiles, onUploaded, fetchEndpoint],
  );

  useEffect(() => {
    if (!pasteArmed) return;
    function onPaste(e: ClipboardEvent) {
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((it) => it.kind === "file" && matchesAccept(accept, it.type))
        .map((it) => it.getAsFile())
        .filter((f): f is File => f !== null);
      if (files.length === 0) return;
      e.preventDefault();
      // One file: prefer a PNG (a screenshot pastes as several renditions).
      const picked = multiple
        ? files
        : [files.find((f) => f.type === "image/png") ?? files[0]!];
      void ingest(picked);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [pasteArmed, accept, multiple, ingest]);

  const status =
    progress === null
      ? label
      : progress.of === 1
        ? "Uploading…"
        : `Uploading ${progress.done + 1} of ${progress.of}…`;

  return (
    <div className="px-md py-xs">
      <input
        ref={inputRef}
        type="file"
        accept={inputAccept(accept)}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // Reset so the same file can be re-selected later.
          e.target.value = "";
          void ingest(files);
        }}
      />
      {error ? <Placeholder tone="error">{error}</Placeholder> : null}
      <Stack
        as="div"
        direction="row"
        align="center"
        gap="sm"
        onClick={() => {
          if (!uploading) inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          // Claim the drag: the dropzone takes the files in place, so the event
          // must not bubble to a container's own drop handler (a page editor
          // would otherwise also create a new attachment block alongside).
          e.stopPropagation();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          void ingest(Array.from(e.dataTransfer.files ?? []));
        }}
        className={cn(
          "cursor-pointer rounded-md border border-dashed border-border px-md py-lg text-body text-muted-foreground transition-colors hover:bg-muted",
          dragOver && "border-primary bg-muted",
        )}
      >
        <Icon icon={icon} className="size-4" />
        <span>{status}</span>
      </Stack>
    </div>
  );
}
