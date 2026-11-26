import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { rawEndpointHandler } from "@plugins/infra/plugins/endpoints/server";
import { IdKinds } from "@plugins/ids/server";
import {
  siteFeedEntryIdKind,
  siteFeedDeleteEndpoint,
  siteFeedMissingMediaEndpoint,
  siteFeedUpsertEndpoint,
} from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import { siteFeedMediaFile } from "../core";
import { siteFeedAttachmentLinkContributions } from "./internal/attachment-links";
import { siteFeedEntriesServed } from "./internal/entries-served";
import {
  handleSiteFeedDelete,
  handleSiteFeedMissingMedia,
  handleSiteFeedUpsert,
} from "./internal/host-routes";
import { handleSiteFeedMedia } from "./internal/media-route";

export {
  SiteFeeds,
  siteFeedDeclarationOf,
  siteFeedOf,
} from "./internal/registry";
export type { SiteFeedServerDeclaration } from "./internal/registry";
export {
  missingIds as missingSiteFeedMedia,
  presentAttachmentIds as presentSiteFeedMedia,
  upsertSiteFeedEntry,
} from "./internal/upsert";
export { deleteSiteFeedEntry } from "./internal/delete";
export { judgeUpsertValues as judgeSiteFeedValues } from "./internal/upsert";
export type { JudgedUpsert as JudgedSiteFeedValues } from "./internal/upsert";
export type { SiteFeedContribution } from "./internal/registry";

export default {
  description:
    "The box's site feeds: registers the site-feed entry id kind (sfe); the SiteFeeds.Feed registry a site's server contributes its feed declarations to; the site_feed_entries table (an entry's values, validated against this release's declaration on every write) and its attachment links; the visitor-readable site-feeds.entries value (a declared feed's newest publicLimit entries); GET /api/site-feeds/media/:entryId/:attachmentId (a linked file only, byte ranges, immutable); and the host-only entries upsert / delete and media missing routes, every refusal an arm of the answer (unknown-feed, invalid-values with zod's issues, missing-attachments).",
  httpRoutes: {
    [siteFeedMediaFile.route]: rawEndpointHandler(
      siteFeedMediaFile,
      handleSiteFeedMedia,
    ),
    [siteFeedUpsertEndpoint.route]: handleSiteFeedUpsert,
    [siteFeedDeleteEndpoint.route]: handleSiteFeedDelete,
    [siteFeedMissingMediaEndpoint.route]: handleSiteFeedMissingMedia,
  },
  contributions: [
    IdKinds.Kind({ kind: siteFeedEntryIdKind }),
    ...siteFeedEntriesServed.declare,
    ...siteFeedAttachmentLinkContributions,
  ],
} satisfies ServerPluginDefinition;
