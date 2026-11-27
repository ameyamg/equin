import {
  ConfigFieldContext,
  defineFieldShape,
} from "@plugins/config_v2/plugins/fields/web";
import { useContext } from "react";
import { transient } from "@plugins/primitives/plugins/kept-state/core";
import { useEditableField } from "@plugins/primitives/plugins/editable-field/web";
import { Textarea } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { formattedTextFieldType } from "@plugins/fields/plugins/formatted-text/core";
import { FormattedTextView } from "@plugins/fields/plugins/formatted-text/web";
import { type FormattedTextFieldDef } from "../../core";

/** The syntax, in one line under the textarea: what a writer needs to know. */
const SYNTAX_HINT =
  "**bold** · <kbd>⌘</kbd> for a key · [text](https://…) for a link · a new line breaks the line";

/**
 * The source in a textarea (debounced autosave, flushed on blur, like every
 * text field), the syntax under it, then the text as it will read — drawn by
 * the same `FormattedTextView` every surface uses, from the draft as typed.
 */
const FormattedTextRenderer = defineFieldShape({
  type: formattedTextFieldType,
  useShape: ({ field, value, onChange }) => {
    const ctx = useContext(ConfigFieldContext);
    const draft = useEditableField({
      value,
      onSave: onChange,
      label: field.meta.label,
      keep: ctx
        ? {
            field: "fields.config-formatted-text",
            subject: `${ctx.storePath}|${ctx.fieldKey}|${field.meta.label ?? ""}`,
          }
        : transient("no config field around it: the host form owns the value"),
    });
    const rows = (field as FormattedTextFieldDef).rows ?? 4;
    return {
      kind: "block",
      control: (
        <Stack gap="xs">
          <Textarea
            bare
            keep={draft.keep}
            rows={rows}
            placeholder={field.meta.placeholder}
            onFocus={draft.onFocus}
            onBlur={draft.onBlur}
            className="focus-border w-full resize-y rounded-lg border border-input bg-transparent px-sm py-xs font-mono text-body placeholder:text-muted-foreground dark:bg-input/30"
          />
          <Text as="p" variant="caption" tone="muted">
            {SYNTAX_HINT}
          </Text>
          {draft.value !== "" && (
            <FormattedTextView
              as="div"
              source={draft.value}
              className="rounded-lg border border-border px-sm py-xs text-body"
            />
          )}
        </Stack>
      ),
    };
  },
});

export { FormattedTextRenderer };
