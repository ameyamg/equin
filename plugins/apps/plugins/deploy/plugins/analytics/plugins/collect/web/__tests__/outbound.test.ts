/**
 * The outbound-link listener: every click on a link leaving the site records
 * `outbound_click` with its destination, page and placement — no link opts in.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createPageSectionRegistry } from "../internal/page-sections";
import { watchOutboundLinks, type OutboundScope } from "../internal/outbound";

const PATH = "/about";

function harness(
  scope: OutboundScope = {
    inScope: () => true,
    destinationOf: (url) =>
      url.host === "github.com" ? "github_repo" : undefined,
  },
) {
  const sections = createPageSectionRegistry();
  const tracked: { name: string; props: Record<string, string> }[] = [];
  const stop = watchOutboundLinks(document, {
    scope,
    pageUrl: () => window.location.href,
    path: () => PATH,
    sectionOf: (path, el) => sections.sectionOf(path, el),
    track: (name, props) => tracked.push({ name, props }),
  });
  cleanups.push(stop);
  return { sections, tracked };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((f) => f());
  document.body.innerHTML = "";
});

/** Mounts `html` and returns its first anchor; clicks never navigate jsdom. */
function mount(html: string): HTMLAnchorElement {
  document.body.innerHTML = html;
  const a = document.querySelector("a")!;
  a.addEventListener("click", (e) => e.preventDefault());
  return a;
}

describe("outbound links", () => {
  it("records a click with its destination, page and named placement", () => {
    const { tracked } = harness();
    const a = mount(
      `<div data-link-placement="header_github"><a href="https://github.com/equinai/equin"><span>icon</span></a></div>`,
    );
    a.querySelector("span")!.click();
    expect(tracked).toEqual([
      {
        name: "outbound_click",
        props: { to: "github_repo", page: PATH, link: "header_github" },
      },
    ]);
  });

  it("names an unnamed link by its innermost page section, else (unplaced)", () => {
    const { sections, tracked } = harness();
    document.body.innerHTML = `<section id="outer"><div id="inner"><a id="in" href="https://discord.gg/x">d</a></div></section><a id="out" href="https://example.com/">e</a>`;
    sections.register(PATH, document.getElementById("outer")!, "landing/outer");
    sections.register(PATH, document.getElementById("inner")!, "landing/inner");
    for (const a of document.querySelectorAll("a"))
      a.addEventListener("click", (e) => e.preventDefault());
    document.getElementById("in")!.click();
    document.getElementById("out")!.click();
    expect(tracked.map((t) => t.props)).toEqual([
      { to: "discord.gg", page: PATH, link: "landing/inner" },
      { to: "example.com", page: PATH, link: "(unplaced)" },
    ]);
  });

  it("counts a middle click, not a right click", () => {
    const { tracked } = harness();
    const a = mount(`<a href="https://github.com/x">g</a>`);
    a.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    a.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 2 }));
    expect(tracked).toHaveLength(1);
  });

  it("ignores links that stay on the site", () => {
    const { tracked } = harness();
    mount(`<a href="/about/apps">apps</a>`).click();
    mount(`<a href="mailto:hello@equin.ai">mail</a>`).click();
    expect(tracked).toEqual([]);
  });

  it("records nothing while the address is another app's", () => {
    const other = harness({ inScope: () => false, destinationOf: () => "x" });
    mount(`<a href="https://github.com/x">g</a>`).click();
    expect(other.tracked).toEqual([]);
  });
});
