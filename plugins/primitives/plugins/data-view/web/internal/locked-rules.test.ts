import { describe, expect, it } from "bun:test";
import type { FilterGroup, FilterRule } from "../../core";
import { keepLockedRules, lockedRules, unlockedFilter } from "./locked-rules";

const base: FilterRule = {
  kind: "rule",
  id: "not-bin",
  fieldId: "mailboxes",
  operatorId: "lacks-nested",
  value: ["role:spam", "role:trash"],
  locked: true,
};
const user: FilterRule = {
  kind: "rule",
  id: "from-ana",
  fieldId: "from",
  operatorId: "contains",
  value: "ana",
};
const root = (...children: FilterGroup["children"]): FilterGroup => ({
  kind: "group",
  id: "root",
  conjunction: "and",
  children,
});

const inbox: FilterRule = {
  kind: "rule",
  id: "inbox-in",
  fieldId: "mailboxes",
  operatorId: "contains-any-of",
  value: ["role:inbox"],
};

describe("locked rules", () => {
  it("are the direct rules of an `and` root marked locked", () => {
    expect(lockedRules(root(base, user))).toEqual([base]);
    expect(lockedRules({ ...root(base), conjunction: "or" })).toEqual([]);
    expect(lockedRules(null)).toEqual([]);
  });

  it("survive a clear and a remove", () => {
    expect(keepLockedRules(root(base, user), null)).toEqual(root(base));
    expect(keepLockedRules(root(base, user), root(user))).toEqual(
      root(base, user),
    );
  });

  it("go back at their saved place, so an edit undone is the saved filter", () => {
    const saved = root(inbox, base);
    const added = keepLockedRules(saved, root(inbox, base, user))!;
    expect(added).toEqual(root(inbox, base, user));
    // The chip's ×: the rule added, then removed.
    expect(keepLockedRules(added, root(inbox, base))).toEqual(saved);
    // A clear, then the built-in's own rule back.
    expect(keepLockedRules(saved, root(inbox))).toEqual(saved);
  });

  it("cannot be edited: the edit of one is dropped, the original kept", () => {
    const edited = { ...base, value: ["role:spam"] };
    expect(keepLockedRules(root(base), root(edited, user))).toEqual(
      root(base, user),
    );
  });

  it("are ANDed before an `or` the edit made of the root, under ids of their own", () => {
    const or: FilterGroup = { ...root(user), conjunction: "or" };
    const kept = keepLockedRules(root(base), or)!;
    expect(kept.conjunction).toBe("and");
    expect(kept.children[0]).toEqual(base);
    const inner = kept.children[1] as FilterGroup;
    expect(inner).toMatchObject({
      kind: "group",
      conjunction: "or",
      children: [user],
    });
    expect(inner.id).not.toBe(kept.id);
  });

  it("cannot be added by an edit", () => {
    expect(keepLockedRules(root(user), root(base, user))).toEqual(root(user));
    expect(keepLockedRules(null, null)).toBeNull();
  });

  it("are dropped when named on purpose (an unavailable rule removed)", () => {
    expect(
      keepLockedRules(root(base, user), root(user), new Set([base.id])),
    ).toEqual(root(user));
  });

  it("are left out of what the user narrows by", () => {
    expect(unlockedFilter(root(base, user))).toEqual(root(user));
    expect(unlockedFilter(root(user))).toEqual(root(user));
  });
});
