import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";
import {
  brokenTestsStream,
  errorReportsStream,
  reportEventJob,
  reportRecordedToStreams,
  slowOpReportsStream,
} from "./internal/streams";

export default {
  description:
    "The report event streams: Error reports, Slow-op reports and Broken tests (the kinds whose `category` is error / slow-op / test), each fed every recorded report of its category — one event per occurrence, keyed by the report so its occurrences fold into one line of the supervisor's next message. A broken test is announced like any other report: the role decides what to do, no task is filed for it.",
  contributions: [
    errorReportsStream,
    slowOpReportsStream,
    brokenTestsStream,
    reportRecordedToStreams,
  ],
  register: [reportEventJob],
} satisfies MachinePluginDefinition;
