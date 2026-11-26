import type { z } from "zod";
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
import type { PublishTransport } from "./publish-flow";
import { stageAttachment } from "./stage-attachment";

/** An endpoint's path: its route without the method. */
function pathOf(endpoint: { route: string }): string {
  const path = endpoint.route.split(" ")[1];
  if (path === undefined) throw new Error(`no path in ${endpoint.route}`);
  return path;
}

/** curl's deadline for an import: the box hashes and copies the whole file. */
const IMPORT_MAX_SECONDS = 300;

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
