/**
 * Under jsdom (declared by the shared setup as a host with no layout engine)
 * `generatesBox` answers from computed display — the rule a layout engine
 * applies: `display: none` on the element or an ancestor, `display: contents`
 * on itself, or leaving the document means no box.
 */
import { afterEach, describe, expect, it } from "vitest";
import { generatesBox } from "../internal/generates-box";

afterEach(() => {
  document.body.replaceChildren();
});

function mount(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  return host;
}

describe("generatesBox without a layout engine", () => {
  it("counts a rendered element, a visibility: hidden one included", () => {
    const host = mount(
      `<button id="a">A</button><span id="b" style="visibility: hidden">B</span>`,
    );
    expect(generatesBox(host.querySelector("#a")!)).toBe(true);
    expect(generatesBox(host.querySelector("#b")!)).toBe(true);
  });

  it("does not count an element under display: none, or hidden", () => {
    const host = mount(
      `<div style="display: none"><button id="a">A</button></div><p hidden id="b">B</p>`,
    );
    expect(generatesBox(host.querySelector("#a")!)).toBe(false);
    expect(generatesBox(host.querySelector("#b")!)).toBe(false);
  });

  it("does not count display: contents itself, nor a detached element", () => {
    const host = mount(
      `<div id="a" style="display: contents"><i id="b">x</i></div>`,
    );
    expect(generatesBox(host.querySelector("#a")!)).toBe(false);
    expect(generatesBox(host.querySelector("#b")!)).toBe(true);
    expect(generatesBox(document.createElement("div"))).toBe(false);
  });
});
