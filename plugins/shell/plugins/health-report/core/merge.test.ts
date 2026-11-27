import { describe, expect, it } from "bun:test";
import { symbol } from "@plugins/ui/plugins/icons/core";
import {
  mergeDot,
  mergeHealth,
  placeRows,
  standsOut,
  verdictOf,
  type ReportedStatus,
} from "./merge";
import type { HealthStatus } from "./types";

const ok = (summary = "fine"): HealthStatus => ({ state: "ok", summary });
const attention = (summary = "look", transitioning = false): HealthStatus => ({
  state: "attention",
  summary,
  transitioning,
});
const critical = (summary = "broken"): HealthStatus => ({
  state: "critical",
  summary,
});
const info = (summary = "fyi", transitioning = false): HealthStatus => ({
  state: "info",
  summary,
  transitioning,
});
const notApplicable = (summary = "Not here."): HealthStatus => ({
  state: "not-applicable",
  summary,
});

describe("mergeDot", () => {
  const mark = (id: string) => ({
    id,
    icon: symbol("speed"),
    label: id,
  });
  const busy = (...ids: string[]): HealthStatus => ({
    state: "attention",
    summary: "busy",
    ambient: ids.map(mark),
  });

  it("folds an ambient row as ok and carries its marks", () => {
    const dot = mergeDot([ok(), busy("cpu", "memory")]);
    expect(dot.state).toBe("ok");
    expect(dot.count).toBe(0);
    expect(dot.marks.map((m) => m.id)).toEqual(["cpu", "memory"]);
  });

  it("still colours the dot for every other row", () => {
    const dot = mergeDot([busy("cpu"), attention()]);
    expect(dot.state).toBe("attention");
    expect(dot.count).toBe(1);
    expect(dot.marks.map((m) => m.id)).toEqual(["cpu"]);
  });

  it("leaves the report's own merge counting the ambient row", () => {
    expect(mergeHealth([ok(), busy("cpu")]).state).toBe("attention");
    expect(verdictOf([ok(), busy("cpu")])).toBe("busy");
  });
});

describe("info", () => {
  it("ranks below attention and unknown, above ok, and is never counted", () => {
    expect(mergeHealth([ok(), info()])).toMatchObject({
      state: "info",
      count: 0,
    });
    expect(mergeHealth([info(), attention()]).state).toBe("attention");
    expect(mergeHealth([info(), { state: "unknown" }]).state).toBe("unknown");
    expect(mergeHealth([info(), attention()]).count).toBe(1);
  });

  it("pulses while transitioning (work under way)", () => {
    expect(mergeDot([ok(), info("Deploying", true)])).toMatchObject({
      state: "info",
      transitioning: true,
    });
  });

  it("says the one informative row's own words, or how many", () => {
    expect(verdictOf([ok(), info("142 commits behind main")])).toBe(
      "142 commits behind main",
    );
    expect(
      verdictOf([
        { state: "info", title: "equin is out of date", summary: "a → b" },
      ]),
    ).toBe("equin is out of date");
    expect(verdictOf([info(), info()])).toBe("2 things to know");
  });
});

describe("mergeHealth", () => {
  it("is ok, with nothing pending, over zero rows", () => {
    expect(mergeHealth([])).toEqual({
      state: "ok",
      count: 0,
      transitioning: false,
      pending: false,
    });
  });

  it("is ok when every row is ok", () => {
    expect(mergeHealth([ok(), ok()]).state).toBe("ok");
  });

  it("ranks critical over attention over unknown over ok", () => {
    expect(mergeHealth([ok(), attention(), critical()]).state).toBe("critical");
    expect(mergeHealth([ok(), attention(), { state: "unknown" }]).state).toBe(
      "attention",
    );
    expect(mergeHealth([ok(), { state: "unknown" }]).state).toBe("unknown");
  });

  it("lets an unreported row outrank ok, so green is never claimed early", () => {
    const merged = mergeHealth([ok(), undefined]);
    expect(merged.state).toBe("unknown");
    expect(merged.pending).toBe(true);
  });

  it("treats an unknown with a summary as unreadable, not pending", () => {
    const merged = mergeHealth([
      ok(),
      { state: "unknown", summary: "This check crashed" },
    ]);
    expect(merged.state).toBe("unknown");
    expect(merged.pending).toBe(false);
  });

  it("counts only attention and critical rows", () => {
    expect(
      mergeHealth([
        ok(),
        attention(),
        critical(),
        undefined,
        { state: "unknown" },
      ]).count,
    ).toBe(2);
  });

  it("leaves a not-applicable row out, as if it were not registered", () => {
    expect(mergeHealth([ok(), notApplicable()])).toEqual(mergeHealth([ok()]));
    expect(mergeHealth([notApplicable()])).toEqual(mergeHealth([]));
    expect(mergeHealth([attention(), notApplicable()]).count).toBe(1);
  });

  it("leaves an absent row out, as if it were not registered", () => {
    const absent: HealthStatus = { state: "absent" };
    expect(mergeHealth([ok(), absent])).toEqual(mergeHealth([ok()]));
    expect(mergeHealth([absent])).toEqual(mergeHealth([]));
  });

  it("is transitioning when any row is transitioning", () => {
    expect(mergeHealth([ok(), attention("x", true)]).transitioning).toBe(true);
    expect(mergeHealth([ok(), attention("x", false)]).transitioning).toBe(
      false,
    );
  });
});

