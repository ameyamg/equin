import { describe, expect, test } from "bun:test";
import {
  isLocalAppUrl,
  isPublicSiteUrl,
  localAppPortFor,
  localAppUrl,
  localSiteUrl,
  PUBLIC_SITE_ORIGIN,
  publicSitePageUrl,
  publicSiteRoutePath,
  publicSiteUrl,
  DISCORD_URL,
  ISSUES_URL,
  websiteDestinationOf,
} from "./site";
import { SOURCE_REPO_URL } from "@plugins/framework/plugins/product-name/core";

const local = localAppUrl(8700);

describe("the site's two origins", () => {
  test("a published page opens locally under the website's base path", () => {
    expect(
      localSiteUrl(new URL(`${PUBLIC_SITE_ORIGIN}/guide?x=1#top`), 8700),
    ).toBe(`${local}/about/guide?x=1#top`);
    expect(localSiteUrl(new URL(`${PUBLIC_SITE_ORIGIN}/`), 8700)).toBe(
      `${local}/about`,
    );
  });

  test("a published path reads as the gateway reads it: an address, or the route's own spelling", () => {
    // The gateway 301s `/about/…` on equin.ai to its address, so both spell
    // the same page — never a doubled base path.
    for (const [path, route] of [
      ["/", "/about"],
      ["/guide", "/about/guide"],
      ["/demo/at/isle", "/about/demo/at/isle"],
      ["/about", "/about"],
      ["/about/guide", "/about/guide"],
      ["/about/demo/at/isle", "/about/demo/at/isle"],
      ["/;k=v", "/about;k=v"],
      ["/aboutx", "/about/aboutx"],
    ])
      expect(publicSiteRoutePath(path!)).toBe(route!);
    expect(
      localSiteUrl(new URL(`${PUBLIC_SITE_ORIGIN}/about/guide?x=1`), 8700),
    ).toBe(`${local}/about/guide?x=1`);
  });

  test("a local site page opens on equin.ai without the base path", () => {
    expect(publicSiteUrl(new URL(`${local}/about/apps`))).toBe(
      `${PUBLIC_SITE_ORIGIN}/apps`,
    );
    expect(publicSiteUrl(new URL(`${local}/about`))).toBe(
      `${PUBLIC_SITE_ORIGIN}/`,
    );
  });

  test("a website page's published URL", () => {
    expect(publicSitePageUrl("/about/guide")).toBe(
      `${PUBLIC_SITE_ORIGIN}/guide`,
    );
    expect(publicSitePageUrl("/about?x=1")).toBe(`${PUBLIC_SITE_ORIGIN}/?x=1`);
  });

  test("any page of a local instance opens on equin.ai", () => {
    expect(publicSiteUrl(new URL(`${local}/agents`))).toBe(
      `${PUBLIC_SITE_ORIGIN}/`,
    );
    expect(
      publicSiteUrl(new URL("http://att-x.localhost:9000/about/guide")),
    ).toBe(`${PUBLIC_SITE_ORIGIN}/guide`);
    expect(publicSiteUrl(new URL(`${local}/aboutx`))).toBe(
      `${PUBLIC_SITE_ORIGIN}/`,
    );
  });

  test("only a local gateway namespace is a local instance", () => {
    expect(isLocalAppUrl(new URL(`${local}/agents`))).toBe(true);
    expect(isLocalAppUrl(new URL("http://att-x.localhost:8701/"))).toBe(true);
    // An install that has not moved off the old port yet.
    expect(isLocalAppUrl(new URL("http://att-x.localhost:9000/"))).toBe(true);
    expect(isLocalAppUrl(new URL("http://localhost:8700/"))).toBe(false);
    expect(isLocalAppUrl(new URL("http://equin.localhost:8710/"))).toBe(false);
    expect(isLocalAppUrl(new URL("http://equin.localhost:3000/"))).toBe(false);
    expect(isLocalAppUrl(new URL(`${PUBLIC_SITE_ORIGIN}/about`))).toBe(false);
    expect(() => publicSiteUrl(new URL("https://example.com/"))).toThrow();
  });

  test("a local page names its own port; equin.ai names the default", () => {
    expect(localAppPortFor(new URL("http://equin.localhost:8703/about"))).toBe(
      8703,
    );
    expect(localAppPortFor(new URL(`${PUBLIC_SITE_ORIGIN}/download`))).toBe(
      8700,
    );
  });

  test("only equin.ai is the published site", () => {
    expect(isPublicSiteUrl(new URL(`${PUBLIC_SITE_ORIGIN}/`))).toBe(true);
    expect(isPublicSiteUrl(new URL("http://equin.ai/about"))).toBe(false);
    expect(isPublicSiteUrl(new URL("https://www.equin.ai/about"))).toBe(false);
    expect(() =>
      localSiteUrl(new URL("https://example.com/about"), 8700),
    ).toThrow();
  });
});

describe("websiteDestinationOf", () => {
  const of = (href: string) => websiteDestinationOf(new URL(href));
  test("names the site's own off-site destinations", () => {
    expect(of(SOURCE_REPO_URL)).toBe("github_repo");
    expect(of(`${SOURCE_REPO_URL}/releases`)).toBe("github_repo");
    expect(of(ISSUES_URL)).toBe("github_issues");
    expect(of(`${ISSUES_URL}?template=wish&title=x`)).toBe("github_issues");
    expect(of(DISCORD_URL)).toBe("discord");
  });
  test("leaves any other address to its host", () => {
    expect(of("https://github.com/someone/else")).toBeUndefined();
    expect(of(`${SOURCE_REPO_URL}-fork`)).toBeUndefined();
    expect(of("https://claude.ai/download")).toBeUndefined();
  });
});
