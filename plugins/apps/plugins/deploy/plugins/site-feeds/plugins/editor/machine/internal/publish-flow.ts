import {
  MediaRefSchema,
  mediaFieldType,
  type MediaRef,
} from "@plugins/fields/plugins/media/core";
import type { HostQueryFailure } from "@plugins/apps/plugins/deploy/plugins/host-query/core";
import type { HostQueryAnswer } from "@plugins/apps/plugins/deploy/plugins/host-query/server";
import type { BoxUploadAnswer } from "@plugins/apps/plugins/deploy/plugins/host-query/machine";
import {
  SITE_FEED_MISSING_MAX_IDS,
  type SiteFeedDecl,
  type SiteFeedDeleteAnswer,
  type SiteFeedEntryId,
  type SiteFeedImportAnswer,
  type SiteFeedImportQuestion,
  type SiteFeedIssue,
  type SiteFeedUpsertAnswer,
  type SiteFeedUpsertBody,
} from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";

/** A local file staged for transfer: its bytes' sha256 and size, removed by `dispose`. */
export interface StagedFile {
  path: string;
  sha256: string;
  size: number;
  dispose: () => Promise<void>;
}

/**
 * What publishing needs from the world — the box's routes, the transfer and
 * this computer's attachment bytes — injected so the flow is tested against
 * a fake box.
 */
export interface PublishTransport {
  missing: (
    attachmentIds: string[],
  ) => Promise<HostQueryAnswer<{ missing: string[] }>>;
  /** Copy one attachment's bytes to a local file, hashing them. */
  stage: (ref: MediaRef) => Promise<StagedFile>;
  upload: (localPath: string, stagedName: string) => Promise<BoxUploadAnswer>;
  importMedia: (
    question: SiteFeedImportQuestion,
  ) => Promise<HostQueryAnswer<SiteFeedImportAnswer>>;
  upsert: (
    body: SiteFeedUpsertBody,
  ) => Promise<HostQueryAnswer<SiteFeedUpsertAnswer>>;
  delete: (body: {
    feedId: string;
    id: SiteFeedEntryId;
  }) => Promise<HostQueryAnswer<SiteFeedDeleteAnswer>>;
}

/**
 * A failure a later attempt may not repeat (the box unreachable, the SSH
 * session cut, the site restarting): thrown, so the job retries it.
 */
export class PublishTransportError extends Error {
  override name = "PublishTransportError";
}

/** How a publish ended, short of a retryable failure (thrown). */
export type PublishOutcome =
  | { kind: "published"; transferred: number }
  /** Refused for good: what the user reads, and must act on. */
  | { kind: "refused"; message: string };

export type UnpublishOutcome =
  { kind: "unpublished" } | { kind: "refused"; message: string };

const SSH_FAILURES_FOR_GOOD = new Set(["auth", "host-key-mismatch", "dns"]);

/**
 * One host failure in words — or a throw, for the ones a retry may cure.
 * `subject` names what was being done ("asking which files the site lacks").
 */
export function judgeHostFailure(
  failure: HostQueryFailure | { kind: "not-found" },
  subject: string,
): { kind: "refused"; message: string } {
  switch (failure.kind) {
    case "not-found":
      return {
        kind: "refused",
        message: "This site's deployment no longer exists.",
      };
    case "no-ssh-key":
      return {
        kind: "refused",
        message:
          "The site's server has no SSH key yet — set one up on the server's page.",
      };
    case "unverified":
      return {
        kind: "refused",
        message:
          "The site's server was never verified — check its connection on the server's page first.",
      };
    case "route-missing":
      return {
        kind: "refused",
        message: `The site's release does not serve site feeds yet (${failure.path}) — deploy it again.`,
      };
    case "unreadable-answer":
      return {
        kind: "refused",
        message: `The site answered something unexpected while ${subject} — deploy it again. ${failure.detail}`,
      };
    case "ssh-failed":
      if (SSH_FAILURES_FOR_GOOD.has(failure.failure)) {
        return {
          kind: "refused",
          message: `SSH to the site's server failed while ${subject}: ${failure.message}`,
        };
      }
      throw new PublishTransportError(
        `SSH to the site's server failed while ${subject}: ${failure.message} ${failure.stderr}`.trim(),
      );
    case "request-failed":
      throw new PublishTransportError(
        `The site did not answer while ${subject} (curl exit ${failure.exitCode}): ${failure.stderr}`,
      );
  }
}

/** Zod issues as one readable line each. */
export function issuesText(issues: readonly SiteFeedIssue[]): string {
  return issues
    .map((i) => `${i.path.join(".") || "(item)"}: ${i.message}`)
    .join("; ");
}

