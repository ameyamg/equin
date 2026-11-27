/**
 * An external collection's `reads` as a thunk (`externalReadsRuntime`): the
 * tables come from a registry complete only once contributions are collected
 * (the providers a cache reads through), so every resource of the collection
 * is a deferred external — external with its freshness from definition, its
 * reach plan compiled at `bindDeferredResources` from the registry as it is
 * then. A loader reading a table the registry declares is covered by the
 * drift guard; one it does not declare still drifts.
 */

import { describe, expect, test } from "bun:test";
import { pgTable, text } from "drizzle-orm/pg-core";
import { z } from "zod";
import { fieldsToZodObject } from "@plugins/fields/core";
import { textField } from "@plugins/fields/plugins/text/plugins/config/core";
import { createHarness } from "@plugins/network/plugins/live/plugins/resource-runtime/core/testing";
import {
  compileExternalCollection,
  liveCollection,
  type AnyCollection,
  type AnyExternalCollectionOptions,
} from "@plugins/network/plugins/live/core";
import { externalReadsRuntime } from "./serve-collection";

const providerAccounts = pgTable("test_ext_reads_provider_accounts", {
  id: text("id").primaryKey(),
});
const cacheRows = pgTable("test_ext_reads_cache_rows", {
  id: text("id").primaryKey(),
});

const LISTED = { title: textField({ label: "Title" }) };
const CARRIED = { id: textField() };
const RowSchema = fieldsToZodObject({ ...LISTED, ...CARRIED });
type Row = z.infer<typeof RowSchema>;

let seq = 0;
const collection = () =>
  liveCollection(`test.ext-reads.${seq++}`, {
    fields: LISTED,
    carry: { fields: CARRIED },
    id: "id",
    sortable: ["title"],
    default: { orderBy: [["title", "asc"]], limit: 5 },
    maxLimit: 10,
  });

const rows: Row[] = [{ id: "a", title: "A" }];

function serve(captured: readonly string[]) {
  const reports: string[] = [];
  const h = createHarness({
    lastReadSet: () => [...captured],
    reportError: (ctx) => reports.push(ctx),
  });
  // The registry the thunk reads: empty until "contributions are collected".
  const registry: (typeof providerAccounts)[] = [];
  const c = collection();
  const served = compileExternalCollection(
    externalReadsRuntime(
      "test",
      () => ({
        tables: [],
        reason: "the cache's own rows",
        notified: {
          relations: [cacheRows, ...registry],
          reason: "the cache and its providers' changes reach it by notify",
        },
      }),
      h.runtime,
    ),
    c as unknown as AnyCollection,
    {
      source: "external",
      changes: "notified",
      window: () => rows,
      rows: () => rows,
    } as unknown as AnyExternalCollectionOptions,
  );
  return { h, c, served, registry, reports };
}

describe("an external collection's reads thunk", () => {
  test("every resource is deferred external until the bind, then reads the registry as it is", async () => {
    const s = serve(["test_ext_reads_provider_accounts"]);
    // Contributed after the collection is defined, before the bind.
    s.registry.push(providerAccounts);
    const key = s.served.window!.key;
    expect(() => s.h.runtime.bindDeferredResources()).not.toThrow();
    const page0 = s.c.window.window.encode({ limit: 5 });
    await s.h.subscribe(key, page0);
    expect(s.h.frames.map((f) => f.kind)).toContain("sub-ack");
    expect(s.reports).toEqual([]);
  });

  test("a table the registry does not declare still drifts", async () => {
    const s = serve(["test_ext_reads_provider_accounts"]);
    s.h.runtime.bindDeferredResources();
    const key = s.served.window!.key;
    await s.h.subscribe(key, s.c.window.window.encode({ limit: 5 }));
    expect(s.reports).toEqual([`route drift for ${key}`]);
  });

  test("notify still re-reads a subscribed window", async () => {
    const s = serve([]);
    s.h.runtime.bindDeferredResources();
    const key = s.served.window!.key;
    await s.h.subscribe(key, s.c.window.window.encode({ limit: 5 }));
    expect(() => s.served.notify!()).not.toThrow();
  });
});
