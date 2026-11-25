import { describe, expect, test } from "bun:test";
import { is } from "drizzle-orm";
import { pgTable, PgCustomColumn } from "drizzle-orm/pg-core";
import { mediaField } from "@plugins/fields/plugins/media/core";
import { decode } from "./storage";

const field = mediaField({ accept: "image/*", max: 1 });
const t = pgTable("media_storage_probe", { c: decode("c", field.schema) });
const ref = {
  attachmentId: "a",
  mime: "image/png",
  filename: "a.png",
  size: 1,
};

describe("media storage", () => {
  test("a decoded jsonb column", () => {
    expect(t.c.getSQLType()).toBe("jsonb");
    expect(is(t.c, PgCustomColumn)).toBe(true);
    expect(t.c.mapFromDriverValue([ref])).toEqual([ref]);
  });

  test("the field's own max runs on read", () => {
    expect(() =>
      t.c.mapFromDriverValue([ref, { ...ref, attachmentId: "b" }]),
    ).toThrow();
  });
});
