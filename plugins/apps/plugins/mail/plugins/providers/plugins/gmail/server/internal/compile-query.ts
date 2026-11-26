import {
  canonicalizeFilter,
  type Filter,
} from "@plugins/network/plugins/live/plugins/filter/core";
import {
  isDeclaredMailOp,
  MAIL_QUERY_COLUMNS,
  mailboxRoleOf,
  providerQuery,
  type CompiledMailQuery,
  type Mailbox,
  type MailboxId,
  type MailboxRole,
  type MailQuery,
  type MailQueryRefusalReason,
} from "@plugins/apps/plugins/mail/plugins/provider/core";
import {
  GMAIL_ROLE_LABELS,
  GMAIL_SYSTEM_SEARCH,
  gmailLabelName,
} from "./labels";

// MailQuery → Gmail's `q`: a total function over the contract's operators
// (MAIL_QUERY_OPS). Every clause either has an exact Gmail spelling or the
// whole query is refused, naming the clause — never dropped, never widened.
//
// Gmail evaluates `q` per message and lists the threads holding a match, which
// is the contract's own semantics. The provider lists with
// `includeSpamTrash: true`, so `q` alone decides membership (Gmail's default
// hides spam and trash, which the neutral query does not).
//
// Spellings:
// - mailboxes: a role → `in:inbox` / `is:important` …; a Gmail category →
//   `category:social`; a user label → `label:"Full/Name"`. hasAny is an OR,
//   hasAll an AND (one message carrying all), hasNone an AND of negations.
// - unread / starred / hasAttachment: `is:unread`, `is:starred`,
//   `has:attachment`, negated with `-`.
// - date: `after:<epoch s>` (at or after) / `before:<epoch s>` (strictly
//   before), so operands must fall on a whole second.
// - from / to / subject: `from:"text"` (Gmail's word match), `-from:"text"`.
// - query: the search box's text, passed through in parentheses.
// - and: terms side by side; or: `(a OR b)`.

type Term =
  | { kind: "true" }
  | { kind: "false" }
  | { kind: "term"; text: string; atom: boolean };

const TRUE: Term = { kind: "true" };
const FALSE: Term = { kind: "false" };
const atom = (text: string): Term => ({ kind: "term", text, atom: true });

class Refused extends Error {
  constructor(
    readonly column: string,
    readonly op: string,
    readonly reason: MailQueryRefusalReason,
    message: string,
  ) {
    super(message);
  }
}

function andOf(terms: Term[]): Term {
  if (terms.some((t) => t.kind === "false")) return FALSE;
  const kept = terms.filter((t) => t.kind === "term");
  if (kept.length === 0) return TRUE;
  if (kept.length === 1) return kept[0]!;
  return { kind: "term", text: kept.map((t) => t.text).join(" "), atom: false };
}

function orOf(terms: Term[]): Term {
  if (terms.some((t) => t.kind === "true")) return TRUE;
  const kept = terms.filter((t) => t.kind === "term");
  if (kept.length === 0) return FALSE;
  if (kept.length === 1) return kept[0]!;
  return atom(
    `(${kept.map((t) => (t.atom ? t.text : `(${t.text})`)).join(" OR ")})`,
  );
}

function negate(t: Term): Term {
  if (t.kind === "true") return FALSE;
  if (t.kind === "false") return TRUE;
  return atom(t.atom ? `-${t.text}` : `-(${t.text})`);
}

/** A quoted operand Gmail can read: no double quote (Gmail has no escape for one). */
function quoted(column: string, op: string, value: string): string {
  if (value.includes('"')) {
    throw new Refused(
      column,
      op,
      "unrepresentable-operand",
      `Gmail search cannot quote ${JSON.stringify(value)}: it has no escape for a double quote`,
    );
  }
  if (value.trim() === "") {
    throw new Refused(
      column,
      op,
      "unrepresentable-operand",
      `Gmail search has no spelling for an empty ${column} match`,
    );
  }
  return `"${value}"`;
}

function mailboxTerm(
  id: MailboxId,
  op: string,
  byId: ReadonlyMap<MailboxId, Mailbox>,
): Term {
  const role: MailboxRole | null = mailboxRoleOf(id);
  if (role !== null) {
    const l = (
      GMAIL_ROLE_LABELS as Partial<Record<MailboxRole, { search: string }>>
    )[role];
    if (!l) {
      throw new Refused(
        "mailboxes",
        op,
        "unsupported-mailbox",
        `Gmail has no ${role} mailbox to search`,
      );
    }
    return atom(l.search);
  }
  const system = GMAIL_SYSTEM_SEARCH[id];
  if (system) return atom(system.search);
  const mailbox = byId.get(id);
  if (!mailbox) {
    throw new Refused(
      "mailboxes",
      op,
      "unknown-mailbox",
      `This account has no mailbox ${id}`,
    );
  }
  if (mailbox.kind === "system") {
    throw new Refused(
      "mailboxes",
      op,
      "unsupported-mailbox",
      `Gmail search has no term for its system label ${id}`,
    );
  }
  const name = gmailLabelName(mailbox, byId);
  if (name === null) {
    throw new Refused(
      "mailboxes",
      op,
      "unknown-mailbox",
      `The mailboxes given hold ${id} but not its parent, so its Gmail name is unknown`,
    );
  }
  return atom(`label:${quoted("mailboxes", op, name)}`);
}

