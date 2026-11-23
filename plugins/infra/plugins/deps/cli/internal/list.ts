import type { CliAction } from "@plugins/framework/plugins/cli/core";
import type { DepState } from "../../core";
import { REPO_ROOT } from "@plugins/infra/plugins/paths/plugins/repo-root/core";
import { daemonStatus, declaredDeps, depState } from "../../deps";

function describe(state: DepState): string {
  switch (state.kind) {
    case "absent":
      return "absent";
    case "installing":
      return `installing since ${state.since}`;
    case "ready":
      return `ready ${state.identity} ${(state.bytes / 1e6).toFixed(1)} MB, last used ${state.lastUsed ?? "never"}`;
    case "failed":
      return `failed at ${state.at}: ${state.message.split("\n")[0]}`;
  }
}

// No backend boot: the declarations are a generated registry, read directly.
const run: CliAction<[], object> = async () => {
  const deps = await declaredDeps();
  if (deps.length === 0) {
    console.log("No dependency is declared in this checkout.");
    return;
  }
  for (const dep of deps) {
    const state = await depState(dep);
    console.log(
      `${dep.id}  [${dep.source.kind}: ${dep.source.label}]  ${dep.sizeHint}\n  ${describe(state)}`,
    );
    if (dep.daemon !== null) {
      const status = await daemonStatus(dep, { root: REPO_ROOT });
      const label = (i: { identity: string; version: string | null }) =>
        i.version ?? i.identity;
      const running =
        status.running === null
          ? "not started yet"
          : `runs ${label(status.running)}`;
      const declared =
        status.declared.kind === "same"
          ? "what this checkout declares"
          : status.declared.kind === "unreadable"
            ? `this checkout's declaration is unreadable (${status.declared.message})`
            : status.declared.failed !== null
              ? `${label(status.declared.install)} failed to start on ${status.declared.failed.at} — \`./equin deps remove ${dep.id}\` retries it`
              : `${label(status.declared.install)} from ${dep.daemon.appliesAt}`;
      console.log(`  daemon: ${running}; ${declared}`);
    }
  }
};

export default run;
