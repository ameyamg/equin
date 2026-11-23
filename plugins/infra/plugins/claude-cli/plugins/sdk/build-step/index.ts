// Claude Code's first-exec scan, paid by the build: the backend this build
// restarts probes Claude Code at once (claude-cli/availability), and a claude
// file the install just made new would make that probe — and every
// code-signing check queued behind it — wait on macOS's scan. See
// scanBundledClaudeNow.
import { defineBuildStep } from "@plugins/framework/plugins/cli/plugins/build/plugins/build-steps/cli";
import { scanBundledClaudeNow } from "../cli";

export default [
  defineBuildStep({
    id: "claudeCodeExecScan",
    owner: "infra/claude-cli/sdk",
    label: "Claude Code first-exec scan",
    phase: "dependencies",
    run: ({ root, log }) => scanBundledClaudeNow({ root, log }),
  }),
];
