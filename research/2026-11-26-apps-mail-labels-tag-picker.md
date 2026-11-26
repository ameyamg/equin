# Mail labels through the shared tag picker and the standard tags field

Task: task-1795721629-kk5kdx (asked by the user, Mail rebuild supervisor task-1795696085-h3dxle).

## Context

Step 6 shipped an interim label UI in Mail: a "Label as" checkbox menu (row, reader,
selection bar) and New label / Rename / Delete dialogs in the sidebar. The user
cannot edit tags the way the rest of the app does. Replace it with the standard
pieces: the tag-tree picker over Gmail labels, the standard tags field, and the
picker's tree in the sidebar.

## The seam (tag-tree/picker)

The picker is wired to a declared tag tree (a DB table, server-minted ranks,
icons, any colour). Gmail labels are none of that. The seam is a **source**:
the rows, the writes and what the backend can do.

- `TagPickerRow`: the fields the picker reads (`NamedTagNode & { icon }`). The
  panel, the ⋯ menu and `TagMark` take it, so a non-tree backend does not
  invent `createdAt` / `updatedAt`. `TagRow` satisfies it.
- `TagPickerAbilities` (default `TAG_TREE_ABILITIES`, which a declared tree has):
  - `reorder`: manual sibling order. Off → no before/after drop zones. Drag
    only nests, and siblings stay in the backend's order.
  - `icons`: the Icon… item.
  - `shadeChildren`: the Shade children item.
  - `palette`: the colours the swatches offer.
  - `inheritColor`: the "Same as parent" swatch (a colour can be cleared).
- `TagPickerSource<Row> = { tags: ResourceResult<readonly Row[]>; writes; abilities }`.
  `TagPickerPopover` takes `tree` or `source`, and `closeOnPick` (default true).
  Multi-label carriers pass `false`.
- `writes` is optional on the panel. Without it the tree is read-only: no ＋,
  ⋯, rename, drag, create or footer.
- Panel options for a sidebar tree:
  - `search={false}`.
  - `indicator="none"`: a highlighted row, no ✓ or box.
  - `fadeEmpty={false}`: unread counts are not carrier counts.
  - `noun="label"`: "New label", "Add sub-label".
  - `rowMenuExtra` (exists): Duplicate view.

## The standard field (fields/tags)

- `FieldOption.fixed`: a value a row carries but that is set by other means (a
  mail role). An editor neither offers nor removes it.
- The tags cell editor draws the read-only `TagPickerPanel` (multi-toggle,
  commit on close) when the options form a forest (any `parent`). Otherwise it
  keeps the toggle-chip editor. The tags cell draws an option's `swatch` as a
  dot.
- `FieldOverride.onEditValues`: a list's multi-value write-back, the twin of
  `onEdit`.
- Grouping by labels is not offered. A multi-value grouping (one row in several
  sections) does not exist in data-view, and Mail's source is fixed-order
  (Gmail lists newest first), so only a date grouping can follow the order.

## Mail

- Provider contract:
  - `moveMailbox(id, parentId)`.
  - `setMailboxColor(id, color | null)`.
  - Capability `mailboxColors: { palette: MailboxColor[]; clearable }`.
  - `deleteMailbox` lifts sub-mailboxes to its parent (the picker's Delete
    semantics). Gmail would otherwise leave "A/B" as a root named "A/B".
  - Gmail:
    - Move = a rename of the full path, each descendant renamed too.
    - Colour = `labels.patch` with a pair from Gmail's palette.
    - Rename already cascades to children.
- Cache:
  - `PATCH /api/mail/labels/:id` takes `{ name } | { parentId } | { color }`.
  - The account status carries the provider's colours (palette, clearable) for
    the web.
- Web `useMailLabelSource()`:
  - User labels as `TagPickerRow`s, ranked by name.
  - Writes map onto the label endpoints. createPath = `createMailLabel` path.
  - Abilities: no reorder, no icons, no shading, Gmail's palette.
- Row, reader and selection bar: `TagPickerPopover` with `source`,
  `closeOnPick={false}`, `selected` = the thread's labels (none for a
  selection). A pick toggles the labels op.
- Sidebar: the label tree is `TagPickerPanel` (as above). A pick opens the
  label's view. The interim dialogs and `LabelMenu` are deleted.
- `mailboxes` field: options mark roles and categories `fixed` + `quiet`, and
  `onEditValues` turns the diff into a labels op.

## Verification

- Build, `./equin check`, tests: the picker panel, tags editor, mail cache and
  Gmail provider.
- On the real account:
  - create, nest and rename a parent;
  - recolour and clear a colour;
  - apply and remove a label from a row and from the reader.
- Opus review on the merge-base diff, then push.
