export { defineConfig } from "./internal/define-config";
export { defineConfigMigration } from "./internal/config-migration";
export type { ConfigMigration } from "./internal/config-migration";
export type {
  Disposable,
  JsonValue,
  ConfigDescriptor,
  ConfigSource,
  ConfigValues,
  OriginDefaultsFrom,
} from "./internal/types";
export { seedConditionHolds } from "./internal/types";
export {
  configValues,
  configGitValues,
  configV2ValuesSchema,
  configV2ValidationIssueSchema,
  configV2ConflictEntrySchema,
  configV2ConflictsSchema,
  configConflict,
  configV2TiersSchema,
  configTiers,
  configV2ScopesSchema,
  configV2ScopesMapSchema,
  configScopes,
  configV2ConflictLocationsSchema,
  configV2ConflictMapSchema,
  configConflictLocations,
  configV2ModifiedCountsSchema,
  configModifiedCounts,
  configRawFile,
} from "./internal/resource";
export type {
  ConfigV2Values,
  ConfigV2ValidationIssue,
  ConfigV2ConflictEntry,
  ConfigV2Conflicts,
  ConfigV2Tiers,
  ConfigV2Scopes,
  ConfigV2ScopesMap,
  ConfigV2ConflictLocations,
  ConfigV2ConflictMap,
  ConfigV2ModifiedCounts,
} from "./internal/resource";
export type { ConfigFileContent, ConfigProxy } from "./internal/config-proxy";
export {
  computeHash,
  stringifyConfigValue,
  codeConfigProxy,
  loadedProxy,
  readonlyProxy,
} from "./internal/config-proxy";
export {
  currentOrigin,
  effective,
  hasConflict,
  propagate,
  readTypedConfig,
  readTypedConfigWithLayer,
  validationIssues,
} from "./internal/tier-logic";
export type { ResolvedLayer, ResolvedConfig } from "./internal/tier-logic";
export {
  resolveGitLayer,
  committedDocument,
  committedFilesFromMap,
  readCommittedFilesSync,
  propagateGitLayerDocument,
} from "./internal/git-layer";
export type {
  CommittedFiles,
  CommittedFs,
  GitLayerDocument,
} from "./internal/git-layer";
export {
  CONFIG_HASH_RE,
  parseConfigFile,
  parseOverrideFile,
} from "./internal/config-file";
export { createMemoryConfigStore } from "./internal/memory-store";
export {
  mergeConfigDocument,
  mergeConflictFields,
} from "./internal/merge/merge-document";
export type { ConfigMergeResult } from "./internal/merge/merge-document";
export {
  MERGE_ENGINE,
  buildMergeRecord,
  configMergeRecordSchema,
  mergeRecordStatus,
  parseMergeRecord,
} from "./internal/merge/merge-record";
export type {
  ConfigMergeRecord,
  MergeRecordStatus,
} from "./internal/merge/merge-record";
export {
  mergeReviewFields,
  sameFieldValue,
} from "./internal/merge/merge-review";
export type {
  MergeFieldChoice,
  MergeFieldOutcome,
  MergeReviewField,
} from "./internal/merge/merge-review";
export type {
  FieldDecision,
  MergeConflictReason,
  MergePath,
} from "./internal/merge/deep-merge";
export {
  configFileRelPath,
  parseConfigFileRelPath,
  scopeSegment,
  storePathParts,
} from "./internal/store";
export type {
  ConfigDocRef,
  ConfigDocumentFile,
  ConfigFileRef,
  ConfigGitLayerImpl,
  ConfigStoreImpl,
} from "./internal/store";
export {
  setConfigField,
  forkScope,
  deleteScope,
  forkDescriptorScope,
  removeDescriptorScope,
} from "./internal/endpoints";
export { REVIEW_MARKER, hasReviewMarker } from "./internal/review-marker";
export { withOverrideLegend } from "./internal/override-legend";
export { APP_SCOPE_DIR, scopeAppId, appScopeId } from "./internal/scope-format";
export { configFileOwner } from "./internal/config-file-owner";
export {
  mapConfigLists,
  normalizeCollectionItems,
} from "./internal/collections";
export type { ConfigListVisitor } from "./internal/collections";
export {
  orphanFileRoleSchema,
  orphanRiskClassSchema,
  orphanReasonSchema,
  orphanFileSchema,
  orphanEntrySchema,
  orphanReportSchema,
} from "./internal/orphan-report";
export type {
  OrphanFileRole,
  OrphanRiskClass,
  OrphanReason,
  OrphanFile,
  OrphanEntry,
  OrphanReport,
} from "./internal/orphan-report";
