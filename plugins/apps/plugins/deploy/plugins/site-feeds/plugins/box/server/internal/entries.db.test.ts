/**
 * Real-Postgres suite for the public read: a feed's entries newest first,
 * bounded by its publicLimit, re-read through its declaration.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import {
  createTestDb,
  type TestDb,
} from "@plugins/database/plugins/db-test-fixture/server/testing";
import { runMigrations } from "@plugins/database/plugins/migrations/server/testing";
import {
  defineSiteFeed,
  siteFeedEntryIdKind,
} from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import { textField } from "@plugins/fields/plugins/text/plugins/config/core";
import { readFeedEntries, StoredEntryInvalidError } from "./entries-served";
import { siteFeedEntries } from "./tables";

const feed = defineSiteFeed({
  id: "notes",
  label: "Notes",
  fields: { title: textField({ label: "Title" }), extra: textField() },
  publicLimit: 3,
});

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb({ prefix: "site_feeds_test" });
  await runMigrations(t.db);
});

afterAll(async () => {
  await t.drop();
});

beforeEach(async () => {
  await t.db.delete(siteFeedEntries);
});

const at = (day: number) => new Date(Date.UTC(2026, 10, day));

describe("readFeedEntries", () => {
  test("the newest publicLimit entries of the feed, newest first", async () => {
    await t.db.insert(siteFeedEntries).values([
      ...[1, 2, 3, 4, 5].map((day) => ({
        id: siteFeedEntryIdKind.mint(),
        feedId: "notes",
        values: { title: `day ${day}` },
        publishedAt: at(day),
      })),
      // Another feed's entry, newer than all: never in this feed's read.
      {
        id: siteFeedEntryIdKind.mint(),
        feedId: "elsewhere",
        values: { title: "x" },
        publishedAt: at(9),
      },
    ]);
    const read = await readFeedEntries(t.db, feed);
    expect(read.entries.map((e) => e.values.title)).toEqual([
      "day 5",
      "day 4",
      "day 3",
    ]);
    // A field added since the entry was written reads its default.
    expect(read.entries[0]?.values).toEqual({ title: "day 5", extra: "" });
    expect(read.entries[0]?.publishedAt).toBe(at(5).toISOString());
  });

  test("an entry that no longer fits the declaration fails the read", async () => {
    await t.db.insert(siteFeedEntries).values({
      id: siteFeedEntryIdKind.mint(),
      feedId: "notes",
      values: { title: 7 },
      publishedAt: at(1),
    });
    expect(readFeedEntries(t.db, feed)).rejects.toThrow(
      StoredEntryInvalidError,
    );
  });
});
