import { describe, expect, test } from "bun:test";
import { zoneOfHostname } from "./client";

const zones = [
  { id: "z1", name: "equin.ai" },
  { id: "z2", name: "docs.equin.ai" },
  { id: "z3", name: "other.dev" },
];

describe("zoneOfHostname", () => {
  test("the apex is its own zone", () => {
    expect(zoneOfHostname(zones, "equin.ai")?.id).toBe("z1");
  });
  test("a subdomain belongs to its parent zone", () => {
    expect(zoneOfHostname(zones, "www.equin.ai")?.id).toBe("z1");
  });
  test("the longest parent wins", () => {
    expect(zoneOfHostname(zones, "a.docs.equin.ai")?.id).toBe("z2");
  });
  test("case does not matter", () => {
    expect(zoneOfHostname(zones, "WWW.Equin.AI")?.id).toBe("z1");
  });
  test("a lookalike suffix is not a parent", () => {
    expect(zoneOfHostname(zones, "notequin.ai")).toBeNull();
  });
  test("no readable zone is null", () => {
    expect(zoneOfHostname(zones, "example.com")).toBeNull();
  });
});
