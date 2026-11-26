import { describe, expect, test } from "bun:test";
import {
  and,
  clause,
  or,
} from "@plugins/network/plugins/live/plugins/filter/core";
import { MAIL_QUERY_OPS } from "@plugins/apps/plugins/mail/plugins/provider/server/testing";
import {
  nativeMailboxId,
  providerQuery,
  roleMailboxId,
  type Mailbox,
  type MailQuery,
} from "@plugins/apps/plugins/mail/plugins/provider/core";
import { compileGmailQuery, withCut } from "./compile-query";

const work: Mailbox = {
  id: nativeMailboxId("Label_1"),
  name: "Work",
  role: null,
  kind: "user",
  parentId: null,
  counts: null,
  color: null,
};
const clients: Mailbox = {
  ...work,
  id: nativeMailboxId("Label_2"),
  name: "Clients",
  parentId: work.id,
};
const quoteName: Mailbox = {
  ...work,
  id: nativeMailboxId("Label_3"),
  name: 'say "hi"',
};
const chatSystem: Mailbox = {
  ...work,
  id: nativeMailboxId("Label_SYS"),
  kind: "system",
  name: "Odd",
};
const ctx = { mailboxes: [work, clients, quoteName, chatSystem] };

const q = (f: MailQuery) => compileGmailQuery(f, ctx);
const text = (f: MailQuery) => {
  const c = q(f);
  if (c.kind !== "query")
    throw new Error(`expected a query, got ${JSON.stringify(c)}`);
  return c.providerQuery as string;
};
const refusal = (f: MailQuery) => {
  const c = q(f);
  if (c.kind !== "refused")
    throw new Error(`expected a refusal, got ${JSON.stringify(c)}`);
  return c.refusal;
};

// One sample operand per column, and what each declared op spells with it.
const SAMPLES: Record<
  string,
  { operand: unknown; spells: Record<string, string> }
> = {
  mailboxes: {
    operand: [roleMailboxId("inbox"), clients.id],
    spells: {
      // List operands are canonical: sorted (`Label_2` before `role:inbox`).
      hasAny: '(label:"Work/Clients" OR in:inbox)',
      hasAll: 'label:"Work/Clients" in:inbox',
      hasNone: '-label:"Work/Clients" -in:inbox',
    },
  },
  unread: { operand: true, spells: { eq: "is:unread", ne: "-is:unread" } },
  starred: { operand: false, spells: { eq: "-is:starred", ne: "is:starred" } },
  hasAttachment: {
    operand: true,
    spells: { eq: "has:attachment", ne: "-has:attachment" },
  },
  date: {
    operand: "2026-01-02T00:00:00.000Z",
    spells: {
      gte: "after:1767312000",
      gt: "after:1767312001",
      lt: "before:1767312000",
      lte: "before:1767312001",
    },
  },
  from: {
    operand: "ana smith",
    spells: { contains: 'from:"ana smith"', notContains: '-from:"ana smith"' },
  },
  to: {
    operand: "bo",
    spells: { contains: 'to:"bo"', notContains: '-to:"bo"' },
  },
  subject: {
    operand: "q3 plan",
    spells: {
      contains: 'subject:"q3 plan"',
      notContains: '-subject:"q3 plan"',
    },
  },
  query: {
    operand: "has:pdf older_than:1y",
    spells: { contains: "(has:pdf older_than:1y)" },
  },
};

