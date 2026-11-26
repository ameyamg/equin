import { Mandate } from "@plugins/tasks/plugins/orchestration/plugins/mandate/server";
import { mandateEscalate } from "@plugins/tasks/plugins/supervisor-run/plugins/capability/core";

/** No Mandate line: `become_supervisor` appears only when granted, and its
 * description says when to use it. */
export const mandateEscalateCapability = Mandate.Capability({
  cap: mandateEscalate,
  describe: () => null,
});
