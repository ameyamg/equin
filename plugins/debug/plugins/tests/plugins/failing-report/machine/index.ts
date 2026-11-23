import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";

export { fileTestFailingReports } from "./internal/file-reports";

export default {
  description:
    "Files the test-failing reports of main (fileTestFailingReports, called by main's test runner after each batch's verdicts are ingested): each file of the batch judged by judgeFailingFile — failing on its current code with no pass, confirmed by a second failure of main's own — becomes one occurrence of its file's report, with the failing cases, the last-passed (or none on record) and first-failed commits, and the failing run's commit as the occurrence's commit. One incident (one bell) per batch; an occurrence folded into a storm rollup is filed again on the file's next run. Main only.",
} satisfies MachinePluginDefinition;
