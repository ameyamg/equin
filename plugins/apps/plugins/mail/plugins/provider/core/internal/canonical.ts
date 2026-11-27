import {
  canonicalizeFilter,
  decodeFilter,
  encodeFilter,
  type Filter,
} from "@plugins/network/plugins/live/plugins/filter/core";
import { providerQuery, type MailboxId, type ProviderQuery } from "./ids";
import type { Mailbox } from "./mailbox";
import {
  isDeclaredMailOp,
  MAIL_QUERY_COLUMNS,
  type CompiledMailQuery,
  type MailQuery,
  type MailQueryColumns,
} from "./query";

// A provider whose own query language IS the contract's filter (the local
// provider, the test fake): its provider query is the canonical filter JSON,
// and it evaluates the filter itself (in SQL, or in memory).

/** Every clause of a canonical filter, depth first. */
function clausesOf(f: Filter): Extract<Filter, { column: string }>[] {
  if ("and" in f) return f.and.flatMap(clausesOf);
  if ("or" in f) return f.or.flatMap(clausesOf);
  return [f];
}

/**
 * Compiles a query to its canonical filter JSON (`""`: every message). It
 * refuses what every provider must refuse — a pair outside MAIL_QUERY_OPS, a
 * mailbox the account does not have (a role it lacks is `unsupported-mailbox`,
 * an id nobody listed `unknown-mailbox`) — and whatever `refuse` names.
 */
export function compileCanonicalMailQuery(
  query: MailQuery,
  ctx: { mailboxes: readonly Mailbox[] },
  provider: {
    label: string;
    refuse?: (clause: { column: string; op: string }) => boolean;
  },
): CompiledMailQuery {
  const canonical = canonicalizeFilter(query, MAIL_QUERY_COLUMNS);
  if (canonical === undefined)
    return { kind: "query", providerQuery: providerQuery("") };
  if ("or" in canonical && canonical.or.length === 0)
    return { kind: "nothing" };
  const known = new Set(ctx.mailboxes.map((m) => m.id));
  for (const c of clausesOf(canonical as Filter)) {
    if (!isDeclaredMailOp(c.column, c.op) || provider.refuse?.(c)) {
      return {
        kind: "refused",
        refusal: {
          column: c.column,
          op: c.op,
          reason: "unsupported-op",
          message: `${provider.label} does not run ${c.column} ${c.op}`,
        },
      };
    }
    if (c.column === "mailboxes") {
      const missing = (c.operand as readonly string[]).find(
        (id) => !known.has(id as MailboxId),
      );
      if (missing !== undefined) {
        const role = missing.startsWith("role:");
        return {
          kind: "refused",
          refusal: {
            column: c.column,
            op: c.op,
            reason: role ? "unsupported-mailbox" : "unknown-mailbox",
            message: `no mailbox ${missing}`,
          },
        };
      }
    }
  }
  return {
    kind: "query",
    providerQuery: providerQuery(encodeFilter(canonical, MAIL_QUERY_COLUMNS)!),
  };
}

/** The filter a canonical provider query holds; `undefined` is every message. Strict: throws on anything not canonical. */
export function decodeCanonicalMailQuery(
  query: ProviderQuery,
): Filter<MailQueryColumns> | undefined {
  return query === ""
    ? undefined
    : (decodeFilter(query, MAIL_QUERY_COLUMNS) as Filter<MailQueryColumns>);
}
