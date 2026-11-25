/**
 * The provider id, named once. The central descriptor, the Accounts row and
 * the deploy CLI's token read all take it from here, so they cannot drift onto
 * different spellings of the same account.
 */
export const CLOUDFLARE_PROVIDER_ID = "cloudflare";

/** Where a Cloudflare user creates an API token (My Profile → API Tokens). */
export const CLOUDFLARE_TOKENS_URL =
  "https://dash.cloudflare.com/profile/api-tokens";

/**
 * The permissions the token needs, as the token form names them: reading the
 * zones (to find a hostname's zone) and purging their cache (every ship of a
 * `cloudflare` edge purges its HTML). Nothing that edits the zone.
 */
export const CLOUDFLARE_TOKEN_PERMISSIONS = [
  "Zone · Zone · Read",
  "Zone · Cache Purge · Purge",
] as const;

/** Cloudflare's own check of a user API token: live or not. */
export const CLOUDFLARE_TOKEN_VERIFY_URL =
  "https://api.cloudflare.com/client/v4/user/tokens/verify";
