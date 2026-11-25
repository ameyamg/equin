import {
  implementMachine,
  machineHandler,
} from "@plugins/infra/plugins/endpoints/machine";
import { hostOnly } from "@plugins/apps/plugins/deploy/plugins/analytics/plugins/host-only/server";
import { siteFeedImportMediaEndpoint } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import { siteFeedsStagingDir } from "../../data-dirs";
import { importStagedMedia } from "./import-media";

/** `POST /api/host-only/site-feeds/media/import?q=` — see the endpoint's doc. */
export const handleSiteFeedImportMedia = machineHandler(
  siteFeedImportMediaEndpoint,
  hostOnly(
    implementMachine(siteFeedImportMediaEndpoint, async ({ query: { q } }) => {
      await siteFeedsStagingDir.ensure();
      return importStagedMedia(siteFeedsStagingDir.file(q.stagedName), q);
    }),
  ),
);
