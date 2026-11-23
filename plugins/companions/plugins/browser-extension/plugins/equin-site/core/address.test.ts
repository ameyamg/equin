import { describe, expect, test } from "bun:test";
import {
  flipView,
  formatEquinAddress,
  mainInstance,
  moveInstance,
  parseEquinAddress,
  type EquinAddress,
} from "./address";

const WT = "http://att-1795440252-swtr90.localhost:8700";
const MAIN = "http://equin.localhost:8700";

function parse(href: string): EquinAddress {
  const a = parseEquinAddress(new URL(href));
  if (a === null) throw new Error(`not an equin page: ${href}`);
  return a;
}
const fmt = formatEquinAddress;

describe("an equin page as instance × view", () => {
  test("reads each kind of page back to the same URL", () => {
    for (const href of [
      `${WT}/isle`,
      `${WT}/agents/c/x?q=1#h`,
      `${WT}/about/demo/at/isle`,
      `${WT}/about/demo`,
      `${WT}/about/vision`,
      `${MAIN}/isle`,
      "https://equin.ai/demo/at/isle",
      "https://equin.ai/vision",
      "https://equin.ai/",
    ])
      expect(fmt(parse(href))).toBe(href);
  });

  test("not an equin page", () => {
    expect(parseEquinAddress(new URL("https://example.com/isle"))).toBeNull();
    expect(parseEquinAddress(new URL("http://localhost:8700/"))).toBeNull();
  });

  test("the four destinations of a worktree's app page, one axis at a time", () => {
    const here = parse(`${WT}/isle`);
    const onMain = moveInstance(here, mainInstance(8700));
    expect(fmt(onMain)).toBe(`${MAIN}/isle`);
    expect(fmt(flipView(here, 8700)!)).toBe(`${WT}/about/demo/at/isle`);
    expect(fmt(flipView(onMain, 8700)!)).toBe(`${MAIN}/about/demo/at/isle`);
    // equin.ai serves no app: it opens the demo at the same place.
    expect(fmt(moveInstance(here, { kind: "public" }))).toBe(
      "https://equin.ai/demo/at/isle",
    );
  });

  test("the demo opens live; equin.ai's demo opens live on main", () => {
    expect(fmt(flipView(parse(`${WT}/about/demo/at/agents/c/x`), 8700)!)).toBe(
      `${WT}/agents/c/x`,
    );
    expect(fmt(flipView(parse("https://equin.ai/demo/at/isle"), 8701)!)).toBe(
      "http://equin.localhost:8701/isle",
    );
    expect(fmt(flipView(parse(`${WT}/about/demo`), 8700)!)).toBe(`${WT}/`);
    expect(fmt(flipView(parse(`${WT}/`), 8700)!)).toBe(`${WT}/about/demo`);
  });

  test("a site page has no app to flip to, and moves between origins", () => {
    const page = parse(`${WT}/about/vision`);
    expect(flipView(page, 8700)).toBeNull();
    expect(fmt(moveInstance(page, { kind: "public" }))).toBe(
      "https://equin.ai/vision",
    );
    expect(
      fmt(moveInstance(parse("https://equin.ai/guide"), mainInstance(8700))),
    ).toBe(`${MAIN}/about/guide`);
  });

  test("the app's own spelling of a place survives the demo round trip", () => {
    const href = `${WT}/sonata/song-x;lens=notation`;
    const demo = flipView(parse(href), 8700)!;
    expect(fmt(flipView(parse(fmt(demo)), 8700)!)).toBe(href);
  });
});
