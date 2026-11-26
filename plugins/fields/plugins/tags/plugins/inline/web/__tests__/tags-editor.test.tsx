/**
 * The standard tags cell editor: the tag picker (read-only) over the field's
 * options — a click toggles a tag, a fixed option is neither offered nor
 * removed, a value no option names is listed (so it can be removed), a
 * dismiss commits the toggled set and Escape cancels.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PluginProvider } from "@plugins/framework/plugins/web-sdk/core";
import type { CellEditorProps } from "@plugins/primitives/plugins/data-view/web";
import { TagsEditor } from "../components/tags-editor";

afterEach(cleanup);

function renderEditor(values: string[]) {
  const onCommitValues = vi.fn();
  const onCancel = vi.fn();
  const props = {
    value: null,
    values,
    field: {
      id: "labels",
      label: "Labels",
      type: "tags",
      options: [
        { value: "work", label: "Work" },
        { value: "clients", label: "Clients", parent: "work" },
        { value: "inbox", label: "Inbox", fixed: true, quiet: true },
      ],
    },
    onCommit: vi.fn(),
    onCommitValues,
    onCancel,
  } as unknown as CellEditorProps;
  render(
    <PluginProvider plugins={[]}>
      <TagsEditor {...props} />
    </PluginProvider>,
  );
  return { onCommitValues, onCancel };
}

describe("TagsEditor", () => {
  it("lists the options as a tree and a value no option names; never a fixed one", () => {
    renderEditor(["inbox", "gone"]);
    expect(screen.getByText("Work")).toBeTruthy();
    expect(screen.getByText("Clients")).toBeTruthy();
    // In the trigger's chips and as a row of its own.
    expect(screen.getAllByText("gone").length).toBe(2);
    expect(screen.queryByText("Inbox")).toBeNull();
  });

  it("a click toggles; dismissing commits the set, the fixed value kept", () => {
    const { onCommitValues } = renderEditor(["inbox", "work"]);
    fireEvent.click(screen.getAllByText("Work").at(-1)!);
    fireEvent.click(screen.getByText("Clients"));
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    fireEvent.click(document.body);
    expect(onCommitValues).toHaveBeenCalledWith(["inbox", "clients"]);
  });

  it("Escape cancels", () => {
    const { onCancel, onCommitValues } = renderEditor(["work"]);
    fireEvent.click(screen.getByText("Clients"));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
    expect(onCommitValues).not.toHaveBeenCalled();
  });
});