describe("compileGmailQuery", () => {
  test("is total over the contract's operators: every declared pair compiles", () => {
    for (const [column, ops] of Object.entries(MAIL_QUERY_OPS)) {
      for (const op of ops) {
        const sample = SAMPLES[column]!;
        const f = {
          column,
          op,
          operand: sample.operand,
        } as unknown as MailQuery;
        expect([column, op, text(f)]).toEqual([column, op, sample.spells[op]!]);
      }
    }
  });

  test("no filter is every message; or: [] is nothing; an empty search is no term", () => {
    expect(text(undefined)).toBe("");
    expect(q({ or: [] }).kind).toBe("nothing");
    expect(
      text(
        and(clause("query", "contains", "  "), clause("unread", "eq", true)),
      ),
    ).toBe("is:unread");
    expect(
      text(or(clause("query", "contains", ""), clause("unread", "eq", true))),
    ).toBe("");
  });

  test("groups nest with parentheses; an AND inside an OR is grouped", () => {
    expect(
      text(
        and(
          clause("mailboxes", "hasAny", [roleMailboxId("inbox")]),
          or(
            and(
              clause("from", "contains", "ana"),
              clause("unread", "eq", true),
            ),
            clause("starred", "eq", true),
          ),
        ),
      ),
    ).toBe('in:inbox ((from:"ana" is:unread) OR is:starred)');
  });

  test("an operator outside the contract is refused, naming the clause", () => {
    expect(
      refusal(clause("subject", "eqCi", "x") as unknown as MailQuery),
    ).toMatchObject({
      column: "subject",
      op: "eqCi",
      reason: "unsupported-op",
    });
    expect(
      refusal(clause("mailboxes", "isEmpty") as unknown as MailQuery).reason,
    ).toBe("unsupported-op");
  });

  test("mailboxes Gmail cannot search are refused, never dropped", () => {
    const r = (id: string) =>
      refusal(
        and(
          clause("unread", "eq", true),
          clause("mailboxes", "hasAny", [id as never]),
        ),
      );
    expect(r("role:archive").reason).toBe("unsupported-mailbox");
    expect(r("role:all").reason).toBe("unsupported-mailbox");
    expect(r("Label_404").reason).toBe("unknown-mailbox");
    expect(r("UNREAD").reason).toBe("unknown-mailbox");
    expect(r("Label_SYS").reason).toBe("unsupported-mailbox");
    expect(r("Label_3").reason).toBe("unrepresentable-operand");
    // A child whose parent is missing from the list given: its name is unknown, never shortened.
    expect(
      compileGmailQuery(clause("mailboxes", "hasAny", [clients.id]), {
        mailboxes: [clients],
      }).kind,
    ).toBe("refused");
    expect(
      text(clause("mailboxes", "hasAny", [nativeMailboxId("CATEGORY_SOCIAL")])),
    ).toBe("category:social");
  });

  test("operands with no exact spelling are refused", () => {
    expect(
      refusal(clause("date", "gte", "2026-01-02T00:00:00.500Z")).reason,
    ).toBe("unrepresentable-operand");
    expect(refusal(clause("from", "contains", 'a"b')).reason).toBe(
      "unrepresentable-operand",
    );
    expect(refusal(clause("from", "contains", " ")).reason).toBe(
      "unrepresentable-operand",
    );
    expect(refusal(clause("query", "contains", "(unclosed")).reason).toBe(
      "unrepresentable-operand",
    );
    expect(text(clause("query", "contains", 'subject:"a (b"'))).toBe(
      '(subject:"a (b")',
    );
  });

  test("a cut is ANDed as before:<its second, rounded up>: a superset, never fewer", () => {
    const at = new Date("2026-01-02T00:00:00.700Z");
    expect(withCut("", at)).toBe("before:1767312001");
    expect(withCut("(a OR b)", at)).toBe("(a OR b) before:1767312001");
    // On a whole second, `before:` that second is already exclusive.
    expect(withCut("x", new Date("2026-01-02T00:00:00.000Z"))).toBe(
      "x before:1767312000",
    );
    expect(withCut("x", null)).toBe("x");
  });

  test("a label is spelled as Gmail's search reads it: quoted, or the hyphen form once parenthesised", () => {
    const label = (name: string, extra: Mailbox[] = []) => {
      const m: Mailbox = { ...work, id: nativeMailboxId("Label_9"), name };
      return compileGmailQuery(clause("mailboxes", "hasAny", [m.id]), {
        mailboxes: [work, m, ...extra],
      });
    };
    expect(label("Big clients (EU)")).toEqual({
      kind: "query",
      providerQuery: providerQuery("label:Big-clients-(EU)"),
    });
    expect(label("café & co")).toMatchObject({
      providerQuery: 'label:"café & co"',
    });
    // A quote has no spelling either way; a parenthesised name only the measured characters.
    for (const bad of ['say "hi"', "café (x)", "a(b", "x:(y)"]) {
      const c = label(bad);
      expect([bad, c.kind === "refused" && c.refusal.reason]).toEqual([
        bad,
        "unrepresentable-operand",
      ]);
    }
    // Two labels Gmail's hyphen form spells alike: neither can be searched alone.
    const twin: Mailbox = {
      ...work,
      id: nativeMailboxId("Label_8"),
      name: "A-(B)",
    };
    const c = label("a (b)", [twin]);
    expect(c.kind === "refused" && c.refusal.reason).toBe(
      "unrepresentable-operand",
    );
  });
});
