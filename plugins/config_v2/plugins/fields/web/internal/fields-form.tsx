import type { ReactElement } from "react";
import type { FieldsRecord } from "@plugins/fields/core";
import { ControlPanelPane } from "@plugins/primitives/plugins/css/plugins/control-panel/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { FieldRenderer } from "./field-renderer";

export interface FieldsFormProps {
  /** The record to render, verbatim (a source type's `configFields`, a feed's item fields, …). */
  fields: FieldsRecord;
  /** Current value per field key (already resolved by the caller). */
  values: Record<string, unknown>;
  /** Called with ONE key's new value; the caller owns merging + persistence. */
  onChange: (key: string, value: unknown) => void;
  /** Shown when the record is empty. An empty record is legitimate. */
  emptyLabel?: string;
}

/**
 * A whole form rendered from ANY `FieldsRecord`, through the same
 * `FieldRenderer` dispatch `config_v2`'s settings pane uses: a source type's
 * config in the Events app, a feed's item in the Deploy app, anything whose
 * shape is declared as fields.
 *
 * This file must stay generic: it never names a field type id and never
 * branches on a record's owner. A new field type registers its renderer and
 * every form gets it for free; a new consumer declares its fields and gets a
 * working form with zero form code. The moment this file names a type id (or
 * a consumer's record), that promise is gone — a consumer needing bespoke
 * chrome renders it beside the form.
 *
 * Each renderer owns its own commit granularity (the text renderer commits on
 * blur, not per keystroke), so `onChange` fires at field-edit frequency and is
 * safe to wire straight to an autosave PATCH.
 *
 * The form IS a control panel, so it is one: `ControlPanelPane` publishes the
 * panel body (and with it the rail, the row height and the hairlines between
 * bands), the panel stack a nested group needs, and the host policy every field
 * reads — inline the first level of nesting, and keep descriptions visible on
 * the band rather than behind a hover.
 */
export function FieldsForm({
  fields,
  values,
  onChange,
  emptyLabel = "Nothing to configure.",
}: FieldsFormProps): ReactElement {
  const entries = Object.entries(fields);

  if (entries.length === 0) {
    return (
      <Text as="p" variant="body" tone="muted">
        {emptyLabel}
      </Text>
    );
  }

  return (
    <ControlPanelPane>
      {entries.map(([key, field]) => (
        <FieldRenderer
          key={key}
          field={field}
          value={values[key]}
          onChange={(value) => onChange(key, value)}
        />
      ))}
    </ControlPanelPane>
  );
}
