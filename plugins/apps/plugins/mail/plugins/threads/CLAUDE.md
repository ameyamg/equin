# threads

Mail's index pane (`/mail`): one DataView over the live `mail.threads`
window (`cache/core`), its views listed by the mail sidebar. Matches
prototype `proto-1795656296-rtsmk5`. Triage (step 6) is here; the sidebar's
Compose and account foot and the reader's reply box come from `mail/compose`.

## Views

- **Built-ins** (`core/internal/views.ts`, `MAIL_BUILT_IN_VIEWS`): Inbox,
  Sent, Drafts, Done, Spam, Trash — DataView **locked** views
  (`viewEdits.locked`): copy-only, an edit is a working copy saved as a NEW
  view. Their place is the config's: `config/apps/mail/threads/mail.threads.jsonc`
  holds a placeholder row per built-in, so they drag among the user's views.
- **The Inbox's filter is the cache's `mailInboxView`** (one rule, nothing
  ANDed in, default order and limit, no search): its first page is the tuple
  the boot preload answers. Keep it so.
- Every view but Spam and Trash leaves spam and trash out (`lacks-nested`):
  the provider's query is over every message. That rule is **locked**
  (`FilterRule.locked`): a base rule of the view, carried into every view
  saved from it, shown dimmed in the Filter panel, never a chip, never
  removable.
- The Filter offers only what the provider runs: `mail.threads` declares
  `filterOps: MAIL_QUERY_OPS`.
- **Labels**: one locked view per user label (`labelView`), a parent's
  including its sub-labels (`mailboxViewIds`), coloured by its nearest
  coloured ancestor; drawn as the sidebar's tree, not in the views list.
- **The user's own views** are config rows; "With attachments" ships premade.
- The action name "Done" is `DONE_LABEL`, spelled once.

## The surface (`web/components`)

- `mail-screen.tsx` — the DataView: `fixedOrder` source (date desc only, no
  Sort), list rows by `renderRow` (`thread-row.tsx`), `errorState` renders a
  `not-connected` refusal through the provider's connect surface
  (`MailProviderUi.Connect`), the empty Inbox is "All done".
- `mail-sidebar.tsx` — the `aside`: the active view's name, the views list
  (`DataViewViewList`, counts from the mailbox counts, Spam / Trash under
  More), "+ New view" (the active view's filter as a view of one's own), the
  label tree — the shared tag picker's tree (`TagPickerPanel`, see Labels).
