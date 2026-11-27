import type { GmailHeader } from "@plugins/integrations/plugins/gmail/plugins/api/core";

// Reading the headers Gmail hands back raw (format=metadata / full): one
// lookup. Encoded words and address lists are packages/mime's.

/** The first header named `name` (case-insensitive), or null. */
export function header(
  headers: readonly GmailHeader[] | undefined,
  name: string,
): string | null {
  const lower = name.toLowerCase();
  return headers?.find((h) => h.name.toLowerCase() === lower)?.value ?? null;
}
