# ControlPanel form surface — config fields as a label | control form

Task: task-1795713468-nk7toj (under task-1795706452-6la07e). Spec: prototype
`proto-1790933711-zbyx` "Config field gallery" (approved by the user).

## Context

Config fields drawn through `config_v2` render badly in panes (Deploy → Feeds
editor, Settings → Config, the `config/field-gallery` exhibit):

- a field's description is a band ABOVE its row (`Banded` →
  `ControlPanel.Section description`), not under its label;
- value controls sit at the far right at one fixed width (`--cp-value-col`),
  while switches, swatches and avatars sit elsewhere — no shared control x;
- nesting (object / variant / list item) is an indented `cp-group` region whose
  indent reads as noise; a list item's Remove is a danger row inside it.

The prototype fixes this with a different row construction: a label column
(label semibold, muted description under it) beside a control column whose
start x is the same at every nesting depth (≈40% of the top-level row), wide
controls under the label, and nesting shown by ONE cue — a tinted rounded box.

## Decision: a fourth surface, `ControlPanelForm`

The existing `ControlPanelPane` is also the body of Automations sections,
sidequest-autopilot's Run until / Triage sections, etc. — hand-written menus of
rows, switches and a few `Setting`s, where the menu-row construction is right.
A config record rendered as fields is a different THING: a form. The control
panel's rule is "three surfaces, picked by what the thing IS"; this adds a
fourth for the fourth thing, rather than a knob on the pane.

| surface | it is | host |
|---|---|---|
| `ControlPanelForm` | a record's fields, as a form (config, a feed item, a source's settings) | `{ inline, 3, label, label, layout: "form" }` |

`ControlPanelHost` gains:

- `layout: "rows" | "form"` — the row construction members draw. Every existing
  surface publishes `"rows"`, so nothing they render changes.
- `descriptions: "label"` — a third answer: visible, under the field's label.

Members under `layout: "form"`:

- **`Setting`** — `cp-form-row`: label cell (label + `description` under it,
  first line centred on the control's first line) | control cell (starts at the
  form's control x; `fit="field"` fills the column, `fit="inline"` sizes to
  itself — switches included, left-aligned) | trailing cell (status + actions).
  `Setting` gains an optional `description` prop in every layout (under the
  label; in `rows` it is the existing `DescribedLabelCell`).
- **`Block`** — the same label cell, then its control full width below.
- **`Group`** — the label cell (and trailing cell), then ONE tinted box
  (`cp-form-box`) holding its members. `Group item` (new prop): the group is
  one item of a list — its header (drag handle, label, hover-revealed actions)
  is drawn INSIDE its own box. In `rows` layout `item` changes nothing.
- At depth 0 every member is its own band (`cp-band`), so the hairline falls
  only between top-level fields; inside a box rows are separated by space.

Geometry (`app.css`):

- `cp-form-row`'s label track is
  `max(8rem, calc(40cqi - var(--cp-form-nest) - gap))`, written in the row's
  template (a custom property declared on the form would freeze the nest at
  0). `cqi` is the FORM's width at any depth (`cp-pane`'s inline-size
  container), so a row inside N boxes subtracts what the boxes inset
  (`--cp-form-nest`, N × box inset, set by nested `.cp-form-box` selectors)
  and its control starts at the same x as a top-level one.
- Below a 35rem form the row is one column (label over control).
- A box paints `--muted`-family tint; a box inside a box paints the form's
  canvas (`--cp-form-canvas`, captured at the form root from `--chrome-mask`).
  Each box publishes `--chrome-mask` / `--hover-fill` for what it paints.

## config_v2 (`FieldShapeView`) under the form host

- No `Banded` sections: descriptions go to the member's `description`.
- `toggle` → `Setting` + `Switch` (control column, left).
- `choice one` ≤ 6 → `Setting` + `SegmentedControl variant="track"` (new
  variant: segments on a tinted track, the selected one raised); more →
  the existing `ControlPanel.Field` picker.
- `choice many` → `Setting` + a wrapping `Cluster` of pill `ToggleChip`s.
- `list` of records → `Group` header + one `Group item` box per item (grip,
  live title = first text value, hover ✕) + a ghost "+ Add …" button.
- Popover / pane / card hosts keep today's mapping.

## Per-type controls (renderers, in a form only)

Each renderer reads `useControlPanelLayout()` and keeps its previous control in
every other host (popover, pane, card), so no menu row changes.

- int / float: narrow right-aligned number input + a "min – max" caption.
- json: editable mono textarea (commits valid JSON on blur, shows the parse
  error otherwise).
- color: the swatch (picker trigger) plus a hex input.
- string-list: one input per line (Enter adds a line under, Backspace on an
  empty line removes it, hover ✕), ghost "+ Add".
- dynamic-flags / tags: pill chips in the control column.
- icon: unchanged (icon button opening the glyph grid). avatar: unchanged.
- directory-path / media: unchanged controls (already an input + browse
  button / a dropzone), now aligned by the row.

## Consumers switched to `ControlPanelForm`

`FieldsForm` (Deploy feed item editor, Events forms), config_v2 settings
`config-detail.tsx`, Events source `settings-section.tsx`, and the
`config/field-gallery` exhibit. Nothing else: Automations, autopilot,
data-view settings, page chrome keep their surfaces → unchanged rendering.

## Verification

- `./equin build`; `exhibit-shot` of `config/field-gallery` and
  `compare-diff.ts` against the prototype.
- `register_before_after`: Deploy → Feeds Discord section, Settings → Config
  (a nested object and a list), the gallery exhibit, Automations (expected
  identical).
- `./equin test` for control-panel and config_v2/fields suites; `./equin check`.
- Opus review agent over `git diff $(git merge-base HEAD main)`.