/** Whether the search box's text keeps its parentheses and quotes balanced. */
function balanced(text: string): boolean {
  let depth = 0;
  let quotes = 0;
  for (const c of text) {
    if (c === '"') quotes++;
    else if (quotes % 2 === 0 && c === "(") depth++;
    else if (quotes % 2 === 0 && c === ")" && --depth < 0) return false;
  }
  return depth === 0 && quotes % 2 === 0;
}

const FLAG_TERMS = {
  unread: "is:unread",
  starred: "is:starred",
  hasAttachment: "has:attachment",
} as const;
const TEXT_TERMS = { from: "from", to: "to", subject: "subject" } as const;

function clauseTerm(
  c: { column: string; op: string; operand?: unknown },
  byId: ReadonlyMap<MailboxId, Mailbox>,
): Term {
  const { column, op } = c;
  if (!isDeclaredMailOp(column, op)) {
    throw new Refused(
      column,
      op,
      "unsupported-op",
      `Mail cannot filter ${column} by "${op}"`,
    );
  }
  if (column === "mailboxes") {
    const terms = (c.operand as readonly MailboxId[]).map((id) =>
      mailboxTerm(id, op, byId),
    );
    if (op === "hasAny") return orOf(terms);
    if (op === "hasAll") return andOf(terms);
    return andOf(terms.map(negate)); // hasNone
  }
  if (column in FLAG_TERMS) {
    const positive = (op === "eq") === (c.operand as boolean);
    const t = atom(FLAG_TERMS[column as keyof typeof FLAG_TERMS]);
    return positive ? t : negate(t);
  }
  if (column === "date") {
    const ms = Date.parse(c.operand as string);
    // canonicalizeFilter admits only ISO-Z instants.
    if (Number.isNaN(ms))
      throw new Error(
        `mail: a canonical date operand did not parse: ${String(c.operand)}`,
      );
    if (ms % 1000 !== 0) {
      throw new Refused(
        column,
        op,
        "unrepresentable-operand",
        `Gmail compares dates at whole seconds; ${c.operand as string} falls between two`,
      );
    }
    const s = ms / 1000;
    if (op === "gte") return atom(`after:${s}`);
    if (op === "gt") return atom(`after:${s + 1}`);
    if (op === "lt") return atom(`before:${s}`);
    return atom(`before:${s + 1}`); // lte
  }
  if (column in TEXT_TERMS) {
    const t = atom(
      `${TEXT_TERMS[column as keyof typeof TEXT_TERMS]}:${quoted(column, op, c.operand as string)}`,
    );
    return op === "contains" ? t : negate(t);
  }
  // query: the search box, verbatim.
  const text = (c.operand as string).trim();
  if (text === "") return TRUE;
  if (!balanced(text)) {
    throw new Refused(
      column,
      op,
      "unrepresentable-operand",
      "The search has an unclosed parenthesis or quote",
    );
  }
  return /^\S+$/.test(text) ? atom(text) : atom(`(${text})`);
}

function termOf(f: Filter, byId: ReadonlyMap<MailboxId, Mailbox>): Term {
  if ("and" in f) return andOf(f.and.map((x) => termOf(x, byId)));
  if ("or" in f) return orOf(f.or.map((x) => termOf(x, byId)));
  return clauseTerm(f, byId);
}

export function compileGmailQuery(
  query: MailQuery,
  ctx: { mailboxes: readonly Mailbox[] },
): CompiledMailQuery {
  const canonical = canonicalizeFilter(query, MAIL_QUERY_COLUMNS);
  if (canonical === undefined)
    return { kind: "query", providerQuery: providerQuery("") };
  const byId = new Map(ctx.mailboxes.map((m) => [m.id, m]));
  let term: Term;
  try {
    term = termOf(canonical as Filter, byId);
  } catch (err) {
    if (!(err instanceof Refused)) throw err;
    return {
      kind: "refused",
      refusal: {
        column: err.column,
        op: err.op,
        reason: err.reason,
        message: err.message,
      },
    };
  }
  if (term.kind === "false") return { kind: "nothing" };
  return {
    kind: "query",
    providerQuery: providerQuery(term.kind === "true" ? "" : term.text),
  };
}

/** The query cut to messages before `olderThan` (its second included), for one list fill. */
export function withCut(q: string, olderThan: Date | null): string {
  if (olderThan === null) return q;
  const before = `before:${Math.floor(olderThan.getTime() / 1000) + 1}`;
  return q === "" ? before : `${q} ${before}`;
}
