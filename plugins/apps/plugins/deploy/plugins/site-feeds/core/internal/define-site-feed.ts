import type { z } from "zod";
import {
  fieldsToZodObject,
  type FieldsRecord,
  type InferFieldsObject,
} from "@plugins/fields/core";
import {
  mediaFieldDefOf,
  mediaFieldType,
  type MediaFieldDef,
} from "@plugins/fields/plugins/media/core";

/** The most entries a feed may serve its visitors (`publicLimit`'s ceiling). */
export const SITE_FEED_PUBLIC_LIMIT_MAX = 100;

/** The most fields one feed declares — the entry values' record bound. */
export const SITE_FEED_MAX_FIELDS = 32;

/** A feed id: lowercase, URL- and SQL-safe, short. */
export const SITE_FEED_ID_PATTERN = /^[a-z][a-z0-9-]{0,47}$/;

/** The keys of `F` whose field is a media field (`mediaField`). */
export type MediaFieldKeys<F extends FieldsRecord> = {
  [K in keyof F & string]: F[K] extends MediaFieldDef ? K : never;
}[keyof F & string];

/** What a feed's entry values are: one value per declared field. */
export type SiteFeedValues<F extends FieldsRecord> = InferFieldsObject<F>;

/**
 * How an entry becomes a post on another service (a syndication target):
 * which fields make its text, in order (joined, the first one bold), and which
 * media field holds its files. Plain data, its keys typed against `fields`.
 */
export interface SiteFeedSyndicate {
  /** Field keys of the feed (checked at declaration). */
  readonly text: readonly string[];
  /** A media field's key (checked at declaration). */
  readonly media?: string;
}

/**
 * A site feed: a kind of content a site publishes itself (its tips, its
 * news), declared by the site plugin that renders it — never by the Deploy
 * app, which only reads the declarations. The site registers the SAME
 * declaration in both runtimes (`SiteFeeds.Feed`, `site-feeds/box`): the box
 * validates every write against its own copy.
 */
export interface SiteFeedDecl<F extends FieldsRecord = FieldsRecord> {
  readonly id: string;
  readonly label: string;
  readonly fields: F;
  /** Absent: the feed is never posted anywhere else. */
  readonly syndicate?: SiteFeedSyndicate;
  /** The newest this many published entries are what visitors read. */
  readonly publicLimit: number;
  /**
   * Where the site shows the feed, from its root (`/tips`) — what a post
   * elsewhere links to. Absent: the site's root.
   */
  readonly pagePath?: string;
  /** `fieldsToZodObject(fields)`: an entry's values, defaults applied. */
  readonly valuesSchema: z.ZodType<SiteFeedValues<F>>;
}

/** What `defineSiteFeed` takes: `syndicate.media` must name a media field (tsc). */
export interface SiteFeedInput<F extends FieldsRecord> {
  readonly id: string;
  readonly label: string;
  readonly fields: F;
  readonly syndicate?: {
    readonly text: readonly (keyof F & string)[];
    readonly media?: MediaFieldKeys<F>;
  };
  readonly publicLimit: number;
  readonly pagePath?: string;
}

/** A feed declaration that cannot be served (thrown at module eval). */
export class SiteFeedDeclarationError extends Error {
  override name = "SiteFeedDeclarationError";
}

/**
 * Declare a site feed. Keys of `syndicate` are typed against `fields` (a
 * wrong key, or a `media` key naming a field that is not a media field, is a
 * tsc error), and checked again at module eval for an untyped caller —
 * together with the id's spelling, the field count and `publicLimit`.
 */
export function defineSiteFeed<const F extends FieldsRecord>(
  input: SiteFeedInput<F>,
): SiteFeedDecl<F> {
  const fail = (why: string): never => {
    throw new SiteFeedDeclarationError(`defineSiteFeed("${input.id}"): ${why}`);
  };
  if (!SITE_FEED_ID_PATTERN.test(input.id)) {
    fail(`the id must match ${SITE_FEED_ID_PATTERN}`);
  }
  if (input.label.trim() === "") fail("the label is empty");
  const keys = Object.keys(input.fields);
  if (keys.length === 0) fail("a feed declares at least one field");
  if (keys.length > SITE_FEED_MAX_FIELDS) {
    fail(`at most ${SITE_FEED_MAX_FIELDS} fields (${keys.length} declared)`);
  }
  if (
    !Number.isInteger(input.publicLimit) ||
    input.publicLimit < 1 ||
    input.publicLimit > SITE_FEED_PUBLIC_LIMIT_MAX
  ) {
    fail(
      `publicLimit must be an integer in 1..${SITE_FEED_PUBLIC_LIMIT_MAX} (${input.publicLimit})`,
    );
  }
  if (
    input.pagePath !== undefined &&
    !/^\/[A-Za-z0-9\-._~/]*$/.test(input.pagePath)
  ) {
    fail(`pagePath must be a path from the site's root ("${input.pagePath}")`);
  }
  const { syndicate } = input;
  if (syndicate !== undefined) {
    if (syndicate.text.length === 0) {
      fail("syndicate.text names no field");
    }
    for (const key of syndicate.text) {
      if (!(key in input.fields))
        fail(`syndicate.text names no field "${key}"`);
    }
    if (syndicate.media !== undefined) {
      const field = input.fields[syndicate.media];
      if (field === undefined || field.type.id !== mediaFieldType.id) {
        fail(`syndicate.media "${syndicate.media}" is not a media field`);
      }
      // The def itself must be mediaField's (accept / max), not only its type id.
      mediaFieldDefOf(
        field as unknown as Parameters<typeof mediaFieldDefOf>[0],
      );
    }
  }
  return Object.freeze({
    id: input.id,
    label: input.label,
    fields: input.fields,
    ...(syndicate !== undefined
      ? {
          syndicate: Object.freeze({
            text: Object.freeze([...syndicate.text]),
            ...(syndicate.media !== undefined
              ? { media: syndicate.media }
              : {}),
          }),
        }
      : {}),
    publicLimit: input.publicLimit,
    ...(input.pagePath !== undefined ? { pagePath: input.pagePath } : {}),
    valuesSchema: fieldsToZodObject(input.fields) as unknown as z.ZodType<
      SiteFeedValues<F>
    >,
  });
}