/** Every media ref the feed's media fields hold, in field then list order. */
export function mediaRefsOf(
  feed: SiteFeedDecl,
  values: Record<string, unknown>,
): MediaRef[] {
  const refs: MediaRef[] = [];
  for (const [key, field] of Object.entries(feed.fields)) {
    if (field.type.id !== mediaFieldType.id) continue;
    refs.push(...MediaRefSchema.array().parse(values[key] ?? []));
  }
  return refs;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

/** The import's refusals, in words (`imported` / `exists` are success). */
function importRefusal(
  ref: MediaRef,
  answer: SiteFeedImportAnswer,
): string | null {
  switch (answer.kind) {
    case "imported":
    case "exists":
      return null;
    case "staged-missing":
      return `The site did not find the copied file of ${ref.filename} — publish again.`;
    case "size-mismatch":
      return `${ref.filename} reached the site at ${answer.actual} bytes instead of ${answer.expected} — publish again.`;
    case "sha256-mismatch":
      return `${ref.filename} reached the site damaged (its sha256 differs) — publish again.`;
    case "conflict":
      return `The site holds another file under ${ref.filename}'s id: ${answer.message}`;
  }
}

/**
 * Publish one item to its site's box: ask which of its files the box lacks,
 * copy each into the box's staging dir and have the box import it (its size
 * and sha256 checked), then upsert the entry — which the box validates
 * against ITS declaration of the feed. A refusal the user must act on is the
 * `refused` outcome (the site runs an older feed, the server is not set up);
 * a transport failure throws {@link PublishTransportError}, for a retry.
 */
export async function publishItem(
  transport: PublishTransport,
  item: {
    id: SiteFeedEntryId;
    feed: SiteFeedDecl;
    values: Record<string, unknown>;
    publishedAt: Date;
  },
): Promise<PublishOutcome> {
  const refs = mediaRefsOf(item.feed, item.values);
  const byId = new Map(refs.map((r) => [r.attachmentId, r]));
  const missing: string[] = [];
  for (const ids of chunks([...byId.keys()], SITE_FEED_MISSING_MAX_IDS)) {
    const answer = await transport.missing(ids);
    if (answer.kind !== "answer") {
      return judgeHostFailure(answer, "asking which files the site lacks");
    }
    missing.push(...answer.value.missing);
  }

  for (const attachmentId of missing) {
    const ref = byId.get(attachmentId);
    if (ref === undefined) {
      throw new Error(
        `site-feeds: the box named ${attachmentId} missing, which item ${item.id} does not hold`,
      );
    }
    const staged = await transport.stage(ref);
    try {
      const stagedName = attachmentId;
      const sent = await transport.upload(staged.path, stagedName);
      if (sent.kind !== "uploaded") {
        return judgeHostFailure(sent, `copying ${ref.filename} to the site`);
      }
      const imported = await transport.importMedia({
        attachmentId,
        filename: ref.filename,
        mime: ref.mime,
        size: staged.size,
        sha256: staged.sha256,
        stagedName,
      });
      if (imported.kind !== "answer") {
        return judgeHostFailure(
          imported,
          `importing ${ref.filename} on the site`,
        );
      }
      const refused = importRefusal(ref, imported.value);
      if (refused !== null) return { kind: "refused", message: refused };
    } finally {
      await staged.dispose();
    }
  }

  const upserted = await transport.upsert({
    feedId: item.feed.id,
    id: item.id,
    values: item.values,
    publishedAt: item.publishedAt.toISOString(),
  });
  if (upserted.kind !== "answer") {
    return judgeHostFailure(upserted, "publishing the entry");
  }
  const answer = upserted.value;
  switch (answer.kind) {
    case "upserted":
      return { kind: "published", transferred: missing.length };
    case "unknown-feed":
      return {
        kind: "refused",
        message: `The site does not declare the feed "${answer.feedId}" — deploy it with the plugin that declares it.`,
      };
    case "invalid-values":
      return {
        kind: "refused",
        message: `The site runs an older version of this feed — deploy it. It refused: ${issuesText(answer.issues)}`,
      };
    case "missing-attachments":
      return {
        kind: "refused",
        message: `The site lacks ${answer.attachmentIds.length} of this item's files after the transfer — publish again.`,
      };
  }
}

/** Delete one item's entry on its site's box. Gone already (or its feed is) is unpublished. */
export async function unpublishItem(
  transport: PublishTransport,
  item: { id: SiteFeedEntryId; feedId: string },
): Promise<UnpublishOutcome> {
  const answer = await transport.delete({ feedId: item.feedId, id: item.id });
  if (answer.kind !== "answer") {
    return judgeHostFailure(answer, "unpublishing the entry");
  }
  switch (answer.value.kind) {
    case "deleted":
    case "absent":
    // A site that no longer declares the feed serves none of its entries.
    case "unknown-feed":
      return { kind: "unpublished" };
  }
}
