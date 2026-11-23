import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineCapability, mandatePolicy, withGrants } from "./define";

const flag = defineCapability<true>({
  id: "test.flag",
  schema: z.literal(true),
  label: "Flag",
});
const level = defineCapability<"low" | "high">({
  id: "test.level",
  schema: z.enum(["low", "high"]),
  label: "Level",
});

describe("mandatePolicy", () => {
  test("records one entry per grant, keyed by capability id", () => {
    expect(mandatePolicy([flag.grant(true), level.grant("high")])).toEqual({
      "test.flag": true,
      "test.level": "high",
    } as never);
  });

  test("granting a capability twice throws", () => {
    expect(() =>
      mandatePolicy([level.grant("low"), level.grant("high")]),
    ).toThrow(/"test\.level" granted twice/);
  });

  test("scoped grants are stored under @root / @below", () => {
    expect(
      mandatePolicy([flag.grant(true)], {
        root: [level.grant("low")],
        below: [level.grant("high")],
      }),
    ).toEqual({
      "test.flag": true,
      "@root": { "test.level": "low" },
      "@below": { "test.level": "high" },
    } as never);
  });

  test("a capability granted whole-tree and scoped throws", () => {
    expect(() =>
      mandatePolicy([level.grant("low")], { root: [level.grant("high")] }),
    ).toThrow(/"test\.level" granted twice/);
  });

  test("a capability id starting with @ is refused", () => {
    expect(() =>
      defineCapability<true>({
        id: "@root",
        schema: z.literal(true),
        label: "Bad",
      }),
    ).toThrow(/reserved/);
  });

  test("an empty policy grants nothing", () => {
    expect(mandatePolicy([])).toEqual({} as never);
  });
});

describe("Capability.grant", () => {
  test("a value its schema refuses throws at the author", () => {
    // A value laundered past tsc (a cast, a config read) is caught here.
    expect(() => level.grant("medium" as "low")).toThrow();
  });
});

describe("withGrants", () => {
  test("adds the grants beside the policy's own", () => {
    expect(
      withGrants(mandatePolicy([flag.grant(true)]), [level.grant("low")]),
    ).toEqual({
      "test.flag": true,
      "test.level": "low",
    } as never);
  });

  test("a capability the policy already grants throws, whole-tree or scoped", () => {
    expect(() =>
      withGrants(mandatePolicy([level.grant("low")]), [level.grant("high")]),
    ).toThrow(/"test\.level" granted twice/);
    expect(() =>
      withGrants(mandatePolicy([], { below: [level.grant("low")] }), [
        level.grant("high"),
      ]),
    ).toThrow(/"test\.level" granted twice/);
  });
});
