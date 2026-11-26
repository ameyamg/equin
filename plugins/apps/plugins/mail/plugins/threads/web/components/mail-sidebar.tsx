import { useCallback, useMemo } from "react";
import { useCollapsible } from "@plugins/primitives/plugins/collapsible/web";
import { TagPickerPanel } from "@plugins/tag-tree/plugins/picker/web";
import {
  DataViewViewList,
  useDataViewControls,
} from "@plugins/primitives/plugins/data-view/web";
import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";
import { Row } from "@plugins/primitives/plugins/css/plugins/row/web";
import { Scroll } from "@plugins/primitives/plugins/css/plugins/scroll/web";
import {
  Inset,
  Stack,
} from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Center } from "@plugins/primitives/plugins/css/plugins/center/web";
import { rigidClass } from "@plugins/primitives/plugins/css/plugins/rigid/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { StatusDot } from "@plugins/primitives/plugins/css/plugins/status-dot/web";
import {
  DropdownMenuItem,
  Separator,
} from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import {
  ResourceError,
  ResourceErrorInline,
} from "@plugins/network/plugins/live/plugins/live-state/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import type {
  Mailbox,
  MailboxId,
} from "@plugins/apps/plugins/mail/plugins/provider/core";
import {
  labelOfView,
  labelViewId,
  MAIL_BUILT_IN_VIEWS,
  MAIL_TUCKED_VIEWS,
} from "../../core";
import type { MailboxesState } from "../internal/mailboxes";
import { useMailLabelSource } from "../internal/label-source";
import { ComposeButton } from "@plugins/apps/plugins/mail/plugins/compose/web";
import { mailAccountStatus } from "@plugins/apps/plugins/mail/plugins/cache/core";
import { useLive } from "@plugins/network/plugins/live/web";
import { avatarColor } from "@plugins/apps/plugins/mail/plugins/shell/core";

const copyIcon = symbol("content-copy");
const expandIcon = symbol("expand-more");
const collapseIcon = symbol("expand-less");

/**
 * The sidebar's width, the prototype's column: 216px, and below 800px of the
 * Mail surface (the `mail` container, `MailLayout`) a 52px icon rail. The
 * sidebar is the `nav-rail` container its rows read (`rail:`): narrow, each
 * draws its glyph alone.
 */
const SIDEBAR_WIDTH = "w-54 @max-[800px]/mail:w-13 @container/nav-rail";

/** The box a reader laid over the list leaves in view (`overlayBelow`). */
const OVERLAY_START = "anchor-pane-overlay-start";

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
  // More is a disclosure: it folds Spam and Trash open in their places.
  // Its rows sit among the other views (no one region to point
  // `aria-controls` at), so the trigger reports its state and toggles only.
  const { open: more, toggle: toggleMore } = useCollapsible();
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
    (v: { id: string }) => labelOfView(v.id) === null,
    [],
  );
  const folded = useCallback(
    (v: { id: string }) =>
      !more && MAIL_TUCKED_VIEWS.has(v.id) && v.id !== activeViewId,
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
    <Stack
      gap="none"
      className={`${SIDEBAR_WIDTH} ${OVERLAY_START} h-full text-sidebar-foreground`}
    >
      {/* The view's name; in the rail, the bar's empty corner. */}
      <Line className="h-12 gap-smd pr-lg pl-xl rail:invisible">
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
      <Inset l="smd" r="smd" b="smd" className={`${rigidClass()} rail:px-xsm`}>
        <ComposeButton className="w-full" />
      </Inset>
      <Scroll fill className="pr-smd pb-lg rail:px-xsm">
        <Stack gap="none">
          <DataViewViewList
            newLabel="New view"
            onNew={newView}
            include={include}
            folded={folded}
            countFor={countFor}
          />
          <Row
            size="nav"
            className="rounded-nav-row"
            icon={<Icon icon={more ? collapseIcon : expandIcon} />}
            aria-expanded={more}
            onClick={toggleMore}
          >
            <Text variant="label" tone="faint">
              {more ? "Less" : "More"}
            </Text>
          </Row>
          {/* The Labels heading; in the rail, a hairline. */}
          <Line className="px-sidebar-row pt-lg pb-xs rail:hidden">
            <Text
              as="h2"
              variant="caption"
              tone="faint"
              className="font-medium"
            >
              Labels
            </Text>
          </Line>
          <Inset y="sm" className="hidden rail:block">
            <Separator />
          </Inset>
          <Labels mailboxes={mailboxes} />
        </Stack>
      </Scroll>
      <AccountFooter />
    </Stack>
  );
}

/** The sidebar's foot (the prototype's): the account mail is read and sent as — its initial and address. */
function AccountFooter() {
  const status = useLive(mailAccountStatus);
  // Loading or failed: the list says why; the foot waits.
  if (status.status === "loading" || status.status === "error") return null;
  if (status.data.kind === "none") return null;
  const address = status.data.address;
  return (
    <Line
      className={`h-12 gap-smd px-sidebar-row pr-smd ${rigidClass()} rail:pr-none rail:pl-md`}
      title={address}
    >
      <Center
        axis="both"
        aria-hidden
        className={`size-6 rounded-full ${rigidClass()}`}
        style={{ background: avatarColor(address) }}
      >
        <Text variant="caption" className="font-label-strong text-white">
          {address.slice(0, 1).toUpperCase()}
        </Text>
      </Center>
      <Text variant="caption" tone="faint" className="truncate rail:hidden">
        {address}
      </Text>
    </Line>
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

/**
 * The user's labels as their `/` tree, each a view: the shared tag picker's
 * tree (`TagPickerPanel` over `useMailLabelSource`) — a click opens the
 * label's view (highlighted while open), ＋ adds a sub-label, double-click
 * renames, drag nests, ⋯ renames, recolours (the provider's palette), moves
 * out, deletes or duplicates the view, and "New label" at the foot. Each
 * label's own unread count beside it — a folded one's, the total under it
 * (the prototype's). Every label wears a full dot of its colour.
 */
function LabelTree({ mailboxes }: { mailboxes: readonly Mailbox[] }) {
  const { viewModel, activeViewId } = useDataViewControls();
  const source = useMailLabelSource();
  const active = labelOfView(activeViewId);
  const selected = useMemo(() => (active === null ? [] : [active]), [active]);
  const unread = useMemo(
    () =>
      new Map(
        mailboxes.flatMap((m) =>
          m.counts !== null && m.counts.unread > 0
            ? [[m.id as string, m.counts.unread] as const]
            : [],
        ),
      ),
    [mailboxes],
  );
  switch (source.read.status) {
    case "loading":
      return <Loading variant="rows" count={4} />;
    case "error":
      return <Text tone="destructive">{source.read.error.message}</Text>;
    case "ready":
      break;
  }
  return (
    <TagPickerPanel
      tags={source.read.data.tags}
      writes={source.writes}
      abilities={source.read.data.abilities}
      noun="label"
      search={false}
      indicator="none"
      autoFocus={false}
      pickCreated={false}
      counts={unread}
      countsOf="own"
      marks="flat"
      fadeEmpty={false}
      selected={selected}
      rowMenuExtra={(tag) => (
        <DropdownMenuItem
          onClick={() =>
            viewModel.actions.duplicateView(labelViewId(tag.id as MailboxId))
          }
        >
          <Icon icon={copyIcon} className="size-4" />
          Duplicate view
        </DropdownMenuItem>
      )}
      onPick={(id) => {
        if (id !== null) viewModel.setActiveView(labelViewId(id as MailboxId));
      }}
    />
  );
}
