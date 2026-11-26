import { z } from "zod";
import {
  nullable,
  type FieldOptionMeta,
  type FieldsRecord,
} from "@plugins/fields/core";
import {
  enumTextField,
  textField,
} from "@plugins/fields/plugins/text/plugins/config/core";
import { dateField } from "@plugins/fields/plugins/date/plugins/config/core";
import { idKindField } from "@plugins/ids/core";
import { entityRef } from "@plugins/infra/plugins/entities/core";
import {
  liveCollection,
  liveValue,
  type LiveRowsCollection,
} from "@plugins/network/plugins/live/core";
import { compositeKey } from "@plugins/network/plugins/live/plugins/query-resource/core";
import { siteFeedEntryIdKind } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";

/**
 * Where an item is published: a copy of the site that serves its feed.
 *
 * - `local` — THIS instance: it runs every plugin, the site's box half
 *   included, so its own `site_feed_entries` is a copy of the site
 *   (`http://<namespace>.localhost:<port>` shows it). Always a destination.
 * - `deployment:<id>` — a deployment whose composition closure includes the
 *   feed's declaring plugin, reached over SSH.
 */
export type SiteFeedDestination = "local" | `deployment:${string}`;

export const SITE_FEED_LOCAL_DESTINATION =
  "local" satisfies SiteFeedDestination;

const DEPLOYMENT_PREFIX = "deployment:";

/** A destination id on the wire: `local` or `deployment:<id>`. */
export const SiteFeedDestinationSchema = z
  .string()
  .regex(/^(local|deployment:[A-Za-z0-9_-]{1,80})$/)
  .transform((s) => s as SiteFeedDestination);

export function deploymentDestination(
  deploymentId: string,
): SiteFeedDestination {
  return `${DEPLOYMENT_PREFIX}${deploymentId}`;
}

/** What a destination id names: this instance, or one deployment. */
export function parseDestination(
  destination: string,
): { kind: "local" } | { kind: "deployment"; deploymentId: string } {
  if (destination === SITE_FEED_LOCAL_DESTINATION) return { kind: "local" };
  if (destination.startsWith(DEPLOYMENT_PREFIX)) {
    const deploymentId = destination.slice(DEPLOYMENT_PREFIX.length);
    if (deploymentId !== "") return { kind: "deployment", deploymentId };
  }
  throw new Error(`site-feeds: not a destination: "${destination}"`);
}

/** The most destinations one item is published to (this instance + deployments). */
export const SITE_FEED_DESTINATIONS_MAX = 50;

/**
 * Where one item stands on one destination: `publishing` / `unpublishing` — a
 * job is on its way; `published` — the destination serves it; `failed` — the
 * last job ended for good, `error` saying why. An item unpublished from a
 * destination leaves no row there.
 */
export const SITE_FEED_PUBLICATION_STATES = [
  "publishing",
  "published",
  "unpublishing",
  "failed",
] as const;
export type SiteFeedPublicationState =
  (typeof SITE_FEED_PUBLICATION_STATES)[number];

export const SITE_FEED_PUBLICATION_STATE_META: {
  readonly [S in SiteFeedPublicationState]: FieldOptionMeta;
} = {
  publishing: { label: "Publishing…", variant: "info" },
  published: { label: "Published", variant: "success" },
  unpublishing: { label: "Unpublishing…", variant: "info" },
  failed: { label: "Failed", variant: "destructive" },
};

/** One item on one destination. */
export const siteFeedPublicationFields = {
  itemId: idKindField(siteFeedEntryIdKind),
  /** `local` or `deployment:<id>` ({@link SiteFeedDestination}). */
  destination: textField({ label: "Destination" }),
  state: enumTextField(SITE_FEED_PUBLICATION_STATES, {
    label: "State",
    options: SITE_FEED_PUBLICATION_STATE_META,
  }),
  /** Why the last publish or unpublish there ended for good, in words. */
  error: nullable(textField({ label: "Error" })),
  /** When the destination last confirmed it serves the item; null until then. */
  publishedAt: nullable(dateField({ label: "Published" })),
  updatedAt: dateField({ label: "Updated" }),
} satisfies FieldsRecord;

export const siteFeedPublicationsEntityRef = entityRef(
  "site_feed_publications",
  siteFeedPublicationFields,
);

/** One item's copies: one row per destination it was published to. */
export const siteFeedPublications = liveCollection("site-feeds.publications", {
  from: siteFeedPublicationsEntityRef,
  carry: {
    pick: [
      "itemId",
      "destination",
      "state",
      "error",
      "publishedAt",
      "updatedAt",
    ],
  },
  baseExposures: false,
  id: compositeKey(["itemId", "destination"]),
  all: {
    by: ["itemId"],
    orderBy: [["destination", "asc"]],
    max: SITE_FEED_DESTINATIONS_MAX,
  },
});

export type SiteFeedPublicationRow =
  typeof siteFeedPublications extends LiveRowsCollection<infer R> ? R : never;

/**
 * Whether THIS instance may publish to deployed sites. Only main may: a
 * worktree's database is a fork of main's, holding the production
 * deployments' rows, and a worktree must never write to production. This
 * instance (`local`) is published to from anywhere.
 */
export const SitePublishScopeSchema = z.object({
  remote: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("allowed") }),
    z.object({ kind: z.literal("refused"), reason: z.string() }),
  ]),
});
export type SitePublishScope = z.infer<typeof SitePublishScopeSchema>;

export const sitePublishScope = liveValue("site-feeds.publish-scope", {
  schema: SitePublishScopeSchema,
});
