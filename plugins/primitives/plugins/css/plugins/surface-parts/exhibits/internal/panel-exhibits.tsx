import {
  isolatedExhibit,
  type Exhibit,
} from "@plugins/plugin-meta/plugins/exhibits/core";
import { Badge } from "@plugins/primitives/plugins/css/plugins/badge/web";
import {
  Inset,
  Stack,
} from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Input } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import { transient } from "@plugins/primitives/plugins/kept-state/core";
import type { ReactNode } from "react";
import { Panel } from "../../web";

const labelIcon = symbol("label");
const addIcon = symbol("add");

/** A measured text box: fills its cell, so its left edge is where text starts. */
function Fills({ id, children }: { id: string; children: ReactNode }) {
  return (
    <span data-geo={id} className="block w-full truncate">
      {children}
    </span>
  );
}

/**
 * A zero-size probe standing ON one of the region's lines: a grid item placed
 * there by the same placement classes the parts use, so its x is the line's as
 * the grid computes it.
 */
function LineProbe({
  id,
  line,
}: {
  id: string;
  line: "edge" | "fill" | "text";
}) {
  const place = { edge: "part-at-edge", fill: "part-at-fill", text: "" }[line];
  return <span data-geo={id} className={`block h-0 w-0 ${place}`} />;
}

/** A zero-size probe at the start of a plain (non-grid) box's content. */
function BoxProbe({ id }: { id: string }) {
  return <span data-geo={id} className="block h-0 w-0" />;
}

/** Rows do nothing in an exhibit. Module-level: one identity across renders. */
const NOOP = () => {};

const WIDTHS = [262, 360] as const;

/**
 * The two mechanisms the same parts can be laid out by (`lines.css`): `lines`
 * (a grid of named lines; the default) and `pad` (the region pads to `text`,
 * a part steps out by the region's own distance).
 */
type Mechanism = "lines" | "pad";

/**
 * The stage of a measured exhibit: the mechanism under test, and a zero-size
 * probe at the panel's left edge. Every assertion below is a distance from
 * that probe in px, so it holds the two mechanisms to the same numbers and
 * depends on neither's own placement.
 */
function Stage({
  mechanism,
  children,
}: {
  mechanism: Mechanism;
  children: ReactNode;
}) {
  return (
    <div data-part-mechanism={mechanism}>
      <BoxProbe id="origin" />
      {children}
    </div>
  );
}

/** Distances from the panel's edge, at the default density (`xs`, `--pad-row-x`). */
const FILL = 4;
const TEXT = 12;

/** `slot` starts `gap` px right of `after`. */
function at(slot: string, gap: number, after = "origin") {
  return { kind: "leftPack", after, slot, gap } as const;
}

// ── The rail's three traps, attempted with parts ──────────────────────
//
// rail/CLAUDE.md, "Three traps, one shape". Each is written here the way it
// was hit, and measured:
//
// 1. Nested followers each pay. Three Sections deep, a State and a Row are
//    still on `text` / `fill`: a Section adds no inset.
// 2. A bleed under a box that pads without publishing overhangs it. An
//    `Inset` holds a Rule and a Row: under `lines` they start at its content
//    edge. (Under `pad` this holds only for a padder that resets — see the
//    adversarial exhibit.)
// 3. A bleed inside a both-axis scroller buys sideways scroll. The body
//    scrolls on both axes; a Full, a Rule and a Row reach their lines and the
//    far edge and stop there (`noClip`, `pinnedRight`).
function trapsExhibit(mechanism: Mechanism, id: string): Exhibit {
  return isolatedExhibit({
    id,
    label: `The rail's three traps, attempted with parts (${mechanism})`,
    widths: WIDTHS,
    render: () => (
      <Stage mechanism={mechanism}>
        <Panel header={<Text variant="label">Three traps</Text>}>
          <Panel.Section label="1 · nested three deep">
            <Panel.Section label="Second">
              <Panel.Section label={<Fills id="t1-label">Third</Fills>}>
                <Panel.State>
                  <Fills id="t1-state">Still on the text line.</Fills>
                </Panel.State>
                <Panel.Row data-geo="t1-row" onSelect={NOOP}>
                  <Fills id="t1-row-text">A row, three sections deep</Fills>
                </Panel.Row>
              </Panel.Section>
            </Panel.Section>
          </Panel.Section>

          <Panel.Rule />
          <Panel.Section label="2 · parts under a padder that is no part">
            <Inset pad="md" className={mechanism === "pad" ? "part-reset" : ""}>
              <BoxProbe id="t2-padder" />
              <Panel.Rule data-geo="t2-rule" />
              <Panel.Row data-geo="t2-row" onSelect={NOOP}>
                Stays inside the padder
              </Panel.Row>
            </Inset>
          </Panel.Section>

          <Panel.Rule data-geo="t3-rule" />
          <Panel.Section label="3 · edge to edge in a both-axis scroller">
            <Panel.Full data-geo="t3-full">
              <Text variant="caption" tone="muted">
                A full-width block
              </Text>
            </Panel.Full>
            <Panel.Row data-geo="t3-row" onSelect={NOOP}>
              A row whose fill reaches the fill line
            </Panel.Row>
          </Panel.Section>
        </Panel>
      </Stage>
    ),
    geometry: {
      dims: { contentLen: "short", withMeta: false, state: "idle" },
      invariants: [
        // Trap 1: no inset accumulates with depth.
        at("t1-label", TEXT),
        at("t1-state", TEXT),
        at("t1-row-text", TEXT),
        at("t1-row", FILL),
        // Trap 2: nothing overhangs the box that pads it.
        at("t2-rule", 0, "t2-padder"),
        at("t2-row", 0, "t2-padder"),
        // Trap 3: edge to edge, and not one pixel further.
        at("t3-rule", 0),
        at("t3-full", 0),
        at("t3-row", FILL),
        { kind: "pinnedRight", slot: "t3-rule" },
        { kind: "pinnedRight", slot: "t3-full" },
        { kind: "noClip" },
      ],
    },
  });
}

