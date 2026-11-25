import { describe, expect, test } from "bun:test";
import {
  edgeProbes,
  firstArtifactPath,
  judgeProbe,
  type EdgeProbe,
  type ProbeAnswer,
} from "./edge-cache";

const cf = (
  status: number,
  cfStatus: string,
  cacheControl = "",
): ProbeAnswer => ({
  status,
  headers: {
    "cf-ray": "8a1b2c3d4e5f-CDG",
    "cf-cache-status": cfStatus,
    ...(cacheControl ? { "cache-control": cacheControl } : {}),
  },
});
const direct = (status: number, cacheControl = ""): ProbeAnswer => ({
  status,
  headers: cacheControl ? { "cache-control": cacheControl } : {},
});

const artifact: EdgeProbe = {
  path: "/artifacts/chunk.abc/index.js",
  expect: "edge-cached",
  status: 200,
  why: "",
};
const shell: EdgeProbe = {
  path: "/",
  expect: "edge-cached-revalidated",
  status: 200,
  why: "",
};
const api: EdgeProbe = {
  path: "/api/health",
  expect: "never-edge-cached",
  status: 200,
  why: "",
};

describe("firstArtifactPath", () => {
  test("finds the first module the shell names", () => {
    expect(
      firstArtifactPath(
        `<script type="importmap">{"imports":{"a":"/artifacts/chunk.0a/index.js","b":"/artifacts/chunk.0b/index.js"}}</script>`,
      ),
    ).toBe("/artifacts/chunk.0a/index.js");
  });

  test("null when the shell names none", () => {
    expect(firstArtifactPath("<html></html>")).toBeNull();
  });
});

describe("edgeProbes", () => {
  test("the shell, the API, an artifact, a missing artifact, then the named paths", () => {
    const probes = edgeProbes({
      artifactPath: "/artifacts/chunk.0a/index.js",
      missingArtifactPath: "/artifacts/missing.1/index.js",
      extraUncached: ["/api/asset-mirror/website-media/film.mp4"],
    });
    expect(probes.map((p) => [p.path, p.expect, p.status])).toEqual([
      ["/", "edge-cached-revalidated", 200],
      ["/api/health", "never-edge-cached", 200],
      ["/artifacts/chunk.0a/index.js", "edge-cached", 200],
      ["/artifacts/missing.1/index.js", "never-edge-cached", 404],
      ["/api/asset-mirror/website-media/film.mp4", "never-edge-cached", 200],
    ]);
  });
});

describe("judgeProbe behind Cloudflare", () => {
  test("an artifact is a HIT the second time", () => {
    expect(judgeProbe(artifact, cf(200, "MISS"), cf(200, "HIT")).ok).toBe(true);
  });

  test("an artifact that is never stored fails", () => {
    const verdict = judgeProbe(
      artifact,
      cf(200, "MISS"),
      cf(200, "MISS", "no-cache"),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("expected HIT");
  });

  test("the shell is a HIT, and the browser still revalidates", () => {
    expect(
      judgeProbe(shell, cf(200, "MISS", "no-cache"), cf(200, "HIT", "no-cache"))
        .ok,
    ).toBe(true);
    const dynamic = judgeProbe(
      shell,
      cf(200, "DYNAMIC", "no-cache"),
      cf(200, "DYNAMIC", "no-cache"),
    );
    expect(dynamic.ok).toBe(false);
    expect(dynamic.detail).toContain("expected HIT");
  });

  test("a shell the browser may keep fails even when the edge has it", () => {
    const verdict = judgeProbe(
      shell,
      cf(200, "MISS", "max-age=600"),
      cf(200, "HIT", "max-age=600"),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("expected no-cache");
  });

  test("the API must not be a HIT", () => {
    expect(judgeProbe(api, cf(200, "DYNAMIC"), cf(200, "DYNAMIC")).ok).toBe(
      true,
    );
    expect(judgeProbe(api, cf(200, "MISS"), cf(200, "HIT")).ok).toBe(false);
  });

  test("a wrong status fails before the cache is read", () => {
    const verdict = judgeProbe(artifact, cf(404, "MISS"), cf(404, "HIT"));
    expect(verdict).toEqual({
      ok: false,
      detail: "answered 404, expected 200",
    });
  });
});

describe("judgeProbe with no CDN in front", () => {
  test("an edge-cached URL must still be immutable at the origin", () => {
    expect(
      judgeProbe(
        artifact,
        direct(200, "public, max-age=31536000, immutable"),
        direct(200, "public, max-age=31536000, immutable"),
      ).ok,
    ).toBe(true);
    expect(judgeProbe(artifact, direct(200), direct(200)).ok).toBe(false);
  });

  test("a never-cached URL passes on its status alone", () => {
    expect(judgeProbe(api, direct(200), direct(200)).ok).toBe(true);
  });

  test("the shell must tell the browser no-cache", () => {
    expect(
      judgeProbe(shell, direct(200, "no-cache"), direct(200, "no-cache")).ok,
    ).toBe(true);
    expect(judgeProbe(shell, direct(200), direct(200)).ok).toBe(false);
  });
});
