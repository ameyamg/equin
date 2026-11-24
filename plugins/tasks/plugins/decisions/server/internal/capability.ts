import { Mandate } from "@plugins/tasks/plugins/orchestration/plugins/mandate/server";
import { decisionsOpen } from "@plugins/tasks/plugins/decisions/plugins/capability/core";

/** No Mandate line: the decision tools appear only when granted, and their descriptions say when to use them. */
export const decisionsOpenCapability = Mandate.Capability({
  cap: decisionsOpen,
  describe: () => null,
});
