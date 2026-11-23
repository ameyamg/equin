import { describe, expect, test } from "bun:test";
import { RESOURCE_TIMING_BUFFER_SIZE } from "@plugins/primitives/plugins/perfs/plugins/boot-trace/core";
import { SITE_REPORT_LIMITS } from "@plugins/apps/plugins/deploy/plugins/site-reports/plugins/intake/core";
import {
  buildLoadSplit,
  LoadSplitSchema,
  type LoadRecords,
  type ResourceFields,
} from "./load-split";
import {
  judgeHiddenLoad,
  judgeReadyLoad,
  SlowPageLoadPayloadSchema,
  slowPageLoadSummary,
  withLoadSplit,
} from "./slow-load";

const origin = "https://equin.ai";

function file(
  name: string,
  startTime: number,
  responseEnd: number,
  over: Partial<ResourceFields> = {},
): ResourceFields {
  return {
    name,
    initiatorType: "other",
    startTime,
    requestStart: startTime + 10,
    responseStart: startTime + 50,
    responseEnd,
    transferSize: 10_000,
    nextHopProtocol: "h3",
    ...over,
  };
}

function records(over: Partial<LoadRecords> = {}): LoadRecords {
  return {
    origin,
    documentEndMs: 90,
    resources: [],
    longTasks: null,
    spans: [],
    openSpans: [],
    retries: 0,
    ...over,
  };
}

const ctx = {
  firstByte: null,
  client: { family: "chrome", os: "windows" },
  connection: "4g",
} as const;

describe("buildLoadSplit", () => {
  test("reads a browser entry, whose fields are getters on its prototype", () => {
    // PerformanceResourceTiming's shape: no own properties, so a spread of
    // it is `{}` (equin.ai, 2026-11-23: "reading 'startsWith'" in filePath).
    class Entry {
      readonly #f: ResourceFields;
      constructor(f: ResourceFields) {
        this.#f = f;
      }
      get name() {
        return this.#f.name;
      }
      get initiatorType() {
        return this.#f.initiatorType;
      }
      get startTime() {
        return this.#f.startTime;
      }
      get requestStart() {
        return this.#f.requestStart;
      }
      get responseStart() {
        return this.#f.responseStart;
      }
      get responseEnd() {
        return this.#f.responseEnd;
      }
      get transferSize() {
        return this.#f.transferSize;
      }
      get nextHopProtocol() {
        return this.#f.nextHopProtocol;
      }
    }
    const split = buildLoadSplit(
      records({
        resources: [new Entry(file(`${origin}/artifacts/a.js`, 100, 900))],
      }),
      2_000,
    );
    expect(split.slowest).toEqual([
      {
        path: "/artifacts/a.js",
        by: "other",
        startMs: 100,
        queueMs: 10,
        waitMs: 40,
        downloadMs: 750,
        totalMs: 800,
        bytes: 10_000,
        protocol: "h3",
      },
    ]);
    expect(LoadSplitSchema.parse(split)).toEqual(split);
  });

  test("a stalled file stands out: which, when and in which part", () => {
    const split = buildLoadSplit(
      records({
        resources: [
          file(`${origin}/artifacts/a/index.js`, 100, 900),
          file(`${origin}/artifacts/b/slow.js?secret=1`, 120, 30_120),
          file(`${origin}/late.js`, 40_000, 40_100),
        ],
      }),
      33_072,
    );
    expect(split.files).toBe(2);
    expect(split.bytes).toBe(20_000);
    expect(split.lastFileEndMs).toBe(30_120);
    expect(split.inFlight).toBe(0);
    expect(split.slowest[0]).toMatchObject({
      path: "/artifacts/b/slow.js",
      queueMs: 10,
      waitMs: 40,
      downloadMs: 29_950,
      totalMs: 30_000,
    });
  });

  test("only the site's own files are named", () => {
    const split = buildLoadSplit(
      records({
        resources: [
          file("chrome-extension://abcdef/inject.js", 1, 500),
          file("https://equin.ai.evil.test/x.js", 1, 400),
          file(`blob:${origin}/1234`, 1, 300),
        ],
      }),
      1_000,
    );
    expect(split.slowest.map((f) => f.path)).toEqual(
      Array(3).fill("(another origin)"),
    );
  });

  test("a load hidden before it booted is cut at the hide, not at the boot", () => {
    const split = buildLoadSplit(
      records({
        resources: [
          file(`${origin}/a.js`, 100, 900),
          file(`${origin}/b.js`, 200, 40_000),
        ],
        spans: [
          {
            id: "boot-tasks",
            phase: "boot-tasks",
            label: "",
            startMs: 3_000,
            durationMs: 37_000,
          },
          {
            id: "res:x",
            phase: "resources",
            label: "",
            startMs: 400,
            durationMs: 4_000,
          },
        ],
      }),
      5_000,
    );
    expect(split).toMatchObject({ lastFileEndMs: 5_000, inFlight: 1 });
    expect(split.slowest[0]).toMatchObject({ path: "/b.js", totalMs: 4_800 });
    expect(split.spans).toEqual([
      { id: "boot-tasks", startMs: 3_000, durationMs: 2_000 },
    ]);
  });

  test("a request the browser did not time has no parts", () => {
    const split = buildLoadSplit(
      records({
        resources: [
          file(`${origin}/x.js`, 10, 900, {
            requestStart: 0,
            responseStart: 0,
          }),
        ],
      }),
      1_000,
    );
    expect(split.slowest[0]).toMatchObject({
      queueMs: null,
      waitMs: null,
      downloadMs: null,
      totalMs: 890,
    });
  });

  test("main thread work is clipped to the wait, and null where untimed", () => {
    const longTasks = [
      { startMs: 100, durationMs: 400, name: "self" },
      { startMs: 900, durationMs: 600, name: "self" },
      { startMs: 1_200, durationMs: 80, name: "self" },
    ];
    expect(buildLoadSplit(records({ longTasks }), 1_000).mainThread).toEqual({
      busyMs: 500,
      longestMs: 400,
    });
    expect(buildLoadSplit(records(), 1_000).mainThread).toBeNull();
  });

  test("a buffer the shell could not raise says so at the browser's 250", () => {
    const resources = Array.from({ length: 250 }, (_, i) =>
      file(`${origin}/${i}.js`, i, i + 100),
    );
    expect(buildLoadSplit(records({ resources }), 9_000).filesTruncated).toBe(
      true,
    );
  });

  test("a filled buffer says files are missing", () => {
    const resources = Array.from(
      { length: RESOURCE_TIMING_BUFFER_SIZE },
      (_, i) => file(`${origin}/${i}.js`, i, i + 100),
    );
    expect(buildLoadSplit(records({ resources }), 9_000).filesTruncated).toBe(
      true,
    );
  });

  test("painted late with the content long committed, or never committed, are told apart", () => {
    const at = (id: string, startMs: number) => ({
      id,
      phase: "paint" as const,
      label: "",
      startMs,
      durationMs: 0,
    });
    const held = buildLoadSplit(
      records({
        spans: [at("module-eval", 600), at("route-content-commit", 940)],
      }),
      33_072,
    );
    expect(held).toMatchObject({ codeRanMs: 600, contentMs: 940 });
    const waiting = buildLoadSplit(
      records({
        spans: [at("module-eval", 600), at("route-content-commit", 50_000)],
        openSpans: [{ id: "boot-tasks", startMs: 900 }],
      }),
      47_600,
    );
    expect(waiting).toMatchObject({
      contentMs: null,
      waitingOn: ["boot-tasks"],
    });
  });

  test("no records is a split that still parses", () => {
    const split = buildLoadSplit(records({ documentEndMs: 0 }), 5_000);
    expect(LoadSplitSchema.parse(split)).toEqual(split);
    expect(split.documentEndMs).toBeNull();
    expect(split.lastFileEndMs).toBeNull();
  });
});

