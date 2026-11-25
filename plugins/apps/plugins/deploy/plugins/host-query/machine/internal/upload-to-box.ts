import { copyFile } from "node:fs/promises";
import { sshRun, sshUpload } from "@plugins/infra/plugins/ssh/server";
import {
  relativeToDataRoot,
  type DataDir,
} from "@plugins/infra/plugins/paths/core";
import {
  resolveDeployment,
  sshSessions,
} from "../../server/internal/host-query";
import { SSH_TIMEOUT_MS } from "../../server/internal/query-over-ssh";
import { uploadOverSsh, type BoxUploadAnswer } from "./upload";

/** A file transfer's whole budget: minutes of legitimate upload, like `sshUpload`'s own. */
const UPLOAD_TIMEOUT_MS = 600_000;

/**
 * Copy the local file `localPath` into the declared data dir `dir` of a
 * deployment's box, as `name` — the file half of `hostOnlyWriteOverSsh`: a
 * caller stages a file there (scp, landing beside its name and renamed in
 * place), then asks a host-only route to take it.
 *
 * The dir's place on the box is the install's data root (`deriveInstall`'s
 * `EQUIN_DIR`) joined with the dir's place under any data root
 * (`relativeToDataRoot`); it is made to exist first, owned by the install's
 * run user. Same target resolution and session semaphore as the queries. A
 * stand-in server (`markServerBoxIsThisInstance`) is answered by copying
 * into this instance's own `dir`.
 */
export function uploadToBoxDataDir(
  deploymentId: string,
  dir: DataDir,
  localPath: string,
  name: string,
): Promise<BoxUploadAnswer> {
  return sshSessions.run(() =>
    uploadOverSsh(
      {
        // The dial is bounded tightly by the SSH layer; the budget is the transfer's.
        resolveDeployment: (id) =>
          resolveDeployment(id, Math.max(SSH_TIMEOUT_MS, UPLOAD_TIMEOUT_MS)),
        sshRun: (target, argv) =>
          sshRun({ ...target, timeoutMs: SSH_TIMEOUT_MS }, argv),
        sshUpload,
        copyLocal: async (from, into, file) => {
          await into.ensure();
          await copyFile(from, into.file(file));
        },
        relativeToDataRoot: (d) => relativeToDataRoot(d),
      },
      deploymentId,
      dir,
      localPath,
      name,
    ),
  );
}
