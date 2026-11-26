import { defineFieldShape } from "@plugins/config_v2/plugins/fields/web";
import { dynamicFlagsFieldType } from "@plugins/fields/plugins/dynamic-flags/core";
import { useControlPanelLayout } from "@plugins/primitives/plugins/css/plugins/control-panel/web";
import { DynamicFlagsControl } from "./dynamic-flags-control";

/**
 * Not a `choice`: the options come from a contributed hook that only exists
 * once a contribution matches, which `useShape` cannot call conditionally (see
 * `DynamicFlagsControl`). In a FORM the chips sit in the control column beside
 * the label, like a `tags` field's (a `value`, tinted pills); elsewhere a set
 * of switches is wider than a menu row, so it is a `block` of ghost chips.
 */
const DynamicFlagsRenderer = defineFieldShape({
  type: dynamicFlagsFieldType,
  useShape: ({ field, value, onChange }) => {
    const form = useControlPanelLayout() === "form";
    const control = (
      <DynamicFlagsControl
        field={field}
        value={value}
        onChange={onChange}
        chip={form ? "tinted" : "ghost"}
      />
    );
    return form
      ? { kind: "value", fit: "field", control }
      : { kind: "block", control };
  },
});

export { DynamicFlagsRenderer };
