import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { daemonBinariesReaction } from "./internal/reaction";
import { daemonBinariesServed, daemonDepsWatcher } from "./internal/served";

export default {
  description:
    "Host daemon binaries, desktop half: serves the deps.daemon-binaries push value — every dependency a host daemon runs (infra/deps daemonStatus: the install the live daemon was started from, and what main's checkout declares — the same, another from the next start, or one a start fell back from) — re-read when main advances and when the daemon dependencies' cache dirs change. needsMachine.",
  register: [daemonBinariesReaction, daemonDepsWatcher],
  contributions: [...daemonBinariesServed.declare],
} satisfies MachinePluginDefinition;
