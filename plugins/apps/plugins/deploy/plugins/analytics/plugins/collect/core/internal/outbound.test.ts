import { describe, expect, test } from "bun:test";
import { EventBodySchema, MAX_EVENT_PROP_VALUE_LENGTH } from "./collect-body";
import {
  LINK_PLACEMENT_ATTRIBUTE,
  OUTBOUND_CLICK_EVENT,
  linkPlacement,
  outboundClick,
} from "./outbound";

const PAGE = "https://equin.ai/download";
const named = (url: URL) =>
  url.host === "github.com" ? "github_repo" : undefined;
const click = (href: string, placement = "header_github") =>
  outboundClick({
    href,
    pageUrl: PAGE,
    path: "/download",
    placement,
    destinationOf: named,
  });

describe("outboundClick", () => {
  test("a link to another host records where, on which page, from which link", () => {
    expect(click("https://github.com/equinai/equin")).toEqual({
      outbound: true,
      props: { to: "github_repo", page: "/download", link: "header_github" },
    });
  });

  test("a destination the site does not name is named by its host", () => {
    expect(click("https://discord.gg/abc", "landing/contact")).toEqual({
      outbound: true,
      props: { to: "discord.gg", page: "/download", link: "landing/contact" },
    });
  });

  test("a link that stays on the site, or is not a web address, is not outbound", () => {
    expect(click("https://equin.ai/apps")).toEqual({ outbound: false });
    expect(click("/apps")).toEqual({ outbound: false });
    expect(click("#top")).toEqual({ outbound: false });
    expect(click("mailto:hello@equin.ai")).toEqual({ outbound: false });
    expect(click("claude://code")).toEqual({ outbound: false });
  });

  test("a different port is a different site", () => {
    expect(click("https://equin.ai:8443/").outbound).toBe(true);
  });

  test("the event is one the collector accepts, a long host cut to its bound", () => {
    const host = `${"a".repeat(200)}.example`;
    const c = click(`https://${host}/`);
    if (!c.outbound) throw new Error("expected outbound");
    expect(c.props.to.length).toBe(MAX_EVENT_PROP_VALUE_LENGTH);
    const body = EventBodySchema.parse({
      kind: "event",
      host: "equin.ai",
      path: "/download",
      name: OUTBOUND_CLICK_EVENT,
      props: c.props,
    });
    expect(body.props).toEqual(c.props);
  });
});

describe("linkPlacement", () => {
  test("spreads the placement attribute", () => {
    expect(linkPlacement("footer_discord")).toEqual({
      [LINK_PLACEMENT_ATTRIBUTE]: "footer_discord",
    });
  });
  test("refuses a name outside the event-prop alphabet", () => {
    expect(() => linkPlacement("Footer Discord")).toThrow();
  });
});
