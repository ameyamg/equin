import { describe, expect, it } from "bun:test";
import {
  deployedPageUrl,
  destinationsOf,
  primaryDestination,
  publishScopeOf,
  remoteRefusal,
} from "./destination-rules";

const deployments = [
  { id: "dpl-1", compositionId: "website", hostnames: ["equin.ai"] },
  { id: "dpl-2", compositionId: "sonata", hostnames: ["music.example"] },
  { id: "dpl-3", compositionId: "website", hostnames: ["*.x.test", "b.test"] },
];

describe("destinationsOf", () => {
  it("lists every deployment shipping the feed, in order, then this instance", () => {
    const all = destinationsOf({
      deployments,
      shipping: new Set(["dpl-1", "dpl-3"]),
      onMain: true,
      pagePath: "/tips",
      localUrl: "http://equin.localhost:9000/about/tips",
    });
    expect(all.map((d) => d.destination)).toEqual([
      "deployment:dpl-1",
      "deployment:dpl-3",
      "local",
    ]);
    expect(all.map((d) => d.url)).toEqual([
      "https://equin.ai/tips",
      "https://b.test/tips",
      "http://equin.localhost:9000/about/tips",
    ]);
    expect(all.every((d) => d.refusal === null)).toBe(true);
  });

  it("off main, every deployment is refused and this instance is not", () => {
    const all = destinationsOf({
      deployments,
      shipping: new Set(["dpl-1"]),
      onMain: false,
      pagePath: undefined,
      localUrl: null,
    });
    expect(all).toHaveLength(2);
    expect(all[0]?.refusal).toBe(remoteRefusal(false));
    expect(all[0]?.refusal).toContain("main checkout only");
    expect(all[1]).toMatchObject({ destination: "local", refusal: null });
  });

  it("with no deployment shipping it, the feed still goes to this instance", () => {
    expect(
      destinationsOf({
        deployments,
        shipping: new Set(),
        onMain: true,
        pagePath: "/tips",
        localUrl: null,
      }).map((d) => d.destination),
    ).toEqual(["local"]);
  });
});

describe("primaryDestination", () => {
  it("is the first deployment published to, else this instance", () => {
    const input = {
      deployments,
      shipping: new Set(["dpl-1", "dpl-3"]),
      pagePath: "/tips",
      localUrl: "http://equin.localhost:9000/about/tips",
    };
    expect(
      primaryDestination(destinationsOf({ ...input, onMain: true }))
        .destination,
    ).toBe("deployment:dpl-1");
    // A worktree publishes nowhere remote: its own copy stands for the item.
    expect(
      primaryDestination(destinationsOf({ ...input, onMain: false }))
        .destination,
    ).toBe("local");
  });
});

describe("the worktree rule", () => {
  it("allows deployed sites on main only", () => {
    expect(remoteRefusal(true)).toBe(null);
    expect(publishScopeOf(true)).toEqual({ remote: { kind: "allowed" } });
    expect(publishScopeOf(false).remote.kind).toBe("refused");
  });

  it("links a deployed page by its first non-wildcard hostname", () => {
    expect(deployedPageUrl(["*.a.test", "a.test"], undefined)).toBe(
      "https://a.test/",
    );
    expect(deployedPageUrl([], "/tips")).toBe(null);
  });
});
