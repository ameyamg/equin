import {
  defineFieldShape,
  useLocalValue,
} from "@plugins/config_v2/plugins/fields/web";
import { jsonFieldType } from "@plugins/fields/plugins/json/core";
import { useControlPanelLayout } from "@plugins/primitives/plugins/css/plugins/control-panel/web";
import { Scroll } from "@plugins/primitives/plugins/css/plugins/scroll/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Surface } from "@plugins/primitives/plugins/css/plugins/surface/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Textarea } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { transient } from "@plugins/primitives/plugins/kept-state/core";
import { useId, useState } from "react";

/**
 * The formatted JSON — wider than a row, hence a `block`.
 *
 * In a FORM (`ControlPanelForm`, the settings pane) an editable monospace box:
 * a `jsonField`'s value is mostly app-written (a data-view's saved state), so
 * the box shows it exactly as stored; an edit commits on blur when the text
 * parses, and otherwise stays in the box with the parse error under it — never
 * a silent revert of what was typed. Whether the parsed value fits the
 * config's schema is the write's answer (an invalid document is refused and
 * surfaced by the settings pane), not this box's.
 *
 * Anywhere else (a menu, a pane of rows) the read-only recessed box it always
 * was.
 */
const JsonRenderer = defineFieldShape({
  type: jsonFieldType,
  useShape: ({ field, value, onChange }) => {
    const form = useControlPanelLayout() === "form";
    return {
      kind: "block",
      control: form ? (
        <JsonEditor
          label={field.meta.label ?? "JSON"}
          value={value}
          onChange={onChange}
        />
      ) : (
        <Surface
          level="sunken"
          className="rounded-lg border border-border p-sm"
        >
          <Scroll axis="both" className="max-h-64">
            <Text
              as="pre"
              variant="caption"
              tone="muted"
              className="font-mono whitespace-pre"
            >
              {JSON.stringify(value, null, 2)}
            </Text>
          </Scroll>
        </Surface>
      ),
    };
  },
});

function JsonEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const formatted = JSON.stringify(value, null, 2);
  const { local, setLocal, focus } = useLocalValue(formatted);
  // The parse error belongs to ONE stored value's draft: a new value from
  // outside replaces the draft (`useLocalValue`), so it takes the error too.
  const [error, setError] = useState<{ of: string; message: string } | null>(
    null,
  );
  const shownError = error?.of === formatted ? error.message : null;
  const errorId = useId();
  const lines = formatted.split("\n").length;
  return (
    <Stack gap="2xs">
      <Textarea
        keep={transient(
          "JSON committed on blur; an unparsable draft stays on screen with its error",
        )}
        value={local}
        spellCheck={false}
        rows={Math.min(Math.max(lines, 3), 12)}
        aria-label={label}
        aria-describedby={shownError != null ? errorId : undefined}
        onFocus={focus.onFocus}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          focus.onBlur();
          if (local === formatted) {
            setError(null);
            return;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(local);
          } catch (err) {
            if (!(err instanceof SyntaxError)) throw err;
            setError({ of: formatted, message: err.message });
            return;
          }
          setError(null);
          onChange(parsed);
        }}
        aria-invalid={shownError != null}
        className="font-mono text-caption"
      />
      {shownError != null ? (
        <Text id={errorId} variant="caption" tone="destructive">
          {shownError}
        </Text>
      ) : null}
    </Stack>
  );
}

export { JsonRenderer };
