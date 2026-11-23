import { registerPluginTokens } from "@plugins/framework/plugins/server-core/core/testing";
import { isJobToken } from "../internal/registry";

/**
 * Register the jobs `pluginPaths` register, for a headless suite whose code
 * enqueues them (`job.enqueue` refuses a job no register phase registered) —
 * read from each plugin's own `register` list, as a booted host's register
 * phase reads it, never a hand-picked `someJob.register()`. Only the job
 * tokens (a supervised job's kind and task with it): a plugin's other
 * registrations stay out of the shared test process.
 *
 * Idempotent across the suites of one process.
 */
export function registerPluginJobs(
  pluginPaths: readonly string[],
): Promise<void> {
  return registerPluginTokens(pluginPaths, isJobToken);
}
