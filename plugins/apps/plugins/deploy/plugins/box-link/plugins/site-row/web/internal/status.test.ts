import { describe, expect, it } from "bun:test";
import type { LinkState } from "@plugins/apps/plugins/deploy/plugins/box-link/core";
import type { SiteHealth } from "@plugins/apps/plugins/deploy/plugins/box-link/plugins/link/core";

type RunStatus = NonNullable<SiteHealth["run"]>["status"];
import { siteAlert, siteFreshness, siteStatus, siteTitle } from "./status";

const T = Date.parse("2026-11-19T18:00:00Z");

function site(
  state: LinkState | "main-only",
  {
    run = null,
    behind = 0,
    publicPath = { kind: "ok", since: T },
  }: {
    run?: RunStatus | null;
    behind?: number;
    publicPath?: SiteHealth["publicPath"];
  } = {},
): SiteHealth {
  return {
    deploymentId: "dpl-1",
    compositionId: "website",
    hostname: "equin.ai",
    link:
      state === "main-only"
        ? { kind: "main-only" }
        : {
            kind: "linked",
            link: {
              deploymentId: "dpl-1",
              state,
              since: T,
              lastHeardAt: T,
              lastBeat: null,
              lastError: null,
              hello: null,
            },
          },
    run:
      run === null
        ? null
        : {
            id: "drun-1",
            verb: "update",
            phase: "ship",
            status: run,
            startedAt: new Date(T).toISOString(),
            finishedAt: run === "running" ? null : new Date(T).toISOString(),
            message: run === "failed" ? "health check failed" : null,
          },
    release: {
      kind: "known",
      sha: "abcdef0123456789",
      subject: "s",
      behindMain: behind,
      mainSha: "f".repeat(40),
    },
    publicPath,
  };
}

const LIVE: LinkState = { kind: "live" };

describe("siteStatus", () => {
  it("is ok while live and up to date", () => {
    expect(siteStatus(site(LIVE))).toEqual({
      state: "ok",
      summary: "Live · abcdef0 · up to date",
    });
  });

  it("is ok, naming the commits, while behind main", () => {
    const s = siteStatus(site(LIVE, { behind: 142 }));
    expect(s.state).toBe("ok");
    expect(s.summary).toBe("Live · abcdef0 · 142 commits behind main");
  });

  it("is info and transitioning while deploying", () => {
    const s = siteStatus(site(LIVE, { run: "running" }));
    expect(s).toMatchObject({ state: "info", transitioning: true });
  });

  it("reads a restart in flight as restarting, even while down", () => {
    const down = site({ kind: "down" }, { run: "running" });
    const restarting: SiteHealth = {
      ...down,
      run:
        down.run === null
          ? null
          : { ...down.run, verb: "restart", phase: null },
    };
    expect(siteStatus(restarting)).toEqual({
      state: "info",
      transitioning: true,
      summary: `Restarting · since ${new Date(T).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })}`,
    });
    // An update in flight does not hide an outage.
    expect(siteStatus(down).state).toBe("critical");
  });

  it("needs attention after a failed deploy, or a release too old", () => {
    expect(siteStatus(site(LIVE, { run: "failed" })).state).toBe("attention");
    expect(
      siteStatus(site({ kind: "outdated", reason: "route-missing" })).state,
    ).toBe("attention");
  });

  it("needs attention, transitioning, while reconnecting", () => {
    const s = siteStatus(
      site({
        kind: "reconnecting",
        cause: "slept",
        graceUntil: T + 60_000,
        then: "down",
        sshKind: null,
      }),
    );
    expect(s).toMatchObject({ state: "attention", transitioning: true });
  });

  it("is critical while down, unreachable or refused — whatever the run did", () => {
    for (const state of [
      { kind: "down" },
      { kind: "unreachable", sshKind: null },
      { kind: "refused", reason: "forwarding-refused" },
    ] satisfies LinkState[]) {
      expect(siteStatus(site(state, { run: "running" })).state).toBe(
        "critical",
      );
    }
  });

  it("is not known yet while connecting", () => {
    expect(siteStatus(site({ kind: "connecting" }))).toEqual({
      state: "unknown",
    });
  });

  it("says a real box seen from a worktree is linked from main", () => {
    expect(siteStatus(site("main-only")).summary).toBe(
      "Linked from main · abcdef0 · up to date",
    );
  });
});

