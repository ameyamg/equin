import type { FilterOperatorSet } from "@plugins/primitives/plugins/data-view/web";
import { EnumSingleInput, EnumMultiInput } from "./components/enum-filter";
import { enumLower } from "./internal/enum-lower";

// The type key (`match`) is written at the contribution, where the closure
// engine reads it.
export const enumOperatorSet: Omit<FilterOperatorSet, "match"> = {
  domain: "text",
  defaultOperator: "is",
  operators: [
    {
      id: "is",
      label: "Is",
      hasValue: true,
      ValueInput: EnumSingleInput,
      arity: "one",
      ops: ["eq", "in", "isEmpty"],
      lower: enumLower.is,
    },
    {
      id: "is-not",
      label: "Is not",
      hasValue: true,
      ValueInput: EnumSingleInput,
      arity: "one",
      ops: ["ne", "notIn", "isNotEmpty"],
      lower: enumLower["is-not"],
    },
    {
      id: "is-any-of",
      label: "Is any of",
      hasValue: true,
      ValueInput: EnumMultiInput,
      arity: "many",
      ops: ["eq", "in", "isEmpty"],
      lower: enumLower["is-any-of"],
    },
    {
      id: "is-none-of",
      label: "Is none of",
      hasValue: true,
      ValueInput: EnumMultiInput,
      arity: "many",
      ops: ["ne", "notIn", "isNotEmpty"],
      lower: enumLower["is-none-of"],
    },
    {
      id: "is-empty",
      label: "Is empty",
      hasValue: false,
      ops: ["isEmpty"],
      lower: enumLower["is-empty"],
    },
    {
      id: "is-not-empty",
      label: "Is not empty",
      hasValue: false,
      ops: ["isNotEmpty"],
      lower: enumLower["is-not-empty"],
    },
  ],
};
