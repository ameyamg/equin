import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { ControlPanel } from "../internal/namespace";
import { ControlPanelForm } from "../internal/control-panel-form";
import { ControlPanelPane } from "../internal/control-panel-pane";

afterEach(cleanup);

// The form surface is the fourth surface: the members draw the form
// construction there (label over description | control), and nowhere else.
describe("ControlPanelForm — the form construction", () => {
  it("draws a Setting as a form row, its description under the label", () => {
    render(
      <ControlPanelForm label="Form">
        <ControlPanel.Setting
          label="Display name"
          description="Shown in the sidebar."
          fit="field"
          control={<input aria-label="name" />}
        />
      </ControlPanelForm>,
    );
    const row = screen.getByText("Display name").closest(".cp-form-row");
    expect(row).not.toBeNull();
    const label = row!.querySelector('[data-cp-cell="label"]')!;
    expect(label.textContent).toContain("Shown in the sidebar.");
    // The control cell is a group named by the label and described by the
    // description, so the control is announced with the field's name.
    const group = screen.getByRole("group", { name: "Display name" });
    expect(group.contains(screen.getByLabelText("name"))).toBe(true);
    expect(group.getAttribute("aria-describedby")).not.toBeNull();
    expect(
      document.getElementById(group.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toBe("Shown in the sidebar.");
    // A top-level field is its own band, so the hairline falls between fields.
    expect(row!.closest(".cp-band")).not.toBeNull();
  });

  it("draws the same Setting as a menu row in a pane", () => {
    render(
      <ControlPanelPane label="Pane">
        <ControlPanel.Setting
          label="Display name"
          fit="field"
          control={<input aria-label="name" />}
        />
      </ControlPanelPane>,
    );
    const label = screen.getByText("Display name");
    expect(label.closest(".cp-setting")).not.toBeNull();
    expect(label.closest(".cp-form-row")).toBeNull();
  });

  it("puts a Group's fields in ONE box, with no band inside it", () => {
    render(
      <ControlPanelForm label="Form">
        <ControlPanel.Group label="Window size" description="Of a new window.">
          <ControlPanel.Setting
            label="Width"
            fit="inline"
            control={<input aria-label="w" />}
          />
          <ControlPanel.Setting
            label="Height"
            fit="inline"
            control={<input aria-label="h" />}
          />
        </ControlPanel.Group>
      </ControlPanelForm>,
    );
    const boxes = document.querySelectorAll(".cp-form-box");
    expect(boxes.length).toBe(1);
    const box = boxes[0]!;
    expect(box.textContent).toContain("Width");
    expect(box.textContent).toContain("Height");
    expect(box.querySelector(".cp-band")).toBeNull();
    expect(box.textContent).not.toContain("Window size");
  });

  it("draws a list's items as their own boxes, the header inside each", () => {
    const remove = vi.fn();
    render(
      <ControlPanelForm label="Form">
        <ControlPanel.Group label="Templates" holds="items">
          {["Review diff", "Write a plan"].map((title) => (
            <ControlPanel.Group
              key={title}
              item
              label={title}
              actions={
                <button type="button" onClick={remove}>
                  Remove
                </button>
              }
            >
              <ControlPanel.Setting
                label="Title"
                fit="field"
                control={<input aria-label={title} />}
              />
            </ControlPanel.Group>
          ))}
        </ControlPanel.Group>
      </ControlPanelForm>,
    );
    const items = document.querySelectorAll(".cp-form-box[data-cp-item]");
    expect(items.length).toBe(2);
    expect(document.querySelectorAll(".cp-form-box").length).toBe(2);
    expect(items[0]!.textContent).toContain("Review diff");
    expect(items[0]!.querySelector("button")?.textContent).toBe("Remove");
  });

  it("refuses a drag handle on a form Setting (an item's box carries it)", () => {
    expect(() =>
      render(
        <ControlPanelForm label="Form">
          <ControlPanel.Setting
            label="Line"
            fit="field"
            handle
            control={<input aria-label="line" />}
          />
        </ControlPanelForm>,
      ),
    ).toThrow(/Group item/);
  });
});
