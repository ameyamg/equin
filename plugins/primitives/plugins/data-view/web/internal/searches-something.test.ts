import { describe, expect, it } from "bun:test";
import type { FieldIdentity } from "@plugins/fields/core";
import type { FieldDef } from "../../core";
import { searchesSomething } from "./use-flat-rows";

type Row = { n: number; label: string };

const NO_IDENTITIES: ReadonlyMap<string, FieldIdentity> = new Map();
const number: FieldDef<Row> = {
  id: "n",
  label: "N",
  type: "number",
  value: (r) => r.n,
};
const text: FieldDef<Row> = {
  id: "label",
  label: "Label",
  value: (r) => r.label,
};

const base = {
  controlled: false,
  liveSearchable: undefined,
  searchAccessor: undefined,
  nestsHierarchy: false,
  identities: NO_IDENTITIES,
};

describe("searchesSomething", () => {
  it("is false for an in-memory list of no searchable field", () => {
    expect(searchesSomething<Row>({ ...base, fields: [number] })).toBe(false);
    expect(
      searchesSomething<Row>({
        ...base,
        fields: [{ ...text, filterable: false }, number],
      }),
    ).toBe(false);
  });

  it("is true once a field the search reads is declared", () => {
    expect(searchesSomething<Row>({ ...base, fields: [number, text] })).toBe(
      true,
    );
    expect(
      searchesSomething<Row>({
        ...base,
        fields: [{ ...number, filterable: true }],
      }),
    ).toBe(true);
  });

  it("reads a live source's searchable columns, not the fields", () => {
    expect(
      searchesSomething<Row>({ ...base, liveSearchable: [], fields: [text] }),
    ).toBe(false);
    expect(
      searchesSomething<Row>({
        ...base,
        liveSearchable: ["label"],
        fields: [number],
      }),
    ).toBe(true);
  });

  it("is true for a search accessor, a nested label or a controlled search", () => {
    const fields = [number];
    expect(
      searchesSomething<Row>({
        ...base,
        fields,
        searchAccessor: (r) => r.label,
      }),
    ).toBe(true);
    expect(
      searchesSomething<Row>({ ...base, fields, nestsHierarchy: true }),
    ).toBe(true);
    expect(searchesSomething<Row>({ ...base, fields, controlled: true })).toBe(
      true,
    );
  });
});
