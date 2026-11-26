import { describe, expect, it } from "bun:test";
import { clause } from "@plugins/network/plugins/live/plugins/filter/core";
import {
  defaultOperatorFor,
  isOperatorOffered,
  isRuleActive,
  offeredOperators,
  resolveRuleOperator,
} from "./rule-resolution";
import { applyFilter } from "./evaluate-filter";
import type {
  FieldDef,
  FilterGroup,
  FilterOperatorSet,
  FilterRule,
} from "../../core";

interface Row {
  name: string;
  modified: boolean;
}

const fields: FieldDef<Row>[] = [
  { id: "name", label: "Name", type: "text", value: (r) => r.name },
  { id: "modified", label: "Modified", type: "bool", value: (r) => r.modified },
];

// text "contains" → incomplete without an operand (`lower` answers undefined).
// bool "is" → always complete: an absent value reads as "Unchecked", so the rule
// lowers (and filters) even with no stored value.
const sets: Record<string, FilterOperatorSet> = {
  text: {
    match: "text",
    domain: "text",
    operators: [
      {
        id: "contains",
        label: "Contains",
        hasValue: true,
        ops: ["contains"],
        lower: (op, { column }) =>
          typeof op === "string" && op !== ""
            ? clause(column, "contains", op)
            : undefined,
      },
    ],
  },
  bool: {
    match: "bool",
    domain: "boolean",
    operators: [
      {
        id: "is",
        label: "Is",
        hasValue: true,
        ops: ["eq", "ne"],
        lower: (op, { column }) =>
          op === true ? clause(column, "eq", true) : clause(column, "ne", true),
      },
    ],
  },
};
const resolve = (typeId: string) => sets[typeId];

const rule = (
  fieldId: string,
  operatorId: string,
  value?: unknown,
): FilterRule => ({
  kind: "rule",
  id: `${fieldId}-${operatorId}`,
  fieldId,
  operatorId,
  ...(value === undefined ? {} : { value }),
});

/** Does the one-rule filter keep `row`? */
function keeps(r: FilterRule, row: Row): boolean {
  const g: FilterGroup = {
    kind: "group",
    id: "g",
    conjunction: "and",
    children: [r],
  };
  return applyFilter([row], g, fields, resolve, 0).length === 1;
}

// The regression: count and filter must AGREE for every rule. A value-less bool
// rule both counts and filters; a value-less text rule neither counts nor filters.
// Both now read ONE answer — `lower(...) !== undefined`.
describe("count ⇔ filter parity (the chip-vs-filter bug)", () => {
  const modifiedRow: Row = { name: "preprompts", modified: true };
  const cleanRow: Row = { name: "categorical", modified: false };

  it("value-less bool rule is active AND filters", () => {
    const r = rule("modified", "is"); // no value → "Unchecked"
    expect(isRuleActive(r, fields, resolve)).toBe(true); // chip counts it
    expect(keeps(r, modifiedRow)).toBe(false); // hides modified
    expect(keeps(r, cleanRow)).toBe(true); // keeps clean
  });

  it("value-less text rule is inactive AND no-ops", () => {
    const r = rule("name", "contains"); // no value
    expect(isRuleActive(r, fields, resolve)).toBe(false); // chip ignores it
    expect(keeps(r, modifiedRow)).toBe(true); // no-op
  });

  it("unresolvable rule is inactive AND no-ops", () => {
    const r = rule("nope", "contains", "x");
    expect(isRuleActive(r, fields, resolve)).toBe(false);
    expect(keeps(r, modifiedRow)).toBe(true);
  });
});

describe("operators a field is offered (`FieldDef.filterOps`)", () => {
  const set: FilterOperatorSet = {
    match: "tags",
    domain: "stringArray",
    defaultOperator: "contains",
    operators: [
      {
        id: "contains",
        label: "Contains",
        hasValue: true,
        ops: ["hasAll"],
        lower: () => undefined,
      },
      {
        id: "any",
        label: "Any of",
        hasValue: true,
        ops: ["hasAny"],
        lower: () => undefined,
      },
      {
        id: "empty",
        label: "Is empty",
        hasValue: false,
        ops: ["isEmpty"],
        lower: () => undefined,
      },
    ],
  };

  it("offers every operator without a declaration", () => {
    expect(offeredOperators(set, {}).map((o) => o.id)).toEqual([
      "contains",
      "any",
      "empty",
    ]);
    expect(defaultOperatorFor(set, {})).toBe("contains");
  });

  it("offers only the operators whose ops are all declared", () => {
    const field = { filterOps: ["hasAny", "hasNone"] as const };
    expect(offeredOperators(set, field).map((o) => o.id)).toEqual(["any"]);
    // The set's default is not offered: the first offered one is.
    expect(defaultOperatorFor(set, field)).toBe("any");
    expect(isOperatorOffered(set.operators[2]!, field)).toBe(false);
    expect(defaultOperatorFor(set, { filterOps: ["eq"] })).toBeNull();
  });

  it("makes a saved rule on an operator not offered unresolvable", () => {
    const tagFields: FieldDef<{ tags: string[] }>[] = [
      {
        id: "tags",
        label: "Tags",
        type: "tags",
        filterOps: ["hasAny"],
        values: (r) => r.tags,
      },
    ];
    const r: FilterRule = {
      kind: "rule",
      id: "r",
      fieldId: "tags",
      operatorId: "contains",
      value: ["a"],
    };
    expect(resolveRuleOperator(r, tagFields, () => set)).toBeNull();
    expect(
      resolveRuleOperator({ ...r, operatorId: "any" }, tagFields, () => set),
    ).not.toBeNull();
  });
});
