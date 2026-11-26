/**
 * `preloadWindows` on the external arm (`compileExternalCollection`, which the
 * Bun `serveCollection` dispatches to): each window's tuple is the reader's
 * own page 0, answered by `held(q)` and checked and keyed exactly as
 * `window(q)`'s answer; a window the source does not hold is absent; a bad
 * window fails its tuple alone. The spec is checked at serve time.
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { fieldsToZodObject } from "@plugins/fields/core";
import { intField } from "@plugins/fields/plugins/int/plugins/config/core";
import { textField } from "@plugins/fields/plugins/text/plugins/config/core";
import { createHarness } from "@plugins/network/plugins/live/plugins/resource-runtime/core/testing";
import { liveCollection } from "./live-collection";
import {
  compileExternalCollection,
  serveCollectionOn,
  type AnyCollection,
  type AnyExternalCollectionOptions,
} from "./serve-on";

const LISTED = { title: textField({ label: "Title" }) };
const CARRIED = { id: textField(), rank: intField() };
const RowSchema = fieldsToZodObject({ ...LISTED, ...CARRIED });
type Row = z.infer<typeof RowSchema>;

let seq = 0;
const collection = () =>
  liveCollection(`test.preload-windows.${seq++}`, {
    fields: LISTED,
    carry: { fields: CARRIED },
    id: "id",
    sortable: ["rank", "title"],
    default: { orderBy: [["rank", "asc"]], limit: 2 },
    maxLimit: 10,
  });

const rows: Row[] = [
  { id: "a", title: "A", rank: 1 },
  { id: "b", title: "B", rank: 2 },
  { id: "c", title: "C", rank: 3 },
];
const keyText = { rank: (n: number) => String(n).padStart(4, "0") };

function serve(
  c: ReturnType<typeof collection>,
  preloadWindows: unknown,
  window: (q: { limit: number }) => readonly Row[] = (q) =>
    rows.slice(0, q.limit),
) {
  return compileExternalCollection(
    createHarness().runtime,
    c as unknown as AnyCollection,
    {
      source: "external",
      changes: "notified",
      keyText,
      window,
      rows: () => [],
      preloadWindows,
    } as unknown as AnyExternalCollectionOptions,
  );
}

describe("preloadWindows (external)", () => {
  test("each window is the reader's page 0, its rows keyed as window(q)'s", async () => {
    const c = collection();
    const asked: unknown[] = [];
    const served = serve(c, {
      windows: () => [{}, { where: { title: "B" } }],
      held: (q: { limit: number; where: unknown }) => {
        asked.push(q);
        return q.where === undefined
          ? { held: true, rows: rows.slice(0, q.limit) }
          : { held: false };
      },
    });
    const preload = served.windowAppPreload!;
    const tuples = await preload.tuples();
    // The default window's page 0 — `useLive(c, {}, { viewport })`'s first page.
    const page0 = c.window.window.encode({
      limit: c.window.window.defaultLimit,
    });
    expect(tuples).toEqual([
      {
        params: page0,
        ok: true,
        value: await served.window!.load(page0),
      },
    ]);
    // Held answers at the step; a window not held is simply absent.
    expect(asked.map((q) => (q as { limit: number }).limit)).toEqual([2, 2]);
  });

  test("the same window twice is one tuple", async () => {
    const served = serve(collection(), {
      windows: () => [{}, { orderBy: [["rank", "asc"]] }],
      held: () => ({ held: true, rows: rows.slice(0, 2) }),
    });
    expect(await served.windowAppPreload!.tuples()).toHaveLength(1);
  });

  test("a held answer is checked like window(q)'s", async () => {
    const served = serve(collection(), {
      windows: () => [{}],
      held: () => ({ held: true, rows }),
    });
    const [t] = await served.windowAppPreload!.tuples();
    expect(t?.ok).toBe(false);
    expect(String((t as { error: unknown }).error)).toContain(
      "preloadWindows.held(q) returned 3 rows for at most 2",
    );
  });

  test("a window with a limit fails its tuple alone", async () => {
    const served = serve(collection(), {
      windows: () => [{ limit: 5 }, {}],
      held: () => ({ held: true, rows: rows.slice(0, 2) }),
    });
    const tuples = await served.windowAppPreload!.tuples();
    expect(tuples.map((t) => t.ok)).toEqual([false, true]);
    expect(tuples[0]!.params).toEqual({ window: JSON.stringify({ limit: 5 }) });
  });

  test("the spec is checked at serve time", () => {
    expect(() =>
      serve(collection(), { windows: [], held: () => ({ held: false }) }),
    ).toThrow("`windows` must be a function");
    expect(() => serve(collection(), { windows: () => [] })).toThrow(
      "`preloadWindows.held(q)` is required",
    );
  });

  test("a host without a boot snapshot refuses it", () => {
    expect(() =>
      serveCollectionOn(createHarness().runtime, collection(), {
        source: "external",
        changes: "notified",
        keyText,
        window: () => [],
        rows: () => [],
        preloadWindows: {
          windows: () => [],
          held: () => ({ held: false }) as const,
        },
      }),
    ).toThrow("rides the worktree's boot snapshot");
  });
});
