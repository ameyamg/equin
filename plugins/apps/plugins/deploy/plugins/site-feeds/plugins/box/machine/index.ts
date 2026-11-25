import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { siteFeedImportMediaEndpoint } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import { handleSiteFeedImportMedia } from "./internal/import-route";
import { siteFeedsStagingSweepJob } from "./internal/staging-sweep";

export default {
  description:
    "The box's disk half of site feeds: the host-only media import route (a file the computer staged by scp in the site-feeds staging dir, its size and sha256 checked, imported into attachments under the computer's attachment id — imported, exists, staged-missing, size-mismatch, sha256-mismatch or conflict — then removed) and the daily sweep of staged files older than a day.",
  httpRoutes: {
    [siteFeedImportMediaEndpoint.route]: handleSiteFeedImportMedia,
  },
  register: [siteFeedsStagingSweepJob],
} satisfies MachinePluginDefinition;