describe("verdictOf", () => {
  it("says all systems normal when everything is ok, and over zero rows", () => {
    expect(verdictOf([ok()])).toBe("All systems normal");
    expect(verdictOf([])).toBe("All systems normal");
  });

  it("says checking while a row has not reported", () => {
    expect(verdictOf([ok(), undefined])).toBe("Checking…");
    expect(verdictOf([ok(), { state: "unknown" }])).toBe("Checking…");
  });

  it("names the one unreadable row's reason once everything has reported", () => {
    expect(
      verdictOf([ok(), { state: "unknown", summary: "This check crashed" }]),
    ).toBe("This check crashed");
    expect(
      verdictOf([
        { state: "unknown", summary: "a" },
        { state: "unknown", summary: "b" },
      ]),
    ).toBe("2 checks can't be read right now");
  });

  it("uses the one non-green row's own summary", () => {
    expect(verdictOf([ok(), critical("Server disconnected")])).toBe(
      "Server disconnected",
    );
    expect(verdictOf([attention("Reconnecting…"), undefined])).toBe(
      "Reconnecting…",
    );
  });

  it("ignores not-applicable rows", () => {
    expect(verdictOf([ok(), notApplicable()])).toBe("All systems normal");
    expect(verdictOf([notApplicable(), notApplicable()])).toBe(
      "All systems normal",
    );
    expect(
      verdictOf([notApplicable(), { state: "unknown", summary: "crashed" }]),
    ).toBe("crashed");
  });

  it("names the one row needing a look by its state's own title", () => {
    expect(
      verdictOf([
        ok(),
        { state: "attention", summary: "1.0 → 2.0", title: "Out of date" },
      ]),
    ).toBe("Out of date");
  });

  it("counts several non-green rows", () => {
    expect(verdictOf([attention(), critical(), ok()])).toBe(
      "2 things need attention",
    );
  });
});

describe("standsOut", () => {
  it("is true for everything that moves the dot off green", () => {
    expect(standsOut(attention())).toBe(true);
    expect(standsOut(critical())).toBe(true);
    expect(standsOut(info())).toBe(true);
    expect(standsOut({ state: "unknown", summary: "crashed" })).toBe(true);
  });

  it("is false for a fine, inapplicable, absent or not-yet-known row", () => {
    expect(standsOut(ok())).toBe(false);
    expect(standsOut(notApplicable())).toBe(false);
    expect(standsOut({ state: "absent" })).toBe(false);
    expect(standsOut({ state: "unknown" })).toBe(false);
    expect(standsOut(undefined)).toBe(false);
  });
});

describe("placeRows", () => {
  const place = (
    rows: { id: string; status: ReportedStatus; overflow: boolean }[],
  ) => {
    const { shown, tucked } = placeRows(
      rows.map((r) => ({ row: r, overflow: r.overflow })),
      (r) => r.status,
    );
    return {
      shown: shown.map((r) => r.id),
      tucked: tucked.map((r) => r.id),
    };
  };

  it("keeps the layout order, the overflow rows behind the chevron", () => {
    expect(
      place([
        { id: "a", status: ok(), overflow: false },
        { id: "x", status: ok(), overflow: true },
        { id: "b", status: attention(), overflow: false },
        { id: "y", status: notApplicable(), overflow: true },
      ]),
    ).toEqual({ shown: ["a", "b"], tucked: ["x", "y"] });
  });

  it("brings an overflow row that stands out into view, after the placed rows", () => {
    expect(
      place([
        { id: "x", status: critical(), overflow: true },
        { id: "a", status: ok(), overflow: false },
        { id: "y", status: ok(), overflow: true },
        { id: "z", status: info(), overflow: true },
        { id: "b", status: ok(), overflow: false },
      ]),
    ).toEqual({ shown: ["a", "b", "x", "z"], tucked: ["y"] });
  });

  it("leaves an overflow row not known yet tucked", () => {
    expect(place([{ id: "x", status: undefined, overflow: true }])).toEqual({
      shown: [],
      tucked: ["x"],
    });
  });
});
