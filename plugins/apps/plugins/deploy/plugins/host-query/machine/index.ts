import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";

export { uploadToBoxDataDir } from "./internal/upload-to-box";
export type { BoxUploadAnswer } from "./internal/upload";

export default {
  description:
    "uploadToBoxDataDir(deploymentId, dataDir, localPath, name): copies one local file into a declared data dir of a deployment's box over scp (the dir made to exist first, owned by the install's run user; the file lands beside its name and is renamed in place), with the queries' target resolution and session semaphore — or, for a stand-in server, into this instance's own dir. Answers uploaded, which of the key, the host key or SSH failed, or not-found.",
} satisfies MachinePluginDefinition;
