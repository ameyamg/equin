import { describe, expect, it } from "bun:test";
import { destinationsOf } from "../../server/internal/destination-rules";
import { decidePublication, publishTargets, routeDestination } from "./fan-out";

const deployments = [
  { id: "dpl-1", compositionId: "website", hostnames: ["equin.ai"] },
  { id: "dpl-2", compositionId: "website", hostnames: ["b.test"] },
];
const resolved = (onMain: boolean) =>
  destinationsOf({
    deployments,
    shipping: new Set(["dpl-1", "dpl-2"]),
    onMain,
    pagePath: "/tips",
    localUrl: null,
  });

describe("publishTargets", () => {
  it("fans a Publish out to every destination on main", () => {
    expect(publishTargets(resolved(true), undefined)).toEqual({
      kind: "queue",
      destinations: ["deployment:dpl-1", "deployment:dpl-2", "local"],
    });
  });

  it("in a worktree, to this instance only", () => {
    expect(publishTargets(resolved(false), undefined)).toEqual({
      kind: "queue",
      destinations: ["local"],
    });
  });

  it("publishes to one asked destination, refusing it off main", () => {
    expect(publishTargets(resolved(true), "deployment:dpl-2")).toEqual({
      kind: "queue",
      destinations: ["deployment:dpl-2"],
    });
    const refused = publishTargets(resolved(false), "deployment:dpl-2");
    expect(refused.kind).toBe("refused");
    expect(publishTargets(resolved(false), "local")).toEqual({
      kind: "queue",
      destinations: ["local"],
    });
  });

  it("refuses a destination that does not serve the feed", () => {
    const answer = publishTargets(resolved(true), "deployment:dpl-9");
    expect(answer.kind).toBe("refused");
    if (answer.kind === "refused") {
      expect(answer.message).toContain("not a copy of the site");
    }
  });
});

describe("decidePublication", () => {
  it("follows what the item now asks, where a row stands", () => {
    expect(decidePublication({ wanted: true, held: true })).toBe("publish");
    expect(decidePublication({ wanted: false, held: true })).toBe("unpublish");
    expect(decidePublication({ wanted: true, held: false })).toBe("nothing");
    expect(decidePublication({ wanted: false, held: false })).toBe("nothing");
  });
});

describe("routeDestination", () => {
  it("never reaches a deployment off main", () => {
    expect(routeDestination("local", false)).toEqual({ kind: "local" });
    expect(routeDestination("deployment:dpl-1", true)).toEqual({
      kind: "deployment",
      deploymentId: "dpl-1",
    });
    const refused = routeDestination("deployment:dpl-1", false);
    expect(refused.kind).toBe("refused");
  });

  it("throws on a destination it cannot read", () => {
    expect(() => routeDestination("elsewhere" as "local", true)).toThrow(
      "not a destination",
    );
  });
});
