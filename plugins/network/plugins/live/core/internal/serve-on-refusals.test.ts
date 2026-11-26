/**
 * A collection's declared `refusals` (`liveCollection(key, { refusals })`):
 * every descriptor it mints carries the codes, so an external source's
 * loader throwing `c.refuse(code, message)` is answered `sub-error reason:
 * "refused"` with the code — never reported — on the window, `:rows` and an
 * `all` set alike; a refusal with an undeclared code is a loader failure
 * (reported). And the declaration's own checks: `refuse` refuses an
 * undeclared code, a union takes none, a table-backed serve is refused
 * elsewhere (`serve-collection.ts`).
 */

import { describe, expect, test } from "bun:test";
import { textField } from "@plugins/fields/plugins/text/plugins/config/core";
import { intField } from "@plugins/fields/plugins/int/plugins/config/core";
import { ResourceRefusal } from "@plugins/network/plugins/live/plugins/resource-protocol/core";
import { createHarness } from "@plugins/network/plugins/live/plugins/resource-runtime/core/testing";
import { liveCollection } from "./live-collection";
import { serveCollectionOn } from "./serve-on";

const LISTED = { title: textField({ label: "Title" }) };
const CARRIED = { id: textField(), rank: intField() };
const F = { fields: LISTED, carry: { fields: CARRIED }, id: "id" } as const;
const keyText = { rank: (n: number) => String(n).padStart(4, "0") };

let seq = 0;
const key = (name: string) => `test.serve-on-refusals.${name}.${seq++}`;

const windowCollection = (k: string) =>
  liveCollection(k, {
    ...F,
    sortable: ["rank"],
    default: { orderBy: [["rank", "asc"]], limit: 10 },
    maxLimit: 50,
    refusals: ["not-connected", "offline-not-cached"],
  });

/** A runtime recording what it reports, so a refusal is seen to be NOT reported. */
function harness() {
  const reported: string[] = [];
  const h = createHarness({
    reportError: (context, err) =>
      reported.push(`${context}: ${(err as Error).message}`),
  });
  return { h, reported };
}

const subError = (h: ReturnType<typeof createHarness>, k: string) =>
  h.frames.find((f) => f.kind === "sub-error" && f.key === k) as
    (Record<string, unknown> & { reason?: string }) | undefined;

describe("liveCollection refusals — the declaration", () => {
  test("every minted descriptor carries the codes; `refuse` mints the typed refusal", () => {
    const c = windowCollection(key("decl"));
    expect(c.refusals).toEqual(["not-connected", "offline-not-cached"]);
    for (const d of [c.window, c.rows, c.groups]) {
      expect((d as { refusals?: readonly string[] }).refusals).toEqual(
        c.refusals,
      );
    }
    const r = c.refuse("not-connected", "Connect Gmail");
    expect(r).toBeInstanceOf(ResourceRefusal);
    expect(r.code).toBe("not-connected");
    // @ts-expect-error — not a declared code
    expect(() => c.refuse("gone", "x")).toThrow(/not a declared refusal/);
  });

  test("a collection that declares none has no codes and no `refuse`", () => {
    const c = liveCollection(key("plain"), {
      ...F,
      sortable: ["rank"],
      default: { orderBy: [["rank", "asc"]], limit: 10 },
      maxLimit: 50,
    });
    expect(c.refusals).toBeUndefined();
    expect(c.refuse).toBeUndefined();
    expect((c.window as { refusals?: unknown }).refusals).toBeUndefined();
  });

  test("an empty or duplicated list is refused at declaration", () => {
    expect(() =>
      liveCollection(key("dup"), {
        ...F,
        sortable: ["rank"],
        default: { orderBy: [["rank", "asc"]], limit: 10 },
        maxLimit: 50,
        refusals: ["x", "x"],
      }),
    ).toThrow(/bad `refusals`/);
  });

  test("a union takes none (an untyped caller)", () => {
    // Untyped: the union overload takes no `refusals` (tsc).
    const untyped = liveCollection as unknown as (
      k: string,
      spec: object,
    ) => unknown;
    expect(() =>
      untyped(key("union"), {
        fields: { kind: textField({ label: "Kind" }) },
        carry: { fields: { id: textField() } },
        id: "id",
        arms: { discriminator: "kind" },
        sortable: [],
        default: { orderBy: [], limit: 10 },
        maxLimit: 50,
        refusals: ["x"],
      }),
    ).toThrow(/`refusals` beside `arms`/);
  });
});

describe("liveCollection refusals — an external source refusing", () => {
  test("the window: a declared code is `sub-error refused` with the code, not reported", async () => {
    const { h, reported } = harness();
    const c = windowCollection(key("window"));
    serveCollectionOn(h.runtime, c, {
      source: "external",
      changes: "notified",
      keyText,
      window: () => {
        throw c.refuse("not-connected", "Connect your Gmail account");
      },
      rows: () => [],
    });
    await h.subscribe(c.key, c.window.defaultParams);
    const err = subError(h, c.key);
    expect(err?.reason).toBe("refused");
    expect(err?.code).toBe("not-connected");
    expect(err?.message).toBe("Connect your Gmail account");
    expect(reported).toEqual([]);
  });

  test(":rows refuses the same way", async () => {
    const { h, reported } = harness();
    const c = windowCollection(key("rows"));
    serveCollectionOn(h.runtime, c, {
      source: "external",
      changes: "notified",
      keyText,
      window: () => [],
      rows: () => {
        throw c.refuse("offline-not-cached", "Offline, and not cached");
      },
    });
    await h.subscribe(c.rows.key, c.rows.point.encode(["a"]));
    const err = subError(h, c.rows.key);
    expect(err?.reason).toBe("refused");
    expect(err?.code).toBe("offline-not-cached");
    expect(reported).toEqual([]);
  });

  test("an `all` set refuses the same way", async () => {
    const { h, reported } = harness();
    const c = liveCollection(key("all"), {
      ...F,
      all: { orderBy: [["rank", "asc"]], max: 10 },
      refusals: ["not-connected"],
    });
    serveCollectionOn(h.runtime, c, {
      source: "external",
      changes: "notified",
      all: () => {
        throw c.refuse("not-connected", "Connect");
      },
      rows: () => [],
    });
    await h.subscribe(c.key, {});
    const err = subError(h, c.key);
    expect(err?.reason).toBe("refused");
    expect(err?.code).toBe("not-connected");
    expect(reported).toEqual([]);
  });

  test("a refusal with an undeclared code is a loader failure, reported", async () => {
    const { h, reported } = harness();
    const c = windowCollection(key("undeclared"));
    serveCollectionOn(h.runtime, c, {
      source: "external",
      changes: "notified",
      keyText,
      window: () => {
        throw new ResourceRefusal("gone", "it went away");
      },
      rows: () => [],
    });
    const error = console.error;
    console.error = () => {};
    try {
      await h.subscribe(c.key, c.window.defaultParams);
    } finally {
      console.error = error;
    }
    const err = subError(h, c.key);
    expect(err?.reason).toBe("loader-failed");
    expect(err?.code).toBeUndefined();
    expect(reported.join("\n")).toContain('refused with code "gone"');
  });
});
