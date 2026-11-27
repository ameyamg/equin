import { useMemo, useRef, type ReactNode } from "react";
import { useSurfaceShortcuts } from "@plugins/primitives/plugins/shortcuts/web";
import { focusElement } from "@plugins/primitives/plugins/dom/plugins/scroll-reveal/web";
import {
  DataView,
  defineDataView,
  fieldOverrides,
  liveDataSource,
} from "@plugins/primitives/plugins/data-view/web";
import type {
  DataViewLockedView,
  DataViewReadFailure,
} from "@plugins/primitives/plugins/data-view/core";
import { ResourceError } from "@plugins/network/plugins/live/plugins/live-state/web";
import {
  PaneScroll,
  useOpenPane,
  usePaneViewParam,
} from "@plugins/primitives/plugins/pane/web";
import { Center } from "@plugins/primitives/plugins/css/plugins/center/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import { MailProviderConnect } from "@plugins/apps/plugins/mail/plugins/provider/web";
import { MailProviderChoice } from "@plugins/apps/plugins/mail/plugins/cache/web";
import {
  mailThreads,
  type MailThreadRow,
  type MailThreadsRefusal,
} from "@plugins/apps/plugins/mail/plugins/cache/core";
import {
  labelColor,
  labelOfView,
  labelView,
  MAIL_BUILT_IN_VIEWS,
  MAIL_INBOX_VIEW,
} from "../../core";
import type { Mailbox } from "@plugins/apps/plugins/mail/plugins/provider/core";
import { mailboxLabel, useMailboxes, userLabels } from "../internal/mailboxes";
import { mailThreadPane } from "../panes";
import { ThreadItemActions } from "../slots";
import { MailBulkActions } from "./thread-triage";
import { useMailActions } from "../internal/actions";
import { mailThreadsStepper } from "../internal/stepper";
import { MailSidebar } from "./mail-sidebar";
import { MAIL_MEASURE, mailToolbar } from "./mail-toolbar";
import {
  ThreadAvatar,
  ThreadRow,
  type LabelChipInfo,
  type ThreadRowContext,
} from "./thread-row";

// Marker scraped by codegen (data-views.generated.ts). Must live in web/**.
const THREADS_VIEW = defineDataView("mail.threads");

/**
 * Every view's threads: the live window of `mail.threads`, the search box
 * being the provider's own search (`query`, Gmail's operators and all, over
 * the whole mailbox).
 */
const threadsSource = liveDataSource(mailThreads, {
  surface: THREADS_VIEW,
  unscoped: {
    reason:
      "served external from the Mail cache, whose windows the mail provider answers — a custom column is a Postgres side table joined into a routed SQL window, which an external window cannot join",
  },
  searchable: ["query"],
  fixedOrder: {
    reason:
      "the mail provider lists threads newest first, and the app keeps no copy of the mailbox to reorder (design §4)",
  },
});

/** The built-ins as the DataView takes them (their sidebar counts stay here). */
const BUILT_IN_VIEWS: readonly DataViewLockedView[] = MAIL_BUILT_IN_VIEWS.map(
  ({ count: _count, ...view }) => view,
);

/** Sent and Drafts are read by who they went to. */
const RECIPIENT_VIEWS = new Set(["sent", "drafts"]);

/**
 * The Mail app's whole index pane: the threads DataView, its views listed by
 * the mail sidebar (its `aside`), its search box and controls by the mail
 * toolbar. Rows are threads, always newest first; read-only in this step.
 */