- `mail-toolbar.tsx` — the toolbar arrangement: the search box (the
  provider's own search, the `query` column) with Filter and Display inside,
  and `DataViewFilterChips` while the view is one's own or edited.
- The day groups hide their counts through the Mail theme (`groupCount`).

## Triage (`web/internal/actions.tsx`)

- **`useMailActions().run(rows, op)`**: `writeRows(mailThreads, …)` — the op
  drawn at once on every read of `mail.threads` (the row leaves each view it
  no longer matches, changes in the others; `network/live`'s row overlay,
  with the cache's own `applyMailOp`) — the send to
  `POST /api/mail/threads/apply`, and a toast with Undo (the inverse ops the
  server answers, each thread as the cache held it). A failed send raises an
  error toast; nothing reverts silently. Actions take thread ids — the
  selection bar never reads the selected threads' rows.
- **Where**: each row's hover cluster (`ThreadItemActions` "triage": Label,
  Delete — not in the trash — and the primary action), the reader's bar
  (`panes.tsx`: the same plus Mark as read / unread; Done, Delete and the
  rest close the reader), and the selection bar (DataView checkbox selection
  in the list view, `bar: "bottom"`: Done, Label, Mark as read, Delete or
  Restore).
- **Opening marks read**: the thread pane marks its thread read once per
  open (no toast).
- **Keys**: j / k (the list's `stepKeys`: next / previous thread, opened and
  so marked read), e (the open thread's primary action), # (delete it; with
  or without Shift, for layouts where it is unshifted), / (focus the search
  box; Shift+/ too). In the Unread view an opened thread leaves the view as
  it is marked read, so j then starts from the top. No s: Starred is out of Mail. c (compose), r / a / f (reply, reply all,
  forward) are compose's (`mail/compose`).
- **Labels** are edited with the shared tag picker (`tag-tree/picker`), fed by
  `useMailLabelSource` (`web/internal/label-source.ts`): the user labels as
  `TagPickerRow`s (ranked by name — Gmail keeps no label order), the writes
  the label endpoints (create a `/` path, `PATCH /api/mail/labels/:id`
  rename / move / colour, delete — its sub-labels move up), and the
  provider's abilities: no manual order (a drag only nests), no icons, no
  shading, the provider's palette (`mail.account-status`'s `mailboxColors`).
  - The row, reader and selection bar's Label is `LabelPicker`: a
    `TagPickerPopover` over that source, `closeOnPick={false}`, each pick
    toggling one label on the threads (a selection tracks what it added, so
    a second pick takes it off again).
  - The sidebar's label tree is `TagPickerPanel` over it: no search, the open
    label view highlighted, own unread counts, ＋ / ⋯ / double-click rename /
    drag-to-nest, "New label" at the foot, Duplicate view in the ⋯ menu.
  - The `mailboxes` field's options are the labels as a tag forest
    (`tagFieldOptions`), the roles and categories `fixed` and `quiet`; its
    `onEditValues` makes the standard tags editor (the tag picker) a labels
    op. No grouping by labels: a multi-value grouping does not exist in
    data-view, and the provider's fixed order allows only the date grouping.

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: Mail's index pane (/mail): one DataView over the live mail.threads window — rows are threads, newest first, grouped by received day, searched by the provider's own search (the query column) — whose views are the built-ins (Inbox, Sent, Drafts, Done, Spam, Trash: locked, copy-only, code-defined, the Inbox filter in one place for the boot preload), one per user label (a parent's includes its sub-labels) and the user's own saved views. The mail sidebar is the DataView's aside: the view name, one drag-reorderable list of views (Spam and Trash folded under More), + New view, and the label tree. The toolbar is the search box with Filter and Display inside it, and the view's rules as chips while it is the user's own or edited. A refused window renders by its code: not connected draws the provider's connect surface. Triage: each row's hover actions (Label, Delete, Done — Restore in the trash, Not spam in spam, Move to Inbox elsewhere), checkbox selection with a bottom selection bar (Done, Label, Mark as read, Delete / Restore), the reader's bar (the same, plus Mark as unread), a thread marked read when opened, undo toasts, and the keys j / k (next / previous thread), e (the primary action), # (delete) and / (search) — every op drawn at once on every view through the live row overlay and written through the cache. Labels: the shared tag picker over the account's labels (useMailLabelSource — create, nest, rename, recolour in the provider's palette, delete; no manual order or icons, which the provider has not) as the row, reader and selection bar's Label popover and as the sidebar's label tree, and the mailboxes field's options a tag forest (roles fixed) so the standard tags editor edits a thread's labels.
- Web:
  - Slots:
    - `mail.actions`
    - `mail-thread.actions`
    - `thread-actions`
  - Slot contributors:
    - `mail.actions` ← `primitives.pane`
    - `mail-thread.actions` ← `primitives.pane`
    - `thread-actions` ← `apps.mail.threads`
  - Contributes:
    - `Pane.Register` "mail-thread"
    - `Pane.Register` "mail-threads"
    - `thread-actions` "triage" → `RowTriage`
  - Uses: 54 symbols — full list in [REFERENCE.md](./REFERENCE.md)
    - `primitives/data-view` ×9
    - `network/live/live-state` ×5
    - `primitives/css/ui-kit` ×5
    - `primitives/pane` ×4
    - `apps/mail/compose` ×2
    - `infra/endpoints` ×2
    - `network/live` ×2
    - `primitives/css/spacing` ×2
    - `tag-tree/picker` ×2
    - `apps/mail/provider.MailProviderConnect`
    - `apps/mail/reader.ThreadReader`
    - `network/live/optimistic-mutation.writeRows`
    - `primitives/collapsible.useCollapsible`
    - `primitives/css/center.Center`
    - `primitives/css/cluster.Cluster`
    - `primitives/css/fill.Fill`
    - `primitives/css/line.Line`
    - `primitives/css/rigid.rigidClass`
    - `primitives/css/row.Row`
    - `primitives/css/scroll.Scroll`
    - `primitives/css/status-dot.StatusDot`
    - `primitives/css/text.Text`
    - `primitives/dom/scroll-reveal.focusElement`
    - `primitives/icon-button.IconButton`
    - `primitives/loading.Loading`
    - `primitives/multi-select.useMultiSelect`
    - `primitives/overlay/imperative-dialog/confirm.useConfirmDialog`
    - `primitives/shortcuts.useSurfaceShortcuts`
    - `shell/notifications.useToast`
    - `ui/icons.Icon`
- Core:
  - Uses:
    - `apps/mail/cache.mailboxViewIds`
    - `apps/mail/cache.mailInboxView`
    - `apps/mail/provider.Mailbox`
    - `apps/mail/provider.MailboxId`
    - `apps/mail/provider.MailboxRole`
    - `apps/mail/provider.roleMailboxId`
    - `ui/icons.IconRef`
    - `ui/icons.symbol`
  - Exports (types):
    - `MailBuiltInView`
    - `MailViewCount`
  - Exports (values):
    - `DONE_LABEL`
    - `labelColor`
    - `labelOfView`
    - `labelView`
    - `labelViewId`
    - `MAIL_BUILT_IN_VIEWS`
    - `MAIL_INBOX_MAILBOXES`
    - `MAIL_INBOX_VIEW`
    - `MAIL_TUCKED_VIEWS`
- Cross-plugin:
  - Uses tokens: 30 vars — full list in [REFERENCE.md](./REFERENCE.md)
    - `ui/tokens/density` ×10
    - `ui/tokens/color-palette` ×8
    - `ui/tokens/type-scale` ×7
    - `ui/tokens/shape` ×3
    - `ui/tokens/sidebar-metrics --sidebar-row-pad-x`
    - `ui/tokens/sidebar-palette --sidebar-foreground`

<!-- AUTOGENERATED:END -->
