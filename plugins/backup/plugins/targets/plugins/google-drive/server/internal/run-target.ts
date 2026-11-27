import { basename } from "node:path";
import { PRODUCT_NAME } from "@plugins/framework/plugins/product-name/core";
import { getConfig } from "@plugins/config_v2/server";
import {
  getTokenFromCentral,
  type TokenFailure,
  type TokenNeedsConsent,
} from "@plugins/auth/server";
import type { BackupArchive, BackupTargetResult } from "@plugins/backup/core";
import { googleDriveBackupConfig } from "../../shared/config";
import { GOOGLE_DRIVE_SCOPES } from "../../shared/scopes";
import { ensureFolder } from "./folder";
import { uploadToDrive } from "./upload";
import { pruneOldBackups } from "./retention";
import { DriveTokenError, type DriveToken } from "./token";

export async function runGoogleDriveTarget(
  archive: BackupArchive,
): Promise<BackupTargetResult> {
  const { keepLast } = getConfig(googleDriveBackupConfig);

  // Asked up front so a missing grant becomes the target's needs-consent
  // result (the run card's Grant access) before anything is sent.
  const tokenResult = await driveTokenResult();
  if (!tokenResult.ok) return tokenFailureResult(tokenResult);

  try {
    return await upload(archive, keepLast);
  } catch (err) {
    // A grant revoked mid-run still offers Grant access.
    if (err instanceof DriveTokenError) return tokenFailureResult(err.failure);
    throw err;
  }
}

async function upload(
  archive: BackupArchive,
  keepLast: number,
): Promise<BackupTargetResult> {
  // Every Drive call after this asks for its own token (see ./token.ts): the
  // run can last hours, an access token one.
  const folderId = await ensureFolder(driveToken);

  const filename = `${PRODUCT_NAME}-backup-${basename(archive.stagingDir)}.tar.gz`;
  const { webViewLink, recovered } = await uploadToDrive(
    archive.archivePath,
    folderId,
    filename,
    driveToken,
  );

  // The archive is on Drive from here on: a retention pass that fails must
  // say so without losing the link, or the run card reads as "no off-site
  // copy" when there is one.
  let failures: string[];
  try {
    ({ failures } = await pruneOldBackups(folderId, keepLast, driveToken));
  } catch (err) {
    const uploaded = `Uploaded (${webViewLink}), but retention failed`;
    if (err instanceof DriveTokenError) {
      return tokenFailureResult(err.failure, `${uploaded}: `);
    }
    return {
      targetId: "google-drive",
      ok: false,
      detail: `${uploaded}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // The upload succeeded, but if retention could not delete old archives the
  // run is degraded, not ok. The schema has no per-target partial state, so
  // report ok:false with a detail that preserves the upload link.
  if (failures.length > 0) {
    return {
      targetId: "google-drive",
      ok: false,
      detail: `Uploaded (${webViewLink}), but retention failed to delete ${failures.length} old backup(s): ${failures.join("; ")}`,
    };
  }

  // A survived network failure is still worth seeing on the run card: a link
  // that keeps resetting is how a future outright failure announces itself.
  return {
    targetId: "google-drive",
    ok: true,
    detail:
      recovered > 0
        ? `${webViewLink} (resumed after ${recovered} network failure(s))`
        : webViewLink,
  };
}

function driveTokenResult() {
  return getTokenFromCentral({
    providerId: "google",
    scopes: [...GOOGLE_DRIVE_SCOPES],
  });
}

const driveToken: DriveToken = async () => {
  const result = await driveTokenResult();
  if (result.ok) return result.accessToken;
  throw new DriveTokenError(result);
};

function tokenFailureResult(
  failure: TokenNeedsConsent | TokenFailure,
  prefix = "",
): BackupTargetResult {
  if (failure.needsConsent) {
    return {
      targetId: "google-drive",
      ok: false,
      needsConsent: true,
      detail:
        prefix +
        `Google account not connected or missing Drive scope (${failure.reason})` +
        (failure.hint !== undefined ? `. ${failure.hint}` : ""),
      consent: { providerId: "google", scopes: [...GOOGLE_DRIVE_SCOPES] },
    };
  }
  return {
    targetId: "google-drive",
    ok: false,
    detail: prefix + failure.message,
  };
}
