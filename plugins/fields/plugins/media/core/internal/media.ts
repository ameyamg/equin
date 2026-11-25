import { z } from "zod";
import {
  defineFieldIdentity,
  defineFieldType,
  pickMeta,
  type ExactOptions,
  type FieldDef,
  type FieldMarks,
  type FieldMeta,
} from "@plugins/fields/core";
import {
  cappedList,
  wholeList,
} from "@plugins/packages/plugins/list-bound/core";
import { symbol } from "@plugins/ui/plugins/icons/core";

/**
 * One uploaded file a media field holds: the attachment that carries its bytes
 * plus what a surface needs to draw it without fetching them first. `width` /
 * `height` (an image's or a video's pixel size) and `durationMs` (a video's or
 * an audio's length) are read from the file in the browser when cheap, so
 * they are optional — a ref is complete without them.
 */
export const MediaRefSchema = z.object({
  attachmentId: z.string().min(1),
  mime: z.string(),
  filename: z.string(),
  size: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationMs: z.number().nonnegative().optional(),
});
export type MediaRef = z.infer<typeof MediaRefSchema>;

export const mediaFieldType = defineFieldType<MediaRef[]>("media");

// No `coerce`: a set of files has no sortable scalar projection.
export const mediaIdentity = defineFieldIdentity<MediaRef[]>({
  type: mediaFieldType,
  kind: "visual",
  label: "Media",
  icon: symbol("photo-library"),
});

/**
 * What a media field takes: `"*"`, a mime family (`"image/*"`), an exact
 * mime, or several. The same grammar as the upload dropzone's `UploadAccept`
 * (structurally — core cannot name a web type).
 */
export type MediaAccept = string | readonly string[];

export interface MediaFieldDef extends FieldDef<MediaRef[]> {
  readonly type: typeof mediaFieldType;
  readonly accept: MediaAccept;
  /** At most this many files; absent, any number. Enforced by the schema. */
  readonly max?: number;
  /**
   * The bound per file, sent with each upload; absent, the upload's own
   * default (`ATTACHMENT_DEFAULT_MAX_BYTES`, 20 MB). A video field declares
   * more, up to `ATTACHMENT_MAX_BYTES` — which the server enforces.
   */
  readonly maxBytes?: number;
}

/** A field claimed to be a media field is not one (built by another factory). */
export class NotAMediaFieldError extends Error {
  override name = "NotAMediaFieldError";
}

/**
 * The media def behind a `field` whose type is `media` — the renderer's way
 * from the slot's erased `FieldDef<MediaRef[]>` to its `accept` / `max` /
 * `maxBytes`. Throws when the def was not built by {@link mediaField}.
 */
export function mediaFieldDefOf(field: FieldDef<MediaRef[]>): MediaFieldDef {
  if (field.type.id !== mediaFieldType.id || !("accept" in field)) {
    throw new NotAMediaFieldError(
      `field of type "${field.type.id}" was not built by mediaField()`,
    );
  }
  return field as MediaFieldDef;
}

type MediaOptions = FieldMeta & {
  accept: MediaAccept;
  max?: number;
  maxBytes?: number;
};

/** Attachment ids appear once: each ref is its own upload. */
function uniqueIds(refs: readonly MediaRef[]): boolean {
  return new Set(refs.map((r) => r.attachmentId)).size === refs.length;
}

/**
 * A field holding uploaded files — images, videos, anything `accept` admits —
 * as `MediaRef[]` in array order (the order a surface shows them). Its value
 * is the refs, never the bytes: those live in the attachments store, linked to
 * whatever owns the record (see `mediaAttachmentIds`).
 *
 * `max` bounds how many files the field holds (the schema refuses more; the
 * renderer stops taking them); `maxBytes` bounds each file, declared by a
 * field that holds video because it needs more than an upload's 20 MB
 * default (at most `ATTACHMENT_MAX_BYTES`; the server refuses more). It is
 * not read from `infra/attachments` here: that would close an import cycle
 * through the storage capability loader.
 */
export function mediaField<const O extends MediaOptions>(
  opts: ExactOptions<O, MediaOptions>,
): MediaFieldDef & FieldMarks<O> {
  const { max } = opts;
  if (max !== undefined && (!Number.isInteger(max) || max < 1)) {
    throw new RangeError(`mediaField: max must be a positive integer (${max})`);
  }
  const { maxBytes } = opts;
  if (maxBytes !== undefined && (!Number.isInteger(maxBytes) || maxBytes < 1)) {
    throw new RangeError(
      `mediaField: maxBytes must be a positive integer (${maxBytes})`,
    );
  }
  const list =
    max === undefined
      ? wholeList(MediaRefSchema, {
          reason:
            "one record's own files, stored in its column and read with it",
        })
      : cappedList(MediaRefSchema, { max });
  return Object.freeze({
    type: mediaFieldType,
    schema: list.refine(uniqueIds, {
      message: "an attachment appears at most once",
    }),
    defaultValue: [],
    meta: pickMeta(opts),
    accept: typeof opts.accept === "string" ? opts.accept : [...opts.accept],
    ...(max !== undefined ? { max } : {}),
    ...(maxBytes !== undefined ? { maxBytes } : {}),
  }) as MediaFieldDef & FieldMarks<O>;
}