describe("siteFreshness / siteAlert / siteTitle", () => {
  it("dims only a linked site whose link is not live", () => {
    expect(siteFreshness(site(LIVE))).toEqual({ kind: "live" });
    expect(siteFreshness(site({ kind: "down" }))).toEqual({
      kind: "stale",
      lastHeardAt: T,
    });
    expect(siteFreshness(site("main-only"))).toEqual({ kind: "elsewhere" });
  });

  it("alerts on a lost link before a failed run, and not on a healthy site", () => {
    expect(siteAlert(site(LIVE))).toBeNull();
    expect(siteAlert(site({ kind: "down" }))?.tone).toBe("critical");
    expect(siteAlert(site(LIVE, { run: "failed" }))?.lead).toBe(
      "health check failed",
    );
  });

  it("names a site by its hostname, else its composition", () => {
    expect(siteTitle(site(LIVE))).toBe("equin.ai");
    expect(siteTitle({ ...site(LIVE), hostname: null })).toBe("website");
  });
});

describe("siteAlert on a refused link", () => {
  it("says why and what to do: re-run the install command, then Retry", () => {
    expect(
      siteAlert(site({ kind: "refused", reason: "forwarding-refused" })),
    ).toEqual({
      tone: "critical",
      lead: "Can't connect: forwarding is disabled on the server",
      rest: "run the install command from the server's SSH key section again (it now allows the link's loopback forward), then Retry now",
    });
  });
});

describe("the public path", () => {
  const failing = (misses: number): SiteHealth["publicPath"] => ({
    kind: "failing",
    since: T,
    lastAt: T,
    misses,
    failure: { kind: "edge", status: 522 },
  });

  it("is attention, transitioning, below the threshold", () => {
    expect(siteStatus(site(LIVE, { publicPath: failing(1) }))).toMatchObject({
      state: "attention",
      transitioning: true,
    });
    expect(siteAlert(site(LIVE, { publicPath: failing(1) }))).toMatchObject({
      tone: "warning",
      lead: "Public site: Cloudflare can't reach the server (522)",
    });
  });

  it("is critical from the threshold, and says where it broke", () => {
    const s = site(LIVE, { publicPath: failing(3) });
    expect(siteStatus(s).state).toBe("critical");
    expect(siteStatus(s).summary).toStartWith("Public site down since");
    expect(siteAlert(s)?.tone).toBe("critical");
  });

  it("yields to the link's own state: a box that does not answer reads as that", () => {
    const s = site({ kind: "down" }, { publicPath: failing(5) });
    expect(siteStatus(s).summary).toStartWith("Not answering since");
    expect(siteAlert(s)?.lead).toBe(
      "The server answers SSH, but equin is not running on it",
    );
  });

  it("yields to a deploy in progress", () => {
    const s = site(LIVE, { run: "running", publicPath: failing(5) });
    expect(siteStatus(s).state).toBe("info");
    expect(siteAlert(s)).toBeNull();
  });

  it("says nothing of an uncounted miss, or while the link is not live", () => {
    expect(siteStatus(site(LIVE, { publicPath: failing(0) })).state).toBe("ok");
    expect(siteAlert(site(LIVE, { publicPath: failing(0) }))).toBeNull();
    const connecting = site({ kind: "connecting" }, { publicPath: failing(5) });
    expect(siteStatus(connecting).state).toBe("unknown");
    expect(siteAlert(connecting)).toBeNull();
  });

  it("is ok while ok, pending or unwatched", () => {
    for (const publicPath of [
      { kind: "pending" },
      { kind: "unwatched" },
    ] as const) {
      expect(siteStatus(site(LIVE, { publicPath })).state).toBe("ok");
    }
  });
});
