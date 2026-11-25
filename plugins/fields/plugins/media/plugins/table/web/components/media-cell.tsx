import type { ReactNode } from "react";
import { z } from "zod";
import {
  MediaRefSchema,
  type MediaRef,
} from "@plugins/fields/plugins/media/core";
import { MediaThumb } from "@plugins/fields/plugins/media/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import type {
  FieldDef,
  TableCellProps,
} from "@plugins/primitives/plugins/data-view/web";

const RefsSchema = z.array(MediaRefSchema);

/** Thrown when a media cell's `data` is not a `MediaRef[]`. */
export class MediaCellDataError extends Error {
  override name = "MediaCellDataError";
  constructor(field: FieldDef<unknown>, issue: string) {
    super(
      `media cell: field "${field.id}" projected \`data\` that is not a MediaRef[] — ${issue}`,
    );
  }
}

/**
 * Read-only media cell: the first file's thumbnail and, after it, `+N` for the
 * rest. The refs are the field's `data` projection (`mediaFieldDef`), parsed
 * — a wrong payload throws rather than drawing an empty cell.
 */
export function MediaCell(props: TableCellProps): ReactNode {
  const parsed = RefsSchema.safeParse(props.data);
  if (!parsed.success) {
    throw new MediaCellDataError(
      props.field,
      parsed.error.issues[0]?.message ?? "invalid",
    );
  }
  const [first, ...rest] = parsed.data;
  if (first === undefined) return null;
  return (
    <Stack direction="row" align="center" gap="xs">
      <MediaThumb media={first} className="size-8" />
      {rest.length > 0 ? (
        <Text as="span" variant="caption" tone="muted">
          +{rest.length}
        </Text>
      ) : null}
    </Stack>
  );
}

export interface MediaFieldDefOptions<TRow> {
  id: string;
  label: string;
  /** The row's files — becomes the field's `data` projection. */
  media: (row: TRow) => readonly MediaRef[];
  visible?: boolean;
}

/**
 * The one typed spelling for a media DataView field: `type: "media"` with
 * `media` wired as `data`, so a wrong payload is a type error here rather
 * than a {@link MediaCellDataError} at render.
 */
export function mediaFieldDef<TRow>(
  def: MediaFieldDefOptions<TRow>,
): FieldDef<TRow> {
  return {
    id: def.id,
    label: def.label,
    type: "media",
    data: def.media,
    ...(def.visible !== undefined && { visible: def.visible }),
  };
}
