export {
  defineSyndicationTarget,
  secretConfigKeys,
  SyndicationTargetDeclarationError,
  SYNDICATION_TARGET_ID_PATTERN,
} from "./internal/target";
export type {
  SyndicatedMedia,
  SyndicatedPost,
  SyndicationFailure,
  SyndicationPostResult,
  SyndicationRemoveResult,
  SyndicationTargetDecl,
} from "./internal/target";
export { syndicatedMediaRefs, syndicatedText } from "./internal/compose";
export type { SyndicatedText } from "./internal/compose";
export {
  defaultTargetSettings,
  siteFeedSyndicationFields,
  siteFeedSyndications,
  siteFeedSyndicationsEntityRef,
  SYNDICATION_STATE_META,
  SYNDICATION_STATES,
  SYNDICATION_TARGETS_MAX,
  syndicationTargetSettings,
  SyndicationTargetSettingsSchema,
} from "./internal/syndications";
export type {
  SiteFeedSyndicationRow,
  SyndicationState,
  SyndicationTargetSettings,
} from "./internal/syndications";