// ── What sits between a region and a part ─────────────────────────────
//
// The cases a mechanism has to survive in real feature code, the same for
// both: a `display: contents` wrapper (slot-render puts one around every
// contribution), a plain wrapper box (a `Stack`, a component's own root), and
// a padder that is no part (`Inset`). Each holds loose text and a Row. The
// assertions are the SAME list for both mechanisms; the ones a mechanism does
// not meet are named in `KNOWN_MISSES` and left out of its gate, so the doc's
// comparison table is this file.
//
// Measured misses (2026-11-27, 262px):
// - lines / contents-text: at 0px, squeezed into the 4px first track (a
//   child of a `contents` wrapper is a grid item no `>` rule places).
// - lines / contents-row-text: at 4px (the row was auto-placed into the 8px
//   second track).
// - lines / stack-row: at 12px — outside the grid a row's fill stops at
//   `text`.
// - lines / stack-row-text: at 131px — outside the grid `grid-column: text`
//   resolves to an implicit second column and the label lands mid-row.
// - pad / inset-row: at 16px under a padder whose content starts at 24px —
//   it steps out of a box that did not reset the distances. `Inset` does not
//   reset today; with `part-reset` (traps-pad) it holds.
const KNOWN_MISSES: Record<Mechanism, readonly string[]> = {
  lines: ["contents-text", "contents-row-text", "stack-row", "stack-row-text"],
  pad: ["inset-row"],
};

function adversarialExhibit(mechanism: Mechanism, id: string): Exhibit {
  const misses = KNOWN_MISSES[mechanism];
  const all = [
    // A `display: contents` wrapper: its children are the region's.
    at("contents-text", TEXT),
    at("contents-row", FILL),
    at("contents-row-text", TEXT),
    // A plain wrapper box.
    at("stack-text", TEXT),
    at("stack-row", FILL),
    at("stack-row-text", TEXT),
    // A padder that is no part: nothing leaves it, and a row's text stays
    // level with the loose text beside it.
    at("inset-text", 0, "inset-origin"),
    at("inset-row", 0, "inset-origin"),
    at("inset-row-text", 0, "inset-origin"),
  ];
  return isolatedExhibit({
    id,
    label: `Wrappers between a region and its parts (${mechanism})`,
    widths: WIDTHS,
    render: () => (
      <Stage mechanism={mechanism}>
        <Panel header="A bare string in the header">
          A bare string in the body
          <Panel.Rule />
          <div className="contents">
            <Text variant="body">
              <Fills id="contents-text">Text in a contents wrapper</Fills>
            </Text>
            <Panel.Row data-geo="contents-row" onSelect={NOOP}>
              <Fills id="contents-row-text">Row in a contents wrapper</Fills>
            </Panel.Row>
          </div>
          <Panel.Rule />
          <Stack gap="none">
            <Text variant="body">
              <Fills id="stack-text">Text in a plain wrapper</Fills>
            </Text>
            <Panel.Row data-geo="stack-row" onSelect={NOOP}>
              <Fills id="stack-row-text">Row in a plain wrapper</Fills>
            </Panel.Row>
          </Stack>
          <Panel.Rule />
          <Inset pad="md">
            <BoxProbe id="inset-origin" />
            <Text variant="body">
              <Fills id="inset-text">Text in an Inset</Fills>
            </Text>
            <Panel.Row data-geo="inset-row" onSelect={NOOP}>
              <Fills id="inset-row-text">Row in an Inset</Fills>
            </Panel.Row>
          </Inset>
        </Panel>
      </Stage>
    ),
    geometry: {
      dims: { contentLen: "short", withMeta: false, state: "idle" },
      invariants: [
        ...all.filter((inv) => !misses.includes(inv.slot)),
        { kind: "noClip" },
      ],
    },
  });
}

