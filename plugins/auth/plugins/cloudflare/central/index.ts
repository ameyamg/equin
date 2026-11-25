import type { CentralPluginDefinition } from "@plugins/framework/plugins/central-core/core";
import { cloudflareAuthRegistration } from "./internal/register";

export default {
  description:
    "Cloudflare API-token provider. The token is stored in the central auth token store (encrypted, shared across worktrees) and accepted only once Cloudflare reports it active.",
  register: [cloudflareAuthRegistration],
} satisfies CentralPluginDefinition;
