export {
  defineCapability,
  GRANT_SCOPES,
  mandatePolicy,
  scopeKey,
  withGrants,
} from "./internal/define";
export type {
  Capability,
  CapabilityDef,
  Grant,
  GrantScope,
  MandatePolicy,
  ScopedGrants,
} from "./internal/define";
export { defineMandate, mandateKinds, MandateIdSchema } from "./internal/named";
export type { MandateId, MandateRef } from "./internal/named";
