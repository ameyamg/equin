import { z } from "zod";
import type { FieldsRecord } from "@plugins/fields/core";
import { mediaFieldType, MediaRefSchema } from "./media";

/** A media field's value is not a list of refs. */
export class MediaValueError extends Error {
  override name = "MediaValueError";
}

const RefsSchema = z.array(MediaRefSchema);

/**
 * Every attachment id the media fields of `fields` hold in `values` — what an
 * owner links its record to (`Attachments.defineLink`) when it saves, so the
 * orphan sweep keeps the files. Generic over the record: it names no consumer
 * and reads only the fields whose type is `media`; other fields are ignored.
 * Top-level fields only (a media field nested in a `group` or `list` is not
 * walked).
 *
 * `values` must be resolved (defaults applied): a media field's value that is
 * missing or not a list of refs throws a {@link MediaValueError}, never reads
 * as "no files".
 */
export function mediaAttachmentIds(
  fields: FieldsRecord,
  values: Readonly<Record<string, unknown>>,
): string[] {
  const ids: string[] = [];
  for (const [key, field] of Object.entries(fields)) {
    if (field.type.id !== mediaFieldType.id) continue;
    const parsed = RefsSchema.safeParse(values[key]);
    if (!parsed.success) {
      throw new MediaValueError(
        `media field "${key}": value is not a MediaRef[] — ${parsed.error.issues[0]?.message ?? "invalid"}`,
      );
    }
    for (const ref of parsed.data) ids.push(ref.attachmentId);
  }
  return ids;
}
