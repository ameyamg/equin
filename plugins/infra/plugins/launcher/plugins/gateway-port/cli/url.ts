import type { CliAction } from "@plugins/framework/plugins/cli/core";
import { namespaceUrl } from "@plugins/infra/plugins/namespace/core";
import { checkoutNamespace } from "@plugins/infra/plugins/paths/core";
import { REPO_ROOT } from "@plugins/infra/plugins/paths/plugins/repo-root/core";
import { gatewayPortSync } from "../data-dirs";

/**
 * The address of the checkout this command runs in: main's from the main
 * checkout (install.sh, a person's shell), the worktree's own from an agent
 * worktree — the same `checkoutNamespace` mint `./equin build` serves its own
 * app (the main composition) at, built yet or not.
 * It printed main's from everywhere once, so an agent asking for its build's
 * address got main's and wrote to it.
 */
const run: CliAction<[], object> = async () => {
  const namespace = await checkoutNamespace(REPO_ROOT);
  process.stdout.write(`${namespaceUrl(namespace, "", gatewayPortSync())}\n`);
};

export default run;
