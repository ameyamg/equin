import { createHash, randomUUID } from "node:crypto";
import { open, rm } from "node:fs/promises";
import type { z } from "zod";
import {
  AttachmentBlobs,
  AttachmentMissingError,
  getAttachment,
} from "@plugins/infra/plugins/attachments/server";
import { encodeBase64UrlJson } from "@plugins/apps/plugins/deploy/plugins/analytics/plugins/host-only/core";
import {
  hostOnlyQueryOverSsh,
  hostOnlyWriteOverSsh,
} from "@plugins/apps/plugins/deploy/plugins/host-query/server";
import { uploadToBoxDataDir } from "@plugins/apps/plugins/deploy/plugins/host-query/machine";
import {
  SiteFeedDeleteAnswerSchema,
  SiteFeedImportAnswerSchema,
  SiteFeedMissingAnswerSchema,
  SiteFeedUpsertAnswerSchema,
  siteFeedDeleteEndpoint,
  siteFeedImportMediaEndpoint,
  siteFeedMissingMediaEndpoint,
  siteFeedUpsertEndpoint,
} from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import { siteFeedsStagingDir } from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/box/data-dirs";
import { siteFeedsOutgoingDir } from "../../data-dirs";
import type { PublishTransport, StagedFile } from "./publish-flow";

/** An endpoint's path: its route without the method. */
function pathOf(endpoint: { route: string }): string {
  const path = endpoint.route.split(" ")[1];
  if (path === undefined) throw new Error(`no path in ${endpoint.route}`);
  return path;
}

/** curl's deadline for an import: the box hashes and copies the whole file. */
const IMPORT_MAX_SECONDS = 300;

/**
 * Copy an attachment's bytes out of the store into a file of its own,
 * hashing them on the way — what `scp` sends and the box's import checks.
 */
async function stageAttachment(attachmentId: string): Promise<StagedFile> {
  const att = await getAttachment(attachmentId);
  if (!att) throw new AttachmentMissingError(attachmentId, "row");
  const blob = await AttachmentBlobs.get().read(att.diskPath);
  if (blob === null) throw new AttachmentMissingError(attachmentId, "bytes");
  await siteFeedsOutgoingDir.ensure();
  const path = siteFeedsOutgoingDir.file(`${attachmentId}.${randomUUID()}`);
  const hash = createHash("sha256");
  let size = 0;
  const file = await open(path, "wx");
  try {
    const reader = blob.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      size += value.byteLength;
      let at = 0;
      while (at < value.byteLength) {
        const { bytesWritten } = await file.write(value, at);
        at += bytesWritten;
      }
    }
  } catch (err) {
    await file.close();
    await rm(path, { force: true });
    throw err;
  }
  await file.close();
  return {
    path,
    sha256: hash.digest("hex"),
    size,
    dispose: () => rm(path, { force: true }),
  };
}

function write<T>(
  deploymentId: string,
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  maxSeconds?: number,
) {
  return hostOnlyWriteOverSsh(
    deploymentId,
    path,
    body,
    schema,
    maxSeconds === undefined ? {} : { maxSeconds },
  );
}

/** The real transport to one deployment's box: its host-only routes over SSH, files by scp. */
export function boxTransport(deploymentId: string): PublishTransport {
  return {
    missing: (attachmentIds) =>
      hostOnlyQueryOverSsh(
        deploymentId,
        `${pathOf(siteFeedMissingMediaEndpoint)}?q=${encodeBase64UrlJson({ attachmentIds })}`,
        SiteFeedMissingAnswerSchema,
      ),
    stage: (ref) => stageAttachment(ref.attachmentId),
    upload: (localPath, stagedName) =>
      uploadToBoxDataDir(
        deploymentId,
        siteFeedsStagingDir,
        localPath,
        stagedName,
      ),
    importMedia: (question) =>
      write(
        deploymentId,
        `${pathOf(siteFeedImportMediaEndpoint)}?q=${encodeBase64UrlJson(question)}`,
        undefined,
        SiteFeedImportAnswerSchema,
        IMPORT_MAX_SECONDS,
      ),
    upsert: (body) =>
      write(
        deploymentId,
        pathOf(siteFeedUpsertEndpoint),
        body,
        SiteFeedUpsertAnswerSchema,
      ),
    delete: (body) =>
      write(
        deploymentId,
        pathOf(siteFeedDeleteEndpoint),
        body,
        SiteFeedDeleteAnswerSchema,
      ),
  };
}
