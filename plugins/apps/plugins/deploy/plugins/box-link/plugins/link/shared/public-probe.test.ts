import { describe, expect, test } from "bun:test";
import type { PublicPath } from "../core";
import {
  classifyProbe,
  publicPathChanged,
  publicPathDown,
  reducePublicPath,
  turnedDown,
  type ProbeEnv,
  type ProbeOutcome,
} from "./public-probe";

const HEALTH = JSON.stringify({
  ok: true,
  startedAt: 1,
  boot: "settled",
  runId: "release-1",
  composition: "website",
});

describe("classifyProbe", () => {
  test("200 with equin's health answer is ok", () => {
    expect(
      classifyProbe({
        kind: "answered",
        status: 200,
        via: "1.1 Caddy",
        body: HEALTH,
      }),
    ).toEqual({ kind: "ok" });
  });

  test("200 that is not a health answer fails as status", () => {
    const out = classifyProbe({
      kind: "answered",
      status: 200,
      via: null,
      body: "<html>parked</html>",
    });
    expect(out.kind === "failed" && out.failure.kind).toBe("status");
  });

  test("Cloudflare's 52x is the edge, whatever via says", () => {
    for (const status of [520, 521, 522, 523, 524, 525, 526, 527]) {
      expect(
        classifyProbe({ kind: "answered", status, via: null, body: "" }),
      ).toEqual({ kind: "failed", failure: { kind: "edge", status } });
    }
  });

  test("502/503/504 through Caddy is the proxy", () => {
    expect(
      classifyProbe({
        kind: "answered",
        status: 502,
        via: "1.1 Caddy",
        body: "",
      }),
    ).toEqual({ kind: "failed", failure: { kind: "proxy", status: 502 } });
  });

  test("502 not through Caddy, or a 404, is a status", () => {
    const a = classifyProbe({
      kind: "answered",
      status: 502,
      via: null,
      body: "",
    });
    expect(a).toEqual({
      kind: "failed",
      failure: { kind: "status", status: 502, detail: "HTTP 502" },
    });
    const b = classifyProbe({
      kind: "answered",
      status: 404,
      via: "1.1 Caddy",
      body: "Not Found",
    });
    expect(b).toEqual({
      kind: "failed",
      failure: { kind: "status", status: 404, detail: "Not Found" },
    });
  });

  test("no answer", () => {
    expect(classifyProbe({ kind: "no-answer", error: "timed out" })).toEqual({
      kind: "failed",
      failure: { kind: "no-answer", error: "timed out" },
    });
  });
});

describe("reducePublicPath", () => {
  const T = 1_000_000;
  const up: ProbeEnv = { linkLive: true, deployRunning: false };
  const boxDown: ProbeEnv = { linkLive: false, deployRunning: false };
  const deploying: ProbeEnv = { linkLive: true, deployRunning: true };
  const ok: ProbeOutcome = { kind: "ok" };
  const e522: ProbeOutcome = {
    kind: "failed",
    failure: { kind: "edge", status: 522 },
  };
  const silent: ProbeOutcome = {
    kind: "failed",
    failure: { kind: "no-answer", error: "fetch failed" },
  };

  test("ok keeps its since; a recovery starts a new one", () => {
    const first = reducePublicPath({ kind: "pending" }, ok, up, T);
    expect(first).toEqual({ kind: "ok", since: T });
    expect(reducePublicPath(first, ok, up, T + 60_000)).toBe(first);
    const failing = reducePublicPath(first, e522, up, T + 60_000);
    expect(reducePublicPath(failing, ok, up, T + 120_000)).toEqual({
      kind: "ok",
      since: T + 120_000,
    });
  });

  test("consecutive answered failures count, since is the first miss", () => {
    let p: PublicPath = { kind: "ok", since: 0 };
    for (let i = 0; i < 3; i++) p = reducePublicPath(p, e522, up, T + i);
    expect(p).toEqual({
      kind: "failing",
      since: T,
      lastAt: T + 2,
      misses: 3,
      failure: { kind: "edge", status: 522 },
    });
    expect(publicPathDown(p)).toBe(true);
  });

  test("an answered failure counts even while the box is down", () => {
    const p = reducePublicPath({ kind: "pending" }, e522, boxDown, T);
    expect(p.kind === "failing" && p.misses).toBe(1);
  });

  test("no answer counts only while the link is live", () => {
    const a = reducePublicPath({ kind: "pending" }, silent, boxDown, T);
    expect(a.kind === "failing" && a.misses).toBe(0);
    const b = reducePublicPath(a, silent, up, T + 1);
    expect(b.kind === "failing" && b.misses).toBe(1);
  });

  test("nothing counts during a deploy", () => {
    const p = reducePublicPath({ kind: "pending" }, e522, deploying, T);
    expect(p.kind === "failing" && p.misses).toBe(0);
  });

  test("turnedDown fires once, on the threshold-crossing probe", () => {
    let p: PublicPath = { kind: "pending" };
    const crossings: number[] = [];
    for (let i = 0; i < 6; i++) {
      const next = reducePublicPath(p, e522, up, T + i);
      if (turnedDown(p, next)) crossings.push(i);
      p = next;
    }
    expect(crossings).toEqual([2]);
  });

  test("a gap between probes starts a new outage", () => {
    let p: PublicPath = { kind: "pending" };
    p = reducePublicPath(p, e522, up, T);
    p = reducePublicPath(p, e522, up, T + 60_000);
    // Main was stopped for an hour: the old count does not carry over.
    const after = reducePublicPath(p, e522, up, T + 3_600_000);
    expect(after).toMatchObject({
      since: T + 3_600_000,
      misses: 1,
    });
    expect(turnedDown(p, after)).toBe(false);
  });

  test("an ok record is no change; a failing one moves its lastAt", () => {
    const ok1 = reducePublicPath({ kind: "pending" }, ok, up, T);
    expect(publicPathChanged(ok1, reducePublicPath(ok1, ok, up, T + 1))).toBe(
      false,
    );
    const a = reducePublicPath({ kind: "pending" }, silent, boxDown, T);
    const b = reducePublicPath(a, silent, boxDown, T + 60_000);
    expect(b).toMatchObject({ misses: 0, since: T, lastAt: T + 60_000 });
  });
});
