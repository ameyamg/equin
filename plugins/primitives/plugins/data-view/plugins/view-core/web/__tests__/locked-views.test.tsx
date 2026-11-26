import { symbol } from "@plugins/ui/plugins/icons/core";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SealContributions } from "@plugins/framework/plugins/web-sdk/core";
import type { ConfigDescriptor } from "@plugins/config_v2/core";
import type { VariantValue } from "@plugins/fields/plugins/variant/core";
import { useViewModel } from "../internal/use-view-model";
import type {
  LockedViewRow,
  ViewConfigRow,
  ViewSourceEntry,
  ViewTypeMeta,
} from "../../core";

// Locked views: the host's own views (a mailbox, a label), copy-only, placed
// first unless a config placeholder row of their id says where they go. The
// config read/write is faked the way `view-drafts.test.tsx` fakes it.
const setConfigSpy = vi.fn();
let configDoc: { views: unknown[] } = { views: [] };
vi.mock("@plugins/config_v2/web", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useConfigResult: () => ({
    status: "ready",
    data: configDoc,
    refetch: async () => {},
  }),
  useSetConfig: () => setConfigSpy,
}));

const listIcon = symbol("view-list");
const contributions = [
  { type: "list", title: "List", icon: listIcon },
] as unknown as SealContributions<ViewTypeMeta>[];
const entries: ViewSourceEntry<ViewTypeMeta>[] = [{ contributions }];
const descriptorMap = {
  get: () => ({}) as ConfigDescriptor,
} as unknown as Map<string, ConfigDescriptor>;

const INBOX_VIEW = { type: "list", filter: { box: "inbox" } } as VariantValue;
const LOCKED: readonly LockedViewRow[] = [
  { id: "inbox", name: "Inbox", icon: symbol("inbox"), view: INBOX_VIEW },
  { id: "spam", name: "Spam", color: "#f00", view: { type: "list" } },
];

let keySeq = 0;
let storageKey = "";
beforeEach(() => {
  storageKey = `locked-test-${++keySeq}`;
  setConfigSpy.mockClear();
  configDoc = { views: [{ id: "mine", name: "Mine", view: { type: "list" } }] };
});

function render(locked: readonly LockedViewRow[] = LOCKED) {
  return renderHook(() =>
    useViewModel<ViewTypeMeta>(
      storageKey,
      descriptorMap,
      entries,
      undefined,
      undefined,
      {
        drafts: true,
        locked,
      },
    ),
  );
}

const ids = (r: { current: { instances: { instance: { id: string } }[] } }) =>
  r.current.instances.map((i) => i.instance.id);

function flushed(unmount: () => void): ViewConfigRow[] {
  unmount();
  const last = setConfigSpy.mock.calls.at(-1);
  expect(last?.[0]).toBe("views");
  return last?.[1] as ViewConfigRow[];
}

describe("useViewModel — locked views", () => {
  it("lists them first, marked, with their icon and colour", () => {
    const { result } = render();
    expect(ids(result)).toEqual(["inbox", "spam", "mine"]);
    const [inbox, spam] = result.current.instances;
    expect(inbox!.instance.locked).toBe(true);
    expect(inbox!.instance.icon).toEqual(symbol("inbox"));
    expect(spam!.instance.color).toBe("#f00");
    expect(result.current.savedViewFor("inbox")).toBe(INBOX_VIEW);
  });

  it("needs drafts", () => {
    expect(() =>
      renderHook(() =>
        useViewModel<ViewTypeMeta>(
          storageKey,
          descriptorMap,
          entries,
          undefined,
          undefined,
          {
            locked: LOCKED,
          },
        ),
      ),
    ).toThrow(/locked views need drafts/);
  });

  it("an edit is a working copy, never saved over the view", () => {
    const { result } = render();
    act(() =>
      result.current.updateView("inbox", { sort: [1] } as never, {
        merge: true,
      }),
    );
    expect(result.current.dirtyFor("inbox")).toBe(true);
    expect(() => result.current.drafts!.save("inbox")).toThrow(/locked view/);
    expect(() => result.current.actions.renameView("inbox", "x")).toThrow();
    expect(() => result.current.actions.deleteView("inbox")).toThrow();
  });

  it("saves as a NEW config row, from its working copy", () => {
    const { result, unmount } = render();
    act(() =>
      result.current.updateView("inbox", { sort: [1] } as never, {
        merge: true,
      }),
    );
    let id = "";
    act(() => {
      id = result.current.drafts!.saveAsNew("inbox", { name: "Inbox copy" });
    });
    expect(result.current.dirtyFor("inbox")).toBe(false);
    expect(result.current.activeId).toBe(id);
    const rows = flushed(unmount);
    expect(rows.at(-1)).toMatchObject({
      id,
      name: "Inbox copy",
      view: { ...INBOX_VIEW, sort: [1] },
    });
  });

  it("a config placeholder of its id places it, and dragging one writes its placeholder", () => {
    configDoc = {
      views: [
        {
          id: "inbox",
          name: "Inbox",
          view: { type: "list", lockedPlaceholder: true },
        },
        { id: "mine", name: "Mine", view: { type: "list" } },
      ],
    };
    const { result, unmount } = render();
    // Spam has no placeholder: head. Inbox sits at its placeholder, and is
    // still the host's view, not the placeholder's.
    expect(ids(result)).toEqual(["spam", "inbox", "mine"]);
    expect(result.current.savedViewFor("inbox")).toBe(INBOX_VIEW);
    expect(result.current.instances[1]!.instance.locked).toBe(true);
    // Spam after Mine: its placeholder lands at the end of the config.
    act(() => result.current.actions.reorderView("spam", 2));
    expect(ids(result)).toEqual(["inbox", "mine", "spam"]);
    // A placed locked view moves like any row.
    act(() => result.current.actions.reorderView("inbox", 1));
    expect(ids(result)).toEqual(["mine", "inbox", "spam"]);
    expect(flushed(unmount).map((r) => r.id)).toEqual([
      "mine",
      "inbox",
      "spam",
    ]);
  });

  it("a move within the head keeps the head's order and lands where dropped", () => {
    const { result, unmount } = render();
    expect(ids(result)).toEqual(["inbox", "spam", "mine"]);
    // Spam before Inbox: both head views, so both get placeholders.
    act(() => result.current.actions.reorderView("spam", 0));
    expect(ids(result)).toEqual(["spam", "inbox", "mine"]);
    // A config row dropped into the (former) head lands where dropped.
    act(() => result.current.actions.reorderView("mine", 0));
    expect(ids(result)).toEqual(["mine", "spam", "inbox"]);
    const rows = flushed(unmount);
    expect(rows.map((r) => r.id)).toEqual(["mine", "spam", "inbox"]);
    expect(rows[1]!.view).toEqual({ type: "list", lockedPlaceholder: true });
  });

  it("drops a placeholder whose locked view is gone", () => {
    configDoc = {
      views: [
        {
          id: "label-x",
          name: "Gone",
          view: { type: "list", lockedPlaceholder: true },
        },
        { id: "mine", name: "Mine", view: { type: "list" } },
      ],
    };
    const { result } = render();
    expect(ids(result)).toEqual(["inbox", "spam", "mine"]);
  });
});
