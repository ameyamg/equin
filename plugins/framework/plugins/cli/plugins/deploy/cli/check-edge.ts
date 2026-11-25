/**
 * `./equin deploy check-edge <hostname> [--uncached <path>…]` — ask the live
 * site whether its caches do what the code says: the shell stored at the edge
 * yet revalidated by the browser, the API never
 * stored at the edge, a content-addressed module stored, a missing module not
 * pinned, and every `--uncached` path (the site's film) never stored.
 *
 * Reads only public answers, so it is safe against production and needs no
 * deployment record. Exits 1 on any failed probe, naming each.
 */
import type { CliAction } from "@plugins/framework/plugins/cli/core";
import {
  answeringEdge,
  edgeProbes,
  firstArtifactPath,
  judgeProbe,
  type ProbeAnswer,
} from "./internal/edge-cache";
import { refuse } from "./internal/target";

/** One request's answer; the body is drained so the connection can be reused. */
async function probe(url: string): Promise<ProbeAnswer & { body: string }> {
  const res = await fetch(url, {
    redirect: "manual",
    headers: { "user-agent": "equin-check-edge" },
  });
  const body = await res.text();
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return { status: res.status, headers, body };
}

const run: CliAction<[string], { uncached?: string[] }> = async (
  hostname,
  opts,
) => {
  const origin = `https://${hostname}`;
  const shell = await probe(`${origin}/`);
  const artifactPath = firstArtifactPath(shell.body);
  if (artifactPath === null) {
    refuse(
      `${origin}/ names no /artifacts/ module — this is not an equin site shell.`,
    );
  }
  const edge = answeringEdge(shell);
  console.log(
    `Checking ${origin} (edge: ${edge === "cloudflare" ? "Cloudflare" : "none — the origin answers directly"})`,
  );

  for (const path of opts.uncached ?? []) {
    if (!path.startsWith("/"))
      refuse(`--uncached ${path}: a path starts with "/".`);
  }
  const probes = edgeProbes({
    artifactPath,
    missingArtifactPath: `/artifacts/check-edge.${Date.now().toString(36)}/missing.js`,
    extraUncached: opts.uncached ?? [],
  });

  let failed = 0;
  for (const p of probes) {
    const first = await probe(`${origin}${p.path}`);
    const second = await probe(`${origin}${p.path}`);
    const verdict = judgeProbe(p, first, second);
    console.log(`  ${verdict.ok ? "✓" : "✗"} ${p.path} — ${verdict.detail}`);
    if (!verdict.ok) {
      failed++;
      console.log(`      expected ${p.expect}: ${p.why}`);
    }
  }
  if (failed > 0) {
    console.error(`\ncheck-edge: ${failed} of ${probes.length} probes failed.`);
    process.exit(1);
  }
  console.log(`\n[done] ${probes.length} probes pass.`);
};

export default run;
