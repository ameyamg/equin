/**
 * Which granted scopes also grant others: a provider's broad scope is a
 * superset of its narrow ones, so an account holding the broad one satisfies a
 * requirement for a narrow one without a reconnect. Keyed by the granted scope;
 * scope strings are provider-unique URLs, so no provider id is needed.
 *
 * Google: `https://mail.google.com/` is full mailbox access — everything every
 * `gmail.*` scope grants, plus permanent delete. Gmail asked for it until
 * 2026-11-26 and now asks for `gmail.modify`; accounts granted the old scope
 * stay connected through this entry.
 */
const GRANTS_ALSO: Readonly<Record<string, readonly string[]>> = {
  "https://mail.google.com/": [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.metadata",
    "https://www.googleapis.com/auth/gmail.labels",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.insert",
  ],
};

/** Every scope `granted` grants: the granted scopes and what they cover. */
function effectiveScopes(granted: readonly string[] | undefined): Set<string> {
  const have = new Set<string>();
  for (const scope of granted ?? []) {
    have.add(scope);
    for (const covered of GRANTS_ALSO[scope] ?? []) have.add(covered);
  }
  return have;
}

/**
 * Scopes in `required` that `granted` does not grant (directly or through a
 * broader scope it holds), de-duplicated and in `required`'s order. `granted`
 * undefined is treated as `[]`.
 */
export function missingScopes(
  required: readonly string[],
  granted: readonly string[] | undefined,
): string[] {
  const have = effectiveScopes(granted);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const scope of required) {
    if (have.has(scope) || seen.has(scope)) continue;
    seen.add(scope);
    out.push(scope);
  }
  return out;
}
