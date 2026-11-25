import type {
  SshRunResult,
  SshTarget,
  SshUploadResult,
} from "@plugins/infra/plugins/ssh/server";
import type { DataDir } from "@plugins/infra/plugins/paths/core";
import { deriveInstall } from "@plugins/apps/plugins/deploy/plugins/deployments/core";
import type { HostQueryFailure } from "../../core";
import type { DeploymentTarget } from "../../server/internal/query-over-ssh";

/** What copying one file into a box's data dir answered. */
export type BoxUploadAnswer =
  | { kind: "uploaded" }
  | Extract<
      HostQueryFailure,
      { kind: "no-ssh-key" | "unverified" | "ssh-failed" }
    >
  | { kind: "not-found" };

/** A file's name in the destination dir: one plain segment the remote shell reads verbatim. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** The remote shell reads every path verbatim: nothing that could quote or expand. */
const SAFE_REMOTE_PATH = /^\/[A-Za-z0-9/._-]+$/;

/**
 * Where `dir` (a declared data dir) and a file `name` in it sit on the box of
 * an install of `compositionId`: the install's data root (`EQUIN_DIR`,
 * `deriveInstall`) joined with the dir's place under ANY data root
 * (`relativeOf` — `relativeToDataRoot`, injected so this stays pure). Throws
 * on a name or path the remote shell would read.
 */
export function boxDataDirPaths(
  compositionId: string,
  relative: string,
  name: string,
): { dir: string; file: string; runUser: string } {
  if (!SAFE_NAME.test(name) || name.includes("..")) {
    throw new Error(
      `uploadToBoxDataDir: ${JSON.stringify(name)} is not one plain file name`,
    );
  }
  const install = deriveInstall(compositionId);
  const dir = `${install.dataDir}/${relative}`;
  const file = `${dir}/${name}`;
  if (!SAFE_REMOTE_PATH.test(file) || relative.split("/").includes("..")) {
    throw new Error(
      `uploadToBoxDataDir: ${JSON.stringify(file)} holds characters the remote shell would read`,
    );
  }
  return { dir, file, runUser: install.runUser };
}

/**
 * The command that makes the destination dir exist, owned by the install's
 * run user (as the converge script makes its data dir), so the service can
 * read and remove what lands there. `install -d` re-applies owner and mode on
 * an existing dir, and creates the missing parents.
 */
export function ensureBoxDirArgv(dir: string, runUser: string): string[] {
  return ["install", "-d", "-m", "750", "-o", runUser, "-g", runUser, dir];
}

/** The effects an upload needs, injected so the sequence is testable without a box. */
export interface UploadDeps {
  resolveDeployment: (deploymentId: string) => Promise<DeploymentTarget>;
  sshRun: (target: SshTarget, argv: string[]) => Promise<SshRunResult>;
  sshUpload: (
    target: SshTarget,
    localPath: string,
    remotePath: string,
  ) => Promise<SshUploadResult>;
  /** The stand-in arm: copy into THIS instance's own `dir`. */
  copyLocal: (localPath: string, dir: DataDir, name: string) => Promise<void>;
  relativeToDataRoot: (dir: DataDir) => string;
}

function sshFailed(
  result: Extract<SshRunResult, { ok: false }>,
): BoxUploadAnswer {
  return {
    kind: "ssh-failed",
    failure: result.kind,
    message: result.message,
    stderr: result.stderr,
  };
}

export async function uploadOverSsh(
  deps: UploadDeps,
  deploymentId: string,
  dir: DataDir,
  localPath: string,
  name: string,
): Promise<BoxUploadAnswer> {
  const resolved = await deps.resolveDeployment(deploymentId);
  switch (resolved.kind) {
    case "not-found":
    case "no-ssh-key":
    case "unverified":
      return resolved;
    case "this-instance":
      await deps.copyLocal(localPath, dir, name);
      return { kind: "uploaded" };
    case "ready": {
      const paths = boxDataDirPaths(
        resolved.compositionId,
        deps.relativeToDataRoot(dir),
        name,
      );
      const made = await deps.sshRun(
        resolved.target,
        ensureBoxDirArgv(paths.dir, paths.runUser),
      );
      if (!made.ok) return sshFailed(made);
      const sent = await deps.sshUpload(resolved.target, localPath, paths.file);
      if (!sent.ok) return sshFailed(sent);
      return { kind: "uploaded" };
    }
  }
}
