import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactElement } from "react";
import {
  PluginProvider,
  type LoadedPlugin,
} from "@plugins/framework/plugins/web-sdk/core";
import { Fields, FieldsForm } from "@plugins/config_v2/plugins/fields/web";
import { stringListField } from "../../core";
import stringListConfigPlugin from "../index";

/**
 * The string-list control in a FORM (one input per line). Its stored value
 * comes back a round trip after each edit, so the lines must stay right in
 * between: the parent here applies `onChange` only when the test says so.
 */

const plugins = [
  {
    id: "config-v2-fields-test",
    description: "slot owner",
    contributions: [],
    slots: Fields,
  },
  { id: "fields/string-list/config", ...stringListConfigPlugin },
] as unknown as LoadedPlugin[];

const fields = { paths: stringListField({ label: "Ignored paths" }) };

function mount(initial: string[]) {
  const onChange = vi.fn();
  const ui = (paths: string[]): ReactElement => (
    <PluginProvider plugins={plugins}>
      <FieldsForm
        fields={fields}
        values={{ paths }}
        onChange={(_key, value) => onChange(value)}
      />
    </PluginProvider>
  );
  const view = render(ui(initial));
  return { onChange, arrive: (paths: string[]) => view.rerender(ui(paths)) };
}

const lineValues = () =>
  screen.getAllByRole("textbox").map((el) => (el as HTMLInputElement).value);

afterEach(cleanup);

describe("string-list in a form", () => {
  it("Backspace in an empty line removes it, and nothing is overwritten when the value arrives", () => {
    const { onChange, arrive } = mount(["", "foo"]);
    const first = screen.getByLabelText("Line 1");
    act(() => first.focus());
    fireEvent.keyDown(first, { key: "Backspace" });
    expect(onChange).toHaveBeenLastCalledWith(["foo"]);
    // Before the round trip: the remaining line shows its own text.
    expect(lineValues()).toEqual(["foo"]);
    arrive(["foo"]);
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(lineValues()).toEqual(["foo"]);
  });

  it("Enter opens an empty line under the current one", () => {
    const { onChange, arrive } = mount(["a", "b"]);
    const first = screen.getByLabelText("Line 1");
    act(() => first.focus());
    fireEvent.keyDown(first, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(["a", "", "b"]);
    expect(lineValues()).toEqual(["a", "", "b"]);
    arrive(["a", "", "b"]);
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(lineValues()).toEqual(["a", "", "b"]);
  });

  it("an edit from outside replaces the lines", () => {
    const { arrive } = mount(["a"]);
    arrive(["x", "y"]);
    expect(lineValues()).toEqual(["x", "y"]);
  });
});
