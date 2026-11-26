import { describe, expect, it } from "bun:test";
import {
  and,
  clause,
  liveBoolean,
  liveText,
  type Filter,
  type Filterable,
} from "@plugins/network/plugins/live/plugins/filter/core";
import { liveStringArray } from "@plugins/network/plugins/live/plugins/filter/core/testing";
import {
  filterVerdict,
  frameStamp,
  overlayRows,
  pushRowPatch,
  rowPatchesOf,
} from "./row-overlay";

type Row = { id: string; boxes: string[]; unread: boolean; subject: string };

const FILTERABLE = {
  boxes: liveStringArray(),
  unread: liveBoolean(),
  subject: liveText(),
} as unknown as Filterable;

const inbox: Filter = and(
  clause("boxes", "hasAny", ["inbox"]),
  clause("subject", "contains", "hi"),
) as Filter;

const row = (id: string, boxes: string[], unread = true): Row => ({
  id,
  boxes,
  unread,
  subject: "hi there",
});

const archive = (key: string, ids: string[]) =>
  pushRowPatch(key, {
    ids: new Set(ids),
    columns: new Set(["boxes"]),
    apply: (r) => ({
      ...r,
      boxes: (r.boxes as string[]).filter((b) => b !== "inbox"),
    }),
  });

const keyOf = (r: Row) => r.id;
const window = () => ({ filter: inbox, filterable: FILTERABLE });

describe("filterVerdict", () => {
  it("decides only the known columns, the rest unknown", () => {
    const r = row("a", ["work"]);
    expect(filterVerdict(inbox, r, new Set(["boxes"]), FILTERABLE)).toBe(false);
    expect(
      filterVerdict(
        clause("subject", "contains", "zzz") as Filter,
        r,
        new Set(["boxes"]),
        FILTERABLE,
      ),
    ).toBe("unknown");
    expect(
      filterVerdict(inbox, row("a", ["inbox"]), new Set(["boxes"]), FILTERABLE),
    ).toBe("unknown");
  });
});

describe("overlayRows", () => {
  it("leaves a row out of a window its write moves it out of, and changes it elsewhere", () => {
    const rows = [row("a", ["inbox"]), row("b", ["inbox"])];
    const h = archive("t1", ["a"]);
    // Read the store through a pass: the entries are the module store's.
    const out = overlayRows(storeEntries("t1"), rows, keyOf, window);
    expect(out.map((r) => r.id)).toEqual(["b"]);
    const byId = overlayRows(storeEntries("t1"), rows, keyOf, null);
    expect(byId[0]!.boxes).toEqual([]);
    expect(byId[1]).toBe(rows[1]);
    h.drop();
    expect(overlayRows(storeEntries("t1"), rows, keyOf, window)).toBe(rows);
  });

  it("never removes a row its server values already put out", () => {
    // A thread whose server row already fails the filter (another clause's
    // per-message semantics held it in): the write does not move it.
    const rows = [row("a", ["work"])];
    const h = archive("t2", ["a"]);
    expect(
      overlayRows(storeEntries("t2"), rows, keyOf, window).map((r) => r.id),
    ).toEqual(["a"]);
    h.drop();
  });

  it("once acked, applies only to rows received before the ack", () => {
    const before = [row("a", ["inbox"])];
    const h = archive("t3", ["a"]);
    // Seen while pending: stamped before the ack.
    expect(overlayRows(storeEntries("t3"), before, keyOf, window)).toEqual([]);
    h.ack();
    expect(overlayRows(storeEntries("t3"), before, keyOf, window)).toEqual([]);
    // The server's answer after the ack wins — here it kept the row in.
    const after = [row("a", ["inbox"])];
    expect(overlayRows(storeEntries("t3"), after, keyOf, window)).toBe(after);
  });
});

const storeEntries = rowPatchesOf;

describe("overlayRows by frame", () => {
  it("a frame after the ack wins even when it hands back the same row objects (structural sharing)", () => {
    const rows = [row("a", ["inbox"])];
    const h = archive("t4", ["a"]);
    const stamp = (seq: number) => () => frameStamp("t4|tuple", seq);
    expect(
      overlayRows(storeEntries("t4"), rows, keyOf, window, stamp(1)),
    ).toEqual([]);
    h.ack();
    // The same frame: still the pre-ack one.
    expect(
      overlayRows(storeEntries("t4"), rows, keyOf, window, stamp(1)),
    ).toEqual([]);
    // The server put the row back exactly as it was: a new frame, the same objects.
    expect(overlayRows(storeEntries("t4"), rows, keyOf, window, stamp(2))).toBe(
      rows,
    );
  });
});
