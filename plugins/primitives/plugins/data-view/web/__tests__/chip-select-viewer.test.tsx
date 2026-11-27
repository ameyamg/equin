/**
 * `ChipSelectFilterInput` handed no `onChange` is a viewer (a view's locked
 * rule): its "2 selected" trigger still opens, and the popover lists exactly
 * the selected values — by label — with nothing to toggle or search.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "@plugins/primitives/plugins/log-channels/web",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    clientLog: () => {},
  }),
);

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FieldDef } from "../../core";
import { ChipSelectFilterInput } from "../components/filter/chip-select-filter-input";

afterEach(cleanup);

const field: FieldDef<unknown> = {
  id: "labels",
  label: "Labels",
  type: "tags",
  options: [
    { value: "SPAM", label: "Spam" },
    { value: "TRASH", label: "Trash" },
    { value: "INBOX", label: "Inbox" },
  ],
};

describe("ChipSelectFilterInput without onChange", () => {
  it("opens onto the selected values alone, read-only", () => {
    render(
      <ChipSelectFilterInput
        multiple
        value={["SPAM", "TRASH"]}
        field={field}
      />,
    );
    const trigger = screen.getByRole("button", {
      name: "Select filter values",
    });
    expect(trigger.textContent).toContain("2 selected");
    fireEvent.click(trigger);

    expect(screen.getByText("Spam")).toBeTruthy();
    expect(screen.getByText("Trash")).toBeTruthy();
    // Not a picker: no unselected option, no search, nothing pressable.
    expect(screen.queryByText("Inbox")).toBeNull();
    expect(screen.queryByPlaceholderText("Search…")).toBeNull();
    expect(screen.queryByRole("button", { name: "Spam" })).toBeNull();
    expect(screen.getByText("Read only")).toBeTruthy();
  });
});
