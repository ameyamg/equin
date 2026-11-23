import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";
import {
  brokenTestsStream,
  errorReportsStream,
  ownOpenReportsWarmup,
  reportEventJob,
  reportRecordedToStreams,
  slowOpReportsStream,
} from "./internal/streams";

export default {
  description:
    "The report event streams: Error reports and Slow-op reports (the kinds whose `category` is error / slow-op), each fed every recorded report of its category — one event per occurrence, keyed by the report so its occurrences fold into one line of the supervisor's next message — and Broken tests (category test), which OWNS its reports instead: each open report gets its one investigation task (system-filed, in the backlog of the role the stream is routed to, else a plain Reports task), on its occurrence and, for reports recorded before or whose task ended, at boot.",
  contributions: [
    errorReportsStream,
    slowOpReportsStream,
    brokenTestsStream,
    reportRecordedToStreams,
  ],
  register: [reportEventJob, ownOpenReportsWarmup],
} satisfies MachinePluginDefinition;
