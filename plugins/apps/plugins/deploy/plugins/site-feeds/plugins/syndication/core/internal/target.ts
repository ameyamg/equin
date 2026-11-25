import type { z } from "zod";
import {
  fieldsToZodObject,
  type FieldsRecord,
  type InferFieldsObject,
} from "@plugins/fields/core";
import { secretFieldType } from "@plugins/fields/plugins/secret/core";
import type { IconRef } from "@plugins/ui/plugins/icons/core";

/** A target id: lowercase, URL- and SQL-safe, short. */
export const SYNDICATION_TARGET_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * A service a site feed's items can be posted to (a chat's channel, a social
 * account) — declared once in the target plugin's `core/` and contributed in
 * both runtimes: its web half for the settings form, its machine half with the
 * calls (`SyndicationTargets.Target`). Its settings are a `FieldsRecord`,
 * kept per site and feed; a `secretField` among them is stored in the
 * computer's secrets store, never in the database and never sent to a browser.
 */
export interface SyndicationTargetDecl<F extends FieldsRecord = FieldsRecord> {
  readonly id: string;
  readonly label: string;
  readonly icon: IconRef;
  readonly configFields: F;
  /** `fieldsToZodObject(configFields)`: a stored config, defaults applied. */
  readonly configSchema: z.ZodType<InferFieldsObject<F>>;
}

/** A target declaration that cannot be served (thrown at module eval). */
export class SyndicationTargetDeclarationError extends Error {
  override name = "SyndicationTargetDeclarationError";
}

export function defineSyndicationTarget<const F extends FieldsRecord>(input: {
  id: string;
  label: string;
  icon: IconRef;
  configFields: F;
}): SyndicationTargetDecl<F> {
  if (!SYNDICATION_TARGET_ID_PATTERN.test(input.id)) {
    throw new SyndicationTargetDeclarationError(
      `defineSyndicationTarget("${input.id}"): the id must match ${SYNDICATION_TARGET_ID_PATTERN}`,
    );
  }
  return Object.freeze({
    id: input.id,
    label: input.label,
    icon: input.icon,
    configFields: input.configFields,
    configSchema: fieldsToZodObject(input.configFields) as unknown as z.ZodType<
      InferFieldsObject<F>
    >,
  });
}

/** The keys of a config record whose field is a secret: stored apart, shown as set / unset. */
export function secretConfigKeys(fields: FieldsRecord): string[] {
  return Object.entries(fields)
    .filter(([, f]) => f.type.id === secretFieldType.id)
    .map(([k]) => k);
}

/** One file of a post, on this computer's disk (a copy the run removes). */
export interface SyndicatedMedia {
  readonly path: string;
  readonly mime: string;
  readonly filename: string;
  readonly size: number;
  readonly durationMs?: number;
}

/**
 * One feed item as a post elsewhere — structured, so each target formats it
 * its own way (a chat's markdown, a plain-text network): the feed's first
 * `syndicate.text` field as `title` (null when empty), the others as
 * `paragraphs` (empty ones dropped), the `syndicate.media` field's files, and
 * the page showing the feed on the site (null: the site has no hostname).
 */
export interface SyndicatedPost {
  readonly title: string | null;
  readonly paragraphs: readonly string[];
  readonly media: readonly SyndicatedMedia[];
  readonly url: string | null;
}

/** How one call to a target ended. A failure is in words, with whether a later attempt may succeed. */
export type SyndicationFailure = {
  ok: false;
  error: string;
  /** True for a failure a later attempt may not repeat (rate limit, the service down, no network). */
  retryable: boolean;
};

export type SyndicationPostResult =
  { ok: true; remoteId: string } | SyndicationFailure;

export type SyndicationRemoveResult = { ok: true } | SyndicationFailure;
