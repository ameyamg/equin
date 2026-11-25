import { eq, inArray } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { _attachments } from "@plugins/infra/plugins/attachments/server";
import { mediaAttachmentIds } from "@plugins/fields/plugins/media/core";
import type {
  SiteFeedDecl,
  SiteFeedIssue,
  SiteFeedUpsertAnswer,
  SiteFeedUpsertBody,
} from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import { siteFeedEntryAttachments } from "./schema-attachments";
import { siteFeedEntries } from "./tables";

/** The most issues an `invalid-values` answer lists (the wire's cap). */
const MAX_ISSUES = 50;

/** What a valid upsert writes: the values as the declaration reads them, and the files they hold. */
export interface JudgedUpsert {
  kind: "valid";
  values: Record<string, unknown>;
  attachmentIds: string[];
}

/**
 * Validate an upsert's values against THIS box's declaration of the feed —
 * the release's own code, so a computer running a newer declaration than the
 * deployed site is refused (`invalid-values`, zod's issues), never half
 * written. Pure.
 */
export function judgeUpsertValues(
  feed: SiteFeedDecl,
  values: Record<string, unknown>,
): JudgedUpsert | Extract<SiteFeedUpsertAnswer, { kind: "invalid-values" }> {
  const parsed = feed.valuesSchema.safeParse(values);
  if (!parsed.success) {
    const issues: SiteFeedIssue[] = parsed.error.issues
      .slice(0, MAX_ISSUES)
      .map((issue) => ({
        path: issue.path
          .slice(0, 16)
          .map((p) => (typeof p === "symbol" ? String(p) : p)),
        message: issue.message,
      }));
    return { kind: "invalid-values", issues };
  }
  // A key the declaration does not know is skew too: zod's object strips it,
  // which would drop what the computer meant to publish without a word.
  const unknown = Object.keys(values).filter((k) => !(k in feed.fields));
  if (unknown.length > 0) {
    return {
      kind: "invalid-values",
      issues: unknown.slice(0, MAX_ISSUES).map((key) => ({
        path: [key],
        message: `this site's feed "${feed.id}" declares no field "${key}"`,
      })),
    };
  }
  const resolved = parsed.data as Record<string, unknown>;
  return {
    kind: "valid",
    values: resolved,
    attachmentIds: mediaAttachmentIds(feed.fields, resolved),
  };
}

/** The ids of `wanted` with no attachment row here, in `wanted`'s order. Pure. */
export function missingIds(
  wanted: readonly string[],
  present: ReadonlySet<string>,
): string[] {
  return [...new Set(wanted)].filter((id) => !present.has(id));
}

/** The ids among `ids` this box holds an attachment for. */
export async function presentAttachmentIds(
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: _attachments.id })
    .from(_attachments)
    .where(inArray(_attachments.id, [...ids]));
  return new Set(rows.map((r) => r.id));
}

/**
 * Publish one entry: validated against the feed, every file it references
 * already imported (`missing-attachments` otherwise — import first), then the
 * row upserted and its media links set to exactly what the values hold.
 */
export async function upsertSiteFeedEntry(
  feed: SiteFeedDecl,
  body: SiteFeedUpsertBody,
): Promise<SiteFeedUpsertAnswer> {
  const judged = judgeUpsertValues(feed, body.values);
  if (judged.kind !== "valid") return judged;
  const missing = missingIds(
    judged.attachmentIds,
    await presentAttachmentIds(judged.attachmentIds),
  );
  if (missing.length > 0) {
    return { kind: "missing-attachments", attachmentIds: missing };
  }
  const row = {
    id: body.id,
    feedId: feed.id,
    values: judged.values,
    publishedAt: new Date(body.publishedAt),
  };
  const existing = await db
    .insert(siteFeedEntries)
    .values(row)
    .onConflictDoUpdate({
      target: siteFeedEntries.id,
      set: { values: row.values, publishedAt: row.publishedAt },
      // An id is one item: it never moves to another feed.
      setWhere: eq(siteFeedEntries.feedId, feed.id),
    })
    .returning({ updatedAt: siteFeedEntries.updatedAt });
  if (existing.length === 0) {
    return {
      kind: "invalid-values",
      issues: [
        {
          path: ["id"],
          message: `entry ${body.id} belongs to another feed on this site`,
        },
      ],
    };
  }
  await siteFeedEntryAttachments.set(body.id, judged.attachmentIds);
  return {
    kind: "upserted",
    id: body.id,
    updatedAt: existing[0]!.updatedAt.toISOString(),
  };
}
