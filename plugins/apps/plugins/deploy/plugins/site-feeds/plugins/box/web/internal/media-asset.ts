import {
  assetPath,
  type AssetPath,
} from "@plugins/infra/plugins/endpoints/core";
import { siteFeedMediaFile } from "../../core";

/** The public file of one media ref of a published entry, for `useAssetSrc`. */
export function siteFeedMediaAsset(
  entryId: string,
  attachmentId: string,
): AssetPath {
  return assetPath(siteFeedMediaFile, { entryId, attachmentId });
}