describe("withLoadSplit", () => {
  test("is read up to ready, or up to the hide", () => {
    const asked: number[] = [];
    const read = (untilMs: number) => {
      asked.push(untilMs);
      return buildLoadSplit(records(), untilMs);
    };
    const m = { ttfbMs: 30, fcpMs: null, readyMs: 4_000 };
    withLoadSplit(judgeReadyLoad(m, ctx)!, read);
    withLoadSplit(judgeHiddenLoad(m, 25_937, ctx)!, read);
    expect(asked).toEqual([4_000, 25_937]);
  });

  test("the fullest payload fits the intake, and its cause the import's 300 characters", () => {
    const resources = Array.from({ length: 12 }, (_, i) =>
      file(`${origin}/artifacts/${"x".repeat(200)}/${i}.js`, 100, 30_000 + i, {
        initiatorType: "x".repeat(40),
        nextHopProtocol: "p".repeat(64),
      }),
    );
    const openSpans = Array.from({ length: 12 }, () => ({
      id: "o".repeat(200),
      startMs: 10,
    }));
    const spans = Array.from({ length: 12 }, (_, i) => ({
      id: "s".repeat(200),
      phase: "resources" as const,
      label: "",
      startMs: i,
      durationMs: 1_000,
    }));
    const longTasks = [{ startMs: 5, durationMs: 1_200, name: "self" }];
    const firstByte = {
      beforeFetchMs: 28,
      queueMs: 1_926,
      dnsMs: 1,
      stallMs: 4,
      tcpMs: 214,
      tlsMs: 499,
      sendMs: 1,
      waitMs: 219,
      otherMs: 1_931,
      totalMs: 2_892,
      protocol: "h2",
    };
    const payload = withLoadSplit(
      judgeReadyLoad(
        { ttfbMs: 2_892, fcpMs: 33_072, readyMs: 33_072 },
        { ...ctx, firstByte },
      )!,
      (until) =>
        buildLoadSplit(
          records({ resources, spans, openSpans, longTasks, retries: 2 }),
          until,
        ),
    );
    expect(SlowPageLoadPayloadSchema.parse(payload)).toEqual(payload);
    expect(
      new TextEncoder().encode(JSON.stringify(payload)).byteLength,
    ).toBeLessThan(SITE_REPORT_LIMITS.maxDataBytes);
    const kept = slowPageLoadSummary(payload).slice(0, 300);
    expect(kept).toContain("12 files 0.1 MB in by 30.0 s");
    expect(kept).toContain("CPU 1.2 s");
    expect(kept).toContain("retried 2×");
  });
});
