import { useCallback, useMemo, useState } from "react";
import {
  DataViewViewList,
  useDataViewControls,
} from "@plugins/primitives/plugins/data-view/web";
import { Fill } from "@plugins/primitives/plugins/css/plugins/fill/web";
import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";
import { Center } from "@plugins/primitives/plugins/css/plugins/center/web";
import { Row } from "@plugins/primitives/plugins/css/plugins/row/web";
import { Scroll } from "@plugins/primitives/plugins/css/plugins/scroll/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { StatusDot } from "@plugins/primitives/plugins/css/plugins/status-dot/web";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import {
  ResourceError,
  ResourceErrorInline,
} from "@plugins/network/plugins/live/plugins/live-state/web";
import { TreeRowChrome } from "@plugins/primitives/plugins/tree/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import type {
  Mailbox,
  MailboxId,
} from "@plugins/apps/plugins/mail/plugins/provider/core";
import {
  labelColor,
  labelOfView,
  labelViewId,
  MAIL_BUILT_IN_VIEWS,
  MAIL_TUCKED_VIEWS,
} from "../../core";
import { userLabels, type MailboxesState } from "../internal/mailboxes";
import { labelLines } from "../internal/label-lines";

const moreIcon = symbol("more-horiz");
const copyIcon = symbol("content-copy");
const expandIcon = symbol("expand-more");
const collapseIcon = symbol("expand-less");

/** The sidebar's width, the prototype's column. */
const SIDEBAR_WIDTH = "w-54";

/**
 * The Mail surface's `aside`: the active view's name, ONE list of views — the
 * built-ins (Inbox, Sent, Drafts, Done; Spam and Trash folded under More
 * until asked for), then the user's own views and "+ New view", all
 * drag-reorderable — then the label tree, each label a view. Reads and drives
 * the DataView's views through `useDataViewControls()`, so the sidebar IS the
 * list's view switcher.
 */
export function MailSidebar({ mailboxes }: { mailboxes: MailboxesState }) {
  const { viewModel, activeViewId } = useDataViewControls();
  const { drafts, setRenamingId, dirtyFor, instances } = viewModel;
  const [more, setMore] = useState(false);
  const active = instances.find((r) => r.instance.id === activeViewId);

  const countFor = useCallback(
    (id: string): number | undefined => {
      if (mailboxes.kind !== "ready") return undefined;
      const view = MAIL_BUILT_IN_VIEWS.find((v) => v.id === id);
      if (view?.count == null) return undefined;
      const counts = mailboxes.byId.get(view.count.mailbox)?.counts;
      if (counts == null) return undefined;
      const n = view.count.of === "unread" ? counts.unread : counts.threads;
      return n === 0 ? undefined : n;
    },
    [mailboxes],
  );
  const include = useCallback(
    (v: { id: string }) =>
      labelOfView(v.id) === null &&
      (more || !MAIL_TUCKED_VIEWS.has(v.id) || v.id === activeViewId),
    [more, activeViewId],
  );
  if (drafts === null) {
    throw new Error(
      "MailSidebar: the Mail surface drafts its view edits (viewEdits), so built-in views have working copies",
    );
  }
  // "+ New view": the active view's filter as a view of the user's own,
  // named for renaming.
  const newView = () => {
    const id = drafts.saveAsNew(activeViewId, { name: "New view" });
    setRenamingId(id);
  };

  return (
    // The DataView sizes an in-flow aside to the scroller's viewport.
    <Stack gap="none" className={`${SIDEBAR_WIDTH} h-full`}>
      <Line className="h-12 gap-smd pr-lg pl-xl">
        <span
          aria-hidden
          className="size-2.25 rounded-full"
          style={{
            background: active?.instance.color ?? "var(--primary-text)",
          }}
        />
        <Text variant="heading" className="truncate">
          {active?.instance.name ?? ""}
        </Text>
        {dirtyFor(activeViewId) ? (
          <span title="Edited" aria-label="Edited">
            <StatusDot colorClass="bg-primary" />
          </span>
        ) : null}
      </Line>
      <Scroll fill className="pr-smd pb-lg">
        <Stack gap="none">
          <DataViewViewList
            newLabel="New view"
            onNew={newView}
            include={include}
            countFor={countFor}
          />
          <Row
            size="sm"
            icon={<Icon icon={more ? collapseIcon : expandIcon} />}
            onClick={() => setMore((m) => !m)}
          >
            <Text variant="label" tone="muted">
              {more ? "Less" : "More"}
            </Text>
          </Row>
          <Text
            as="h2"
            variant="caption"
            tone="faint"
            className="pt-lg pb-xs pl-lg"
          >
            Labels
          </Text>
          <Labels mailboxes={mailboxes} />
        </Stack>
      </Scroll>
    </Stack>
  );
}

/**
 * The labels part: the tree once read, loading rows until then, and a failed
 * read in place — but a refusal (not connected, offline) says nothing here:
 * the list says it, with its fix.
 */
function Labels({ mailboxes }: { mailboxes: MailboxesState }) {
  switch (mailboxes.kind) {
    case "loading":
      return <Loading variant="rows" count={4} />;
    case "failed":
      return mailboxes.error instanceof ResourceError &&
        mailboxes.error.kind === "refused" ? null : (
        <ResourceErrorInline
          variant="block"
          subject="your labels"
          error={mailboxes.error}
          refetch={mailboxes.refetch}
        />
      );
    case "ready":
      return <LabelTree mailboxes={mailboxes.mailboxes} />;
  }
}

/** The user's labels as their `/` tree, each a view; folds kept per session. */
function LabelTree({ mailboxes }: { mailboxes: readonly Mailbox[] }) {
  const { viewModel, activeViewId } = useDataViewControls();
  const [folded, setFolded] = useState<ReadonlySet<MailboxId>>(new Set());
  const labels = useMemo(() => userLabels(mailboxes), [mailboxes]);
  const lines = useMemo(() => labelLines(labels, folded), [labels, folded]);
  const toggle = (id: MailboxId) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <Stack gap="none">
      {lines.map(({ label, depth, hasChildren, rolledUnread }) => {
        const viewId = labelViewId(label.id);
        const color = labelColor(label, mailboxes);
        const unread = rolledUnread ?? label.counts?.unread ?? 0;
        return (
          <TreeRowChrome
            key={label.id}
            rowId={viewId}
            depth={depth}
            hasChildren={hasChildren}
            isOpen={!folded.has(label.id)}
            selected={viewId === activeViewId}
            onToggle={() => toggle(label.id)}
            onSelect={() => viewModel.setActiveView(viewId)}
            icon={
              <Center axis="both" className="size-4" aria-hidden>
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: color ?? "var(--muted-foreground)" }}
                />
              </Center>
            }
            actions={
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <IconButton
                      icon={moreIcon}
                      label={`${label.name} actions`}
                    />
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => viewModel.actions.duplicateView(viewId)}
                  >
                    <Icon icon={copyIcon} className="size-4" />
                    Duplicate
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
          >
            <Fill>
              <Text variant="label" className="truncate">
                {label.name}
              </Text>
            </Fill>
            {unread > 0 ? (
              <Text variant="caption" tone="faint" className="tabular-nums">
                {unread}
              </Text>
            ) : null}
          </TreeRowChrome>
        );
      })}
    </Stack>
  );
}
