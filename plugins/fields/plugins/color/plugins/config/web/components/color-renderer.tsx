import {
  defineFieldShape,
  useLocalValue,
} from "@plugins/config_v2/plugins/fields/web";
import { colorFieldType } from "@plugins/fields/plugins/color/core";
import { Color } from "@plugins/primitives/plugins/css/plugins/color-picker/core";
import { ColorPickerPopover } from "@plugins/primitives/plugins/css/plugins/color-picker/web";
import { useControlPanelLayout } from "@plugins/primitives/plugins/css/plugins/control-panel/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Input } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { transient } from "@plugins/primitives/plugins/kept-state/core";
import type { ColorFieldDef } from "../../core";

/**
 * The colour's well (the picker's trigger). In a form, its value as text
 * beside it, so a colour can be read and pasted as well as picked; the text
 * commits on blur when the picker's own parser reads it (hex, rgb, hsl,
 * oklch — never a keyword or a `var()` the well could not draw), otherwise it
 * goes back to the stored value. In a menu row the well alone, as before.
 */
const ColorRenderer = defineFieldShape({
  type: colorFieldType,
  useShape: ({ field, value, onChange }) => {
    const { swatches, showAlpha } = field as ColorFieldDef;
    const { local, setLocal, focus } = useLocalValue(value);
    const form = useControlPanelLayout() === "form";
    const well = (
      <ColorPickerPopover
        value={value}
        onChange={onChange}
        swatches={swatches as string[] | undefined}
        showAlpha={showAlpha}
      />
    );
    if (!form) return { kind: "value", fit: "inline", control: well };
    return {
      kind: "value",
      fit: "inline",
      control: (
        <Stack direction="row" align="center" gap="xs">
          {well}
          <Input
            keep={transient(
              "a colour committed on blur: a half-typed one is cheap to retype",
            )}
            aria-label={`${field.meta.label ?? "Colour"} value`}
            value={local}
            spellCheck={false}
            onFocus={focus.onFocus}
            onChange={(e) => setLocal(e.target.value)}
            onBlur={() => {
              focus.onBlur();
              const next = local.trim();
              if (next !== value && Color.fromCss(next) !== null)
                onChange(next);
              else setLocal(value);
            }}
            className="w-36 font-mono"
          />
        </Stack>
      ),
    };
  },
});

export { ColorRenderer };