export function MailScreen(): ReactNode {
  const { state: mailboxes, options } = useMailboxes();
  const { run } = useMailActions();
  // The active view, as the pane URL names it (absent: the Inbox, the
  // surface's default) — the URL is derived from what is on screen.
  const viewParam = usePaneViewParam(THREADS_VIEW)?.value;
  // The thread open beside the list is the selected row; a row opens its thread.
  const openPane = useOpenPane();
  const openThreadId = mailThreadPane.useRouteEntry()?.params.threadId;
  const activeViewId = viewParam?.split("~")[0] ?? MAIL_INBOX_VIEW.id;

  // The label views change only when a label does (name, nesting, colour) —
  // never with its counts, which move with every read mail.
  const labelsKey =
    mailboxes.kind === "ready" ? labelViewsKey(mailboxes.mailboxes) : null;
  const lockedViews = useMemo((): readonly DataViewLockedView[] => {
    if (labelsKey === null) return BUILT_IN_VIEWS;
    const all = JSON.parse(labelsKey) as Mailbox[];
    return [
      ...BUILT_IN_VIEWS,
      ...userLabels(all).map((label) => labelView(label, all)),
    ];
  }, [labelsKey]);

  const now = useMemo(() => new Date(), []);
  const rowCtx = useMemo(
    (): ThreadRowContext => ({
      labels:
        mailboxes.kind === "ready"
          ? labelChips(mailboxes.mailboxes)
          : new Map(),
      viewLabel: labelOfView(activeViewId),
      names: RECIPIENT_VIEWS.has(activeViewId) ? "recipients" : "senders",
      now,
    }),
    [mailboxes, activeViewId, now],
  );
  const overrides = useMemo(
    () =>
      fieldOverrides(mailThreads, {
        from: { width: "12rem" },
        to: { visible: false },
        date: { label: "Received", width: "6rem" },
        mailboxes: {
          label: "Labels",
          optionsResult: options,
          // The standard tags editor (the tag picker over the labels): the
          // labels it added and removed, as one labels op. Roles are `fixed`
          // options, which it neither offers nor removes.
          onEditValues: (row, next) => {
            const add = next.filter((id) => !row.mailboxes.includes(id));
            const remove = row.mailboxes.filter((id) => !next.includes(id));
            run([row.id], { kind: "labels", add, remove }, { toast: false });
          },
        },
        unread: { visible: false },
        // No starring in Mail (the user's call): never shown, never a rule.
        starred: { visible: false, filterable: false, groupable: false },
        hasAttachment: { label: "Attachment", visible: false },
        query: { visible: false, filterable: false, groupable: false },
      }),
    [options, run],
  );
  const viewOptions = useMemo(
    () => ({
      list: {
        renderRow: (t: MailThreadRow) => <ThreadRow thread={t} ctx={rowCtx} />,
        renderLeading: (t: MailThreadRow) => (
          <ThreadAvatar thread={t} ctx={rowCtx} />
        ),
        lines: 1 as const,
        // A row restacked to three lines (the reader open) leads at its top.
        leadAlign: "start" as const,
        // Each day is one card, as in the prototype.
        frame: "section" as const,
        // j / k open the next / previous thread (marked read as it opens);
        // the open thread's Done steps through the same stepper.
        stepKeys: mailThreadsStepper,
      },
    }),
    [rowCtx],
  );

  // Checkbox selection, its actions in a bar at the foot of the list.
  const inTrash = activeViewId === "trash";
  const selection = useMemo(
    () => ({
      bulkActions: <MailBulkActions inTrash={inTrash} />,
      bar: "bottom" as const,
    }),
    [inTrash],
  );

  // /: the search box (e and # are the open thread's: its pane's).
  const root = useRef<HTMLDivElement>(null);
  useSurfaceShortcuts([
    {
      id: "mail.search",
      keys: "/",
      label: "Search mail",
      group: "Mail",
      handler: () => focusSearch(),
    },
    {
      // Where "/" is shifted (German layouts).
      id: "mail.search-shifted",
      keys: "shift+/",
      label: "Search mail",
      group: "Mail",
      handler: () => focusSearch(),
    },
  ]);
  function focusSearch() {
    focusElement(
      root.current?.querySelector<HTMLInputElement>("[data-mail-search] input"),
      { reveal: true },
    );
  }

  // A label view named by the URL waits for the labels, rather than resolve
  // to the Inbox and rewrite the address.
  if (labelOfView(activeViewId) !== null && mailboxes.kind === "loading") {
    return <Loading variant="rows" count={8} />;
  }
  // The pane has no chrome (the sidebar names the view), so it opens its own
  // one scroll: the DataView never owns one, and its sidebar is sized to it.
  return (
    <PaneScroll>
      <div ref={root} className="contents">
    <DataView<MailThreadRow>
      source={threadsSource}
      overrides={overrides}
      views={["list", "table"]}
      defaultView={MAIL_INBOX_VIEW.id}
      viewEdits={{ mode: "draft", locked: lockedViews }}
      switcherForm="none"
      toolbar={mailToolbar}
      viewOptions={viewOptions}
      searchPlaceholder={`Search ${activeName(activeViewId, lockedViews)}`}
      aside={<MailSidebar mailboxes={mailboxes} />}
        measure={MAIL_MEASURE}
      errorState={refusalState}
        selectedRowId={openThreadId}
        rowActivation={(t) =>
          openPane.to(mailThreadPane, { threadId: t.id }, { mode: "push" })
        }
      emptyState={<EmptyMail inbox={activeViewId === MAIL_INBOX_VIEW.id} />}
          itemActions={ThreadItemActions}
          selection={selection}
    />
      </div>
    </PaneScroll>
  );
}

/** What defines the label views, as one comparable string (counts left out). */
function labelViewsKey(mailboxes: readonly Mailbox[]): string {
  return JSON.stringify(mailboxes.map((m) => ({ ...m, counts: null })));
}

/** Each user label's chip, once per read: its `/` path and its colour. */
export function labelChips(
  all: readonly Mailbox[],
): ReadonlyMap<string, LabelChipInfo> {
  return new Map(
    userLabels(all).map((m) => [
      m.id,
      { name: mailboxLabel(m, all), color: labelColor(m, all) },
    ]),
  );
}

function activeName(id: string, views: readonly DataViewLockedView[]): string {
  return views.find((v) => v.id === id)?.name ?? "mail";
}

/** A refused window, by its code: not connected draws the provider's fix. */
function refusalState(failure: DataViewReadFailure): ReactNode | undefined {
  const { error } = failure;
  if (!(error instanceof ResourceError)) return undefined;
  const code = error.code as MailThreadsRefusal | null;
  if (code === "provider-not-chosen") {
    return <MailProviderChoice message={error.message} />;
  }
  if (code !== "not-connected") return undefined;
  return <MailProviderConnect message={error.message} />;
}

/** Ready, and no thread: the Inbox is done; any other view is empty. */
function EmptyMail({ inbox }: { inbox: boolean }): ReactNode {
  return (
    <Center axis="horizontal" className="py-2xl">
      <Stack gap="lg" align="center">
        {inbox ? (
          <span
            aria-hidden
            className="size-27.5 rounded-full"
            style={{
              background:
                "radial-gradient(circle, color-mix(in srgb, #d4854f 80%, var(--card)) 0 38%, color-mix(in srgb, #d4854f 35%, var(--background)) 39% 55%, color-mix(in srgb, #d4854f 14%, var(--background)) 56% 70%, transparent 71%)",
            }}
          />
        ) : null}
        <Stack gap="2xs" align="center">
          <Text variant="heading">{inbox ? "All done" : "Nothing here"}</Text>
          {inbox ? (
            <Text variant="body" tone="faint">
              Nothing needs you right now.
            </Text>
          ) : null}
        </Stack>
      </Stack>
    </Center>
  );
}
