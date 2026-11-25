import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useRef, type ReactNode } from "react";
import { WithShortcuts } from "../testing";
import { usePageShortcuts } from "../internal/use-page-shortcuts";
import { isMac } from "../internal/parse-keys";

afterEach(cleanup);

/** A panel binding `keys` to its own region — two of them on one page share the key. */
function Panel({
  name,
  keys,
  pointer,
  onFire,
  idle = false,
  children,
}: {
  name: string;
  keys: string;
  pointer: boolean;
  onFire: (name: string) => void;
  /** Nothing to do with the key (an empty Submit): its `when` says no. */
  idle?: boolean;
  children?: ReactNode;
}) {
  const root = useRef<HTMLDivElement | null>(null);
  usePageShortcuts([
    {
      id: "test.panel-key",
      keys,
      label: "Panel key",
      enableInInputs: true,
      region: { root, pointer },
      when: () => !idle,
      handler: () => onFire(name),
    },
  ]);
  return (
    <div ref={root} data-testid={name}>
      <input data-testid={`${name}-field`} />
      {children}
    </div>
  );
}

const submit = { key: "Enter", [isMac ? "metaKey" : "ctrlKey"]: true };

describe("shortcut regions", () => {
  it("two regions on one page: the one holding focus takes the key", () => {
    const fired = vi.fn();
    const { getByTestId } = render(
      <WithShortcuts>
        <Panel name="a" keys="mod+enter" pointer={false} onFire={fired} />
        <Panel name="b" keys="mod+enter" pointer={false} onFire={fired} />
      </WithShortcuts>,
    );
    fireEvent.keyDown(getByTestId("b-field"), submit);
    expect(fired.mock.calls).toEqual([["b"]]);
    fireEvent.keyDown(getByTestId("a-field"), submit);
    expect(fired.mock.calls).toEqual([["b"], ["a"]]);
  });

  it("focus in neither of two focus-only regions fires nothing, the pointer notwithstanding", () => {
    const fired = vi.fn();
    const { getByTestId } = render(
      <WithShortcuts>
        <Panel name="a" keys="mod+enter" pointer={false} onFire={fired} />
        <Panel name="b" keys="mod+enter" pointer={false} onFire={fired} />
      </WithShortcuts>,
    );
    fireEvent.pointerOver(getByTestId("a"));
    fireEvent.keyDown(document.body, submit);
    expect(fired).not.toHaveBeenCalled();
  });

  it("a pointer region takes the key under the pointer while no region holds focus", () => {
    const fired = vi.fn();
    const { getByTestId } = render(
      <WithShortcuts>
        <Panel name="a" keys="j" pointer onFire={fired} />
        <Panel name="b" keys="j" pointer onFire={fired} />
      </WithShortcuts>,
    );
    fireEvent.pointerOver(getByTestId("b"));
    fireEvent.keyDown(document.body, { key: "j" });
    expect(fired.mock.calls).toEqual([["b"]]);
    // Focus wins over the pointer.
    const button = document.createElement("button");
    getByTestId("a").appendChild(button);
    fireEvent.keyDown(button, { key: "j" });
    expect(fired.mock.calls).toEqual([["b"], ["a"]]);
    // The pointer gone and focus in neither: nothing.
    fireEvent.pointerOut(getByTestId("b"), { relatedTarget: null });
    fireEvent.keyDown(document.body, { key: "j" });
    expect(fired.mock.calls).toEqual([["b"], ["a"]]);
  });

  it("the region holding focus with nothing to do never hands the key to its twin", () => {
    const fired = vi.fn();
    const { getByTestId } = render(
      <WithShortcuts>
        <Panel name="a" keys="mod+enter" pointer={false} onFire={fired} idle />
        <Panel name="b" keys="mod+enter" pointer={false} onFire={fired} />
      </WithShortcuts>,
    );
    fireEvent.keyDown(getByTestId("a-field"), submit);
    fireEvent.keyDown(document.body, submit);
    expect(fired).not.toHaveBeenCalled();
  });

  it("a region alone on its key takes it wherever focus is", () => {
    const fired = vi.fn();
    render(
      <WithShortcuts>
        <Panel name="a" keys="mod+enter" pointer={false} onFire={fired} />
      </WithShortcuts>,
    );
    fireEvent.keyDown(document.body, submit);
    expect(fired.mock.calls).toEqual([["a"]]);
  });

  it("a region nested in another one holding focus wins over it", () => {
    const fired = vi.fn();
    const { getByTestId } = render(
      <WithShortcuts>
        <Panel name="outer" keys="mod+enter" pointer={false} onFire={fired}>
          <Panel name="inner" keys="mod+enter" pointer={false} onFire={fired} />
        </Panel>
      </WithShortcuts>,
    );
    fireEvent.keyDown(getByTestId("inner-field"), submit);
    fireEvent.keyDown(getByTestId("outer-field"), submit);
    expect(fired.mock.calls).toEqual([["inner"], ["outer"]]);
  });

  it("focus on a container around the press (a caret host): the region pressed in", () => {
    const fired = vi.fn();
    const { getByTestId } = render(
      <WithShortcuts>
        <div data-testid="host-a" tabIndex={-1}>
          <Panel name="a" keys="mod+enter" pointer={false} onFire={fired}>
            <span data-testid="a-text">text</span>
          </Panel>
        </div>
        <div data-testid="host-b" tabIndex={-1}>
          <Panel name="b" keys="mod+enter" pointer={false} onFire={fired} />
        </div>
      </WithShortcuts>,
    );
    fireEvent.pointerDown(getByTestId("a-text"));
    fireEvent.keyDown(getByTestId("host-a"), submit);
    expect(fired.mock.calls).toEqual([["a"]]);
    // A focused container that does not hold the press says nothing.
    fireEvent.keyDown(getByTestId("host-b"), submit);
    expect(fired.mock.calls).toEqual([["a"]]);
  });
});
