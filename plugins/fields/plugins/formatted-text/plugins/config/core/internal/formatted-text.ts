import { z } from "zod";
import {
  declaredDefault,
  type FieldDef,
  type ExactOptions,
  type FieldMarks,
  type FieldMeta,
  pickMeta,
} from "@plugins/fields/core";
import { formattedTextFieldType } from "@plugins/fields/plugins/formatted-text/core";

export interface FormattedTextFieldDef extends FieldDef<string> {
  readonly type: typeof formattedTextFieldType;
  readonly rows?: number;
}

type Options = FieldMeta & { default?: string; rows?: number };

/**
 * A formatted text field: its value is the markup source (a string — any
 * string is valid, see the plugin's CLAUDE.md for the syntax), edited as a
 * textarea with the syntax and a live preview. The options mark the field
 * (`FieldMarks`: a declared `default`, a `label`, `filterable: false`).
 */
export function formattedTextField<
  const O extends Options = Record<never, never>,
>(opts?: ExactOptions<O, Options>): FormattedTextFieldDef & FieldMarks<O> {
  return Object.freeze({
    type: formattedTextFieldType,
    schema: z.string(),
    defaultValue: opts?.default ?? "",
    ...declaredDefault(opts),
    meta: pickMeta(opts),
    rows: opts?.rows,
  }) as FormattedTextFieldDef & FieldMarks<O>;
}
