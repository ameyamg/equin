import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";

export { MultiSelectProvider } from "./internal/multi-select-provider";
export type { MultiSelectProviderProps } from "./internal/multi-select-provider";
export { useMultiSelect } from "./internal/use-multi-select";
export type { MultiSelectHandle } from "./internal/use-multi-select";
export { useMultiSelectItem } from "./internal/use-multi-select-item";
export type { MultiSelectItemHandle } from "./internal/use-multi-select-item";
export { SelectionBar } from "./internal/selection-bar";
export type { SelectionBarProps } from "./internal/selection-bar";
export { SelectionCheckbox } from "./internal/selection-checkbox";
export type { SelectionCheckboxProps } from "./internal/selection-checkbox";
export { SelectionBox } from "./internal/selection-box";
export type { SelectionBoxProps } from "./internal/selection-box";
export { useClearOnEscape } from "./internal/use-clear-on-escape";

export default {
  description:
    "Checkbox multi-select primitive: provider, hooks, the drawn SelectionBox, Escape-to-clear, and the SelectionBar (a top strip or a bottom pill) for list plugins.",
  contributions: [],
} satisfies PluginDefinition;
