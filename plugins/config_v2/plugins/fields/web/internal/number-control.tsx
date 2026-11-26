import { useControlPanelLayout } from "@plugins/primitives/plugins/css/plugins/control-panel/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Input } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { transient } from "@plugins/primitives/plugins/kept-state/core";
import type React from "react";

/**
 * A number field's control. In a FORM (`ControlPanelForm`): a NARROW input with
 * its digits right-aligned (a number is read by its last digit, and a number
 * box the column's width says "type a sentence here"), and its allowed range as
 * a caption under it — so the renderer declares it `fit="inline"` there
 * (`numberFit`). Anywhere else (a menu row in a popover, a pane of rows) the
 * plain field-width input the panel lines up with its other value controls: a
 * caption would make the row two lines tall.
 *
 * The value is the caller's local text (`useLocalValue`): a number commits on
 * blur, so the half-typed one lives here until then.
 */
export function NumberControl({
  value,
  min,
  max,
  step,
  keepReason,
  onChange,
  onFocus,
  onBlur,
}: {
  value: string;
  min?: number;
  max?: number;
  step: number | "any";
  /** Why the half-typed text is not kept across a reload (`transient`). */
  keepReason: string;
  onChange: (text: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}): React.ReactElement {
  const form = useControlPanelLayout() === "form";
  const range = rangeText(min, max);
  if (!form) {
    return (
      <Input
        type="number"
        keep={transient(keepReason)}
        value={value}
        min={min}
        max={max}
        step={step}
        onFocus={onFocus}
        onBlur={onBlur}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <Stack gap="2xs">
      <Input
        type="number"
        keep={transient(keepReason)}
        value={value}
        min={min}
        max={max}
        step={step}
        onFocus={onFocus}
        onBlur={onBlur}
        onChange={(e) => onChange(e.target.value)}
        className="w-28 text-right tabular-nums"
      />
      {range != null ? (
        <Text variant="caption" tone="muted">
          {range}
        </Text>
      ) : null}
    </Stack>
  );
}

/** "1 – 16", "≥ 0", "≤ 100", or nothing when the field is unbounded. */
function rangeText(min?: number, max?: number): string | null {
  if (min !== undefined && max !== undefined) return `${min} – ${max}`;
  if (min !== undefined) return `≥ ${min}`;
  if (max !== undefined) return `≤ ${max}`;
  return null;
}

/** The `fit` a number field declares: its own narrow box in a form, the
 *  panel's field width anywhere else. A hook — it reads the host. */
export function useNumberFit(): "inline" | "field" {
  return useControlPanelLayout() === "form" ? "inline" : "field";
}
