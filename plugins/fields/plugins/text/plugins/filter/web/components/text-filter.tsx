import type { ReactNode } from "react";
import {
  FilterValueInput,
  type FilterValueInputProps,
} from "@plugins/primitives/plugins/data-view/web";

/** Single text operand input for the text operators (contains / is / …);
 *  without `onChange`, a read-only input (a view's locked rule). */
export function TextValueInput(props: FilterValueInputProps): ReactNode {
  const value = typeof props.value === "string" ? props.value : "";
  const { onChange } = props;
  return (
    <FilterValueInput
      type="text"
      placeholder="Value…"
      value={value}
      {...(onChange === undefined
        ? { readOnly: true }
        : { onChange: (e) => onChange(e.target.value || undefined) })}
    />
  );
}
