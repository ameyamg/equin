import { getConfig } from "@plugins/config_v2/server";
import { resolveHostPath } from "@plugins/infra/plugins/host-fs/server";
import { recorderConfig } from "../../core";
import { saveRecordingJob } from "./save-job";
import { listUploadIds } from "./upload-store";

/**
 * Give every recording in the Recordings folder a save job when none is
 * coming: one started before saves were jobs (2026-11-26), or whose job a
 * lost queue dropped. Run once a serving backend has settled; each job then
 * saves its recording or waits for it, like one queued at create.
 */
export async function queueOrphanedSaves(): Promise<void> {
  const configured = getConfig(recorderConfig).folder;
  if (configured === "") return;
  const folder = resolveHostPath(configured);
  const ids = await listUploadIds(folder);
  if (ids.length === 0) return;
  const coming = await saveRecordingJob.inFlight(ids);
  for (const id of ids)
    if (!coming.has(id)) await saveRecordingJob.enqueue({ id, folder });
}
