import { z } from "zod";
import { rm } from "node:fs/promises";
import { readdir, stat } from "@plugins/packages/plugins/timed-fs/core";
import { defineJob } from "@plugins/infra/plugins/jobs/server";
import { siteFeedsStagingDir } from "../../data-dirs";

/** A staged file older than this was left by a publish that never asked for its import. */
export const STAGED_FILE_TTL_MS = 24 * 60 * 60 * 1000;

/** The staged names `sweepStaged` deletes: modified before `now - ttl`. Pure. */
export function staleStaged(
  files: readonly { name: string; mtimeMs: number }[],
  nowMs: number,
  ttlMs = STAGED_FILE_TTL_MS,
): string[] {
  return files.filter((f) => f.mtimeMs < nowMs - ttlMs).map((f) => f.name);
}

/**
 * Delete what an interrupted publish left in the staging dir. Its import
 * removes each file it reads, so only abandoned copies are here. A scheduled
 * job: a file going stale has no change signal.
 */
export const siteFeedsStagingSweepJob = defineJob({
  name: "site-feeds.staging-sweep",
  description:
    "Deletes site-feed media files staged on the box more than a day ago and never imported.",
  // seconds: one listing and a few unlinks of one small directory.
  hold: "seconds",
  input: z.object({}),
  event: z.never(),
  // A deployed release is never main; its own data root holds its staging.
  dedup: "singleton",
  schedule: { cron: "25 4 * * *", perWorktree: true },
  async run() {
    const dir = await siteFeedsStagingDir.ensure();
    const names = await readdir(dir);
    const files = await Promise.all(
      names.map(async (name) => ({
        name,
        mtimeMs: (await stat(siteFeedsStagingDir.file(name))).mtimeMs,
      })),
    );
    for (const name of staleStaged(files, Date.now())) {
      await rm(siteFeedsStagingDir.file(name), { force: true });
    }
  },
});
