/**
 * Pure scope-set helpers for the consumer-declared OAuth scopes flow
 * (the missing-scope diff is core's `missingScopes`, shared with central).
 * No React, no imports — load-bearing union/diff math.
 */

/**
 * Order-preserving dedupe union across all lists (undefined lists are skipped).
 */
export function mergeScopes(...lists: (string[] | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    if (!list) continue;
    for (const scope of list) {
      if (seen.has(scope)) continue;
      seen.add(scope);
      out.push(scope);
    }
  }
  return out;
}