export const surfacePartsExhibits: Exhibit[] = [
  trapsExhibit("lines", "surface-parts/traps"),
  trapsExhibit("pad", "surface-parts/traps-pad"),
  adversarialExhibit("lines", "surface-parts/wrappers"),
  adversarialExhibit("pad", "surface-parts/wrappers-pad"),

  // ── A searchable menu, the new way ──────────────────────────────────
  //
  // The family the original bug was in (a tag picker's search sat flush in two
  // hosts). No part here names an inset: the header title, the section labels,
  // the rows' text, a bare input and the empty state all start on `text`; the
  // rows' fills on `fill`; the rules and the chip strip on `edge`.
  isolatedExhibit({
    id: "surface-parts/menu",
    label: "Searchable menu from parts (lines: edge / fill / text)",
    widths: WIDTHS,
    render: () => (
      <Panel
        header={
          <Text variant="label">
            <Fills id="header-title">Tags</Fills>
          </Text>
        }
        search={
          <Input
            placeholder="Search or create…"
            keep={transient("an exhibit's search field")}
          />
        }
        footer={
          <Text variant="caption" tone="muted">
            <Fills id="footer-text">3 of 14 tags</Fills>
          </Text>
        }
      >
        <LineProbe id="line-edge" line="edge" />
        <LineProbe id="line-fill" line="fill" />
        <LineProbe id="line-text" line="text" />
        <Panel.Section label={<Fills id="section-label">Suggested</Fills>}>
          <Panel.Row
            data-geo="row-box"
            icon={<Icon icon={labelIcon} />}
            onSelect={NOOP}
          >
            Restaurants
          </Panel.Row>
          <Panel.Row icon={<Icon icon={labelIcon} />} onSelect={NOOP}>
            Coffee
          </Panel.Row>
        </Panel.Section>
        <Panel.Rule data-geo="rule" />
        <Panel.Strip data-geo="strip">
          <Badge>Open now</Badge>
          <Badge>Visited</Badge>
          <Badge>Wishlist</Badge>
          <Badge>With photos</Badge>
          <Badge>Rated 4+</Badge>
        </Panel.Strip>
        <Panel.Rule />
        <Panel.Section label="All tags">
          <Panel.State>
            <Fills id="state-text">No tag matches.</Fills>
          </Panel.State>
          <Panel.Row icon={<Icon icon={addIcon} />} onSelect={NOOP}>
            <Fills id="row-text">Create “bakery”</Fills>
          </Panel.Row>
        </Panel.Section>
        <Input
          data-geo="bare-input"
          placeholder="A bare input"
          keep={transient("an exhibit's stand-in field")}
        />
      </Panel>
    ),
    geometry: {
      dims: { contentLen: "short", withMeta: false, state: "idle" },
      invariants: [
        // Everything that is text starts on the one `text` line — in three
        // different regions (header, body, footer) and at two nesting depths.
        { kind: "leftPack", after: "line-text", slot: "header-title", gap: 0 },
        { kind: "leftPack", after: "line-text", slot: "footer-text", gap: 0 },
        { kind: "leftPack", after: "line-text", slot: "section-label", gap: 0 },
        { kind: "leftPack", after: "line-text", slot: "state-text", gap: 0 },
        { kind: "leftPack", after: "line-text", slot: "bare-input", gap: 0 },
        // A row's fill starts on `fill`; rules and the strip on `edge`, and
        // they reach the far edge.
        { kind: "leftPack", after: "line-fill", slot: "row-box", gap: 0 },
        { kind: "leftPack", after: "line-edge", slot: "rule", gap: 0 },
        { kind: "leftPack", after: "line-edge", slot: "strip", gap: 0 },
        { kind: "pinnedRight", slot: "rule" },
        { kind: "pinnedRight", slot: "strip" },
        { kind: "noClip" },
      ],
    },
  }),
];
