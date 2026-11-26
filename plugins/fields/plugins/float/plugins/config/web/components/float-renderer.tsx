import {
  defineFieldShape,
  NumberControl,
  useLocalValue,
  useNumberFit,
} from "@plugins/config_v2/plugins/fields/web";
import { floatFieldType } from "@plugins/fields/plugins/float/core";
import { type FloatFieldDef } from "../../core";

const FloatRenderer = defineFieldShape({
  type: floatFieldType,
  useShape: ({ field, value, onChange }) => {
    const { min, max, step } = field as FloatFieldDef;
    const { local, setLocal, focus } = useLocalValue(String(value));
    const fit = useNumberFit();
    return {
      kind: "value",
      fit,
      control: (
        <NumberControl
          keepReason={
            "a number committed on blur: a half-typed one is harmless to lose"
          }
          value={local}
          min={min}
          max={max}
          step={step ?? "any"}
          onFocus={focus.onFocus}
          onBlur={() => {
            focus.onBlur();
            const n = Number(local);
            if (Number.isFinite(n) && n !== value) onChange(n);
            else setLocal(String(value));
          }}
          onChange={setLocal}
        />
      ),
    };
  },
});

export { FloatRenderer };
