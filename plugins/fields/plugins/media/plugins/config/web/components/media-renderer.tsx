import { useRef, useState, type ReactElement } from "react";
import { defineFieldShape } from "@plugins/config_v2/plugins/fields/web";
import {
  mediaFieldDefOf,
  mediaFieldType,
  type MediaFieldDef,
  type MediaRef,
} from "@plugins/fields/plugins/media/core";
import {
  MediaThumb,
  type MediaMetadata,
} from "@plugins/fields/plugins/media/web";
import {
  holdAttachments,
  type UploadedAttachment,
} from "@plugins/infra/plugins/attachments/web";
import { UploadDropzone } from "@plugins/infra/plugins/attachments/plugins/upload-dropzone/web";
import { useFetchEndpoint } from "@plugins/infra/plugins/endpoints/web";
import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import { useLatestRef } from "@plugins/primitives/plugins/latest-ref/web";
import { Pin } from "@plugins/primitives/plugins/css/plugins/pin/web";
import {
  hoverRevealGroup,
  hoverRevealTarget,
} from "@plugins/primitives/plugins/hover-reveal/web";
import { Placeholder } from "@plugins/primitives/plugins/css/plugins/placeholder/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import {
  arrayMove,
  rectSortingStrategy,
  SortableItem,
  SortableList,
} from "@plugins/primitives/plugins/sortable-list/web";
import { symbol } from "@plugins/ui/plugins/icons/core";

const uploadIcon = symbol("photo-library");
const removeIcon = symbol("close");

/**
 * How long an upload is kept alive before its owner links it: a day. The
 * owner links on save (`mediaAttachmentIds` → its `Attachments.defineLink`);
 * the hold only bridges the moment between the upload and that save, so the
 * orphan sweep cannot reap a file the form already shows.
 */
const HOLD_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * A media field: its files as a row of reorderable thumbnails (drag to
 * reorder, × to remove), then the dropzone while there is room (`max`). Too
 * wide for a row, hence a `block`. Everything lives in {@link MediaEditor},
 * a component, because it holds per-mount state (the hold's holder).
 */
const MediaRenderer = defineFieldShape({
  type: mediaFieldType,
  useShape: ({ field, value, onChange }) => ({
    kind: "block",
    control: (
      <MediaEditor
        field={mediaFieldDefOf(field)}
        value={value}
        onChange={onChange}
      />
    ),
  }),
});

/** Keep a metadata reading only where it is a value the ref schema accepts. */
function usableMetadata(meta: MediaMetadata): Partial<MediaRef> {
  const positive = (n: number | undefined) =>
    n !== undefined && Number.isInteger(n) && n > 0 ? n : undefined;
  const width = positive(meta.width);
  const height = positive(meta.height);
  const durationMs =
    meta.durationMs !== undefined && meta.durationMs >= 0
      ? meta.durationMs
      : undefined;
  return {
    ...(width !== undefined && { width }),
    ...(height !== undefined && { height }),
    ...(durationMs !== undefined && { durationMs }),
  };
}

function MediaEditor({
  field,
  value,
  onChange,
}: {
  field: MediaFieldDef;
  value: MediaRef[];
  onChange: (next: MediaRef[]) => void;
}): ReactElement {
  const fetchEndpoint = useFetchEndpoint();
  // One holder per mount: the uploads this editor made and its owner has not
  // linked yet. A hold replaces the holder's set, so the whole set is sent.
  const [holder] = useState(() => `fields.media:${crypto.randomUUID()}`);
  const heldRef = useRef<readonly string[]>([]);
  const [holdError, setHoldError] = useState<string | null>(null);
  // The dropzone calls `onUploaded` once per file from one async loop, so a
  // second file must build on the first's result, not on this render's value.
  // `committedRef` remembers the last commit and the value it was built on:
  // while the host has not re-rendered with it yet (the same base still in
  // `valueRef`), it is the latest value.
  const valueRef = useLatestRef(value);
  const committedRef = useRef<{
    base: MediaRef[];
    next: MediaRef[];
  } | null>(null);
  const latest = (): MediaRef[] => {
    const committed = committedRef.current;
    return committed !== null && committed.base === valueRef.current
      ? committed.next
      : valueRef.current;
  };
  const commit = (next: MediaRef[]) => {
    committedRef.current = { base: valueRef.current, next };
    onChange(next);
  };

  const onUploaded = (res: UploadedAttachment) => {
    commit([
      ...latest(),
      {
        attachmentId: res.id,
        mime: res.mime,
        filename: res.filename,
        size: res.size,
      },
    ]);
    const nextHeld = [...heldRef.current, res.id];
    heldRef.current = nextHeld;
    void holdAttachments(fetchEndpoint, holder, nextHeld, HOLD_TTL_MS).then(
      () => setHoldError(null),
      (err: unknown) =>
        setHoldError(
          `Could not keep ${res.filename} until saved: ${err instanceof Error ? err.message : String(err)}`,
        ),
    );
  };

  // Width / height / length, read by the thumbnail's own load: patched into a
  // ref that lacks them, once.
  const onMetadata = (id: string, meta: MediaMetadata) => {
    const patch = usableMetadata(meta);
    const current = latest();
    const ref = current.find((r) => r.attachmentId === id);
    if (ref === undefined) return;
    const missing = (Object.keys(patch) as (keyof MediaRef)[]).some(
      (k) => ref[k] === undefined,
    );
    if (!missing) return;
    commit(
      current.map((r) => (r.attachmentId === id ? { ...patch, ...r } : r)),
    );
  };

  const room = field.max === undefined ? undefined : field.max - value.length;
  const ids = value.map((r) => r.attachmentId);

  return (
    <Stack gap="sm">
      {value.length > 0 ? (
        <SortableList
          items={ids}
          strategy={rectSortingStrategy}
          onMove={(activeId, overId) => {
            const from = ids.indexOf(activeId);
            const to = ids.indexOf(overId);
            if (from < 0 || to < 0 || from === to) return;
            commit(arrayMove(value, from, to));
          }}
        >
          <Stack direction="row" wrap gap="sm" data-testid="media-thumbs">
            {value.map((ref) => (
              <SortableItem
                key={ref.attachmentId}
                id={ref.attachmentId}
                className={`${hoverRevealGroup} relative`}
              >
                {() => (
                  <>
                    <MediaThumb
                      media={ref}
                      onMetadata={(meta) => onMetadata(ref.attachmentId, meta)}
                    />
                    <Pin to="top-right" className={hoverRevealTarget}>
                      <IconButton
                        icon={removeIcon}
                        label={`Remove ${ref.filename}`}
                        glyph="small"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() =>
                          commit(
                            latest().filter(
                              (r) => r.attachmentId !== ref.attachmentId,
                            ),
                          )
                        }
                      />
                    </Pin>
                  </>
                )}
              </SortableItem>
            ))}
          </Stack>
        </SortableList>
      ) : null}
      {room === undefined || room > 0 ? (
        <UploadDropzone
          accept={field.accept}
          label={room === 1 ? "Add a file" : "Add files"}
          icon={uploadIcon}
          multiple={room === undefined || room > 1}
          maxFiles={room}
          maxBytes={field.maxBytes}
          focus={{ owner: "self" }}
          onUploaded={onUploaded}
        />
      ) : null}
      {holdError !== null ? (
        <Placeholder tone="error">{holdError}</Placeholder>
      ) : null}
    </Stack>
  );
}

export { MediaRenderer };
