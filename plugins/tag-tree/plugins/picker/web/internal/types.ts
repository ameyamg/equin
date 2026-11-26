import {
  TAG_PALETTE,
  type CreateTagBody,
  type MoveTagBody,
  type NamedTagNode,
  type UpdateTagBody,
} from "@plugins/tag-tree/plugins/engine/core";
import type { ResourceResult } from "@plugins/network/plugins/live/plugins/live-state/web";
import type { SavedSymbolName } from "@plugins/ui/plugins/icons/core";

/**
 * What the picker reads of a tag: its place in the tree, its name, colour and
 * icon. A declared tree's `TagRow` is one; a backend that is not a tag tree
 * (Mail's Gmail labels) builds these from its own records, `rank` giving the
 * sibling order it shows (a name order where it keeps none).
 */
export type TagPickerRow = NamedTagNode & {
  readonly icon: SavedSymbolName | null;
};

/**
 * What a picker's backend can do, so the picker offers only that — never an
 * affordance it would have to fake. A declared tag tree can do everything
 * ({@link TAG_TREE_ABILITIES}).
 */
export interface TagPickerAbilities {
  /**
   * Siblings keep a manual order: drag a row before or after another. Off
   * (Gmail labels sort by name): a drag only nests a row under another, and
   * siblings stay in the order the rows' `rank` gives.
   */
  reorder: boolean;
  /** A tag may wear an icon (the ⋯ menu's Icon…). */
  icons: boolean;
  /** A parent may shade its colourless children (the ⋯ menu's Shade children). */
  shadeChildren: boolean;
  /** The colours a tag may take, `#rrggbb` (the ⋯ menu's swatches). */
  palette: readonly string[];
  /**
   * A tag's colour may be cleared, so it wears its nearest ancestor's (the
   * "Same as parent" swatch under a parent, "No colour" on a root).
   */
  inheritColor: boolean;
}

/** A declared tag tree's abilities: every one, over the tag palette. */
export const TAG_TREE_ABILITIES: TagPickerAbilities = Object.freeze({
  reorder: true,
  icons: true,
  shadeChildren: true,
  palette: TAG_PALETTE,
  inheritColor: true,
});

/**
 * The writes a picker makes — a tree's `useTagTreeActions` (minus its pending
 * flag), or another backend's, which answers only what the panel reads.
 */
export interface TagPickerWrites {
  create(body: CreateTagBody): Promise<{ id: string }>;
  /** Make sure a path exists (each missing segment made under the last); answers its leaf. */
  createPath(segments: readonly string[]): Promise<{ id: string }>;
  update(id: string, body: UpdateTagBody): Promise<void>;
  move(id: string, dest: MoveTagBody): Promise<void>;
  remove(id: string): Promise<void>;
}

/** What a backend holds: its rows, and what it can do. */
export interface TagPickerBackend<Row extends TagPickerRow = TagPickerRow> {
  tags: readonly Row[];
  abilities: TagPickerAbilities;
}

/**
 * A picker's backend when it is not a declared tag tree: its rows and
 * abilities as read (both may hang on a read — Mail's palette is the account's),
 * and its writes.
 */
export interface TagPickerSource<Row extends TagPickerRow = TagPickerRow> {
  read: ResourceResult<TagPickerBackend<Row>>;
  writes: TagPickerWrites;
}

/** What a picker is asked: which tags are chosen, which may not be, and what a pick does. */
export interface TagPickerOptions<Row extends TagPickerRow = TagPickerRow> {
  /** Ids currently chosen; the ✓ marks them. Single-tag carriers pass [id] or []. */
  selected: readonly string[];
  /**
   * Tags that cannot be picked. An excluded tag with a pickable descendant
   * stays as a dimmed, unpickable row; otherwise it is hidden.
   */
  exclude?: (tag: Row) => boolean;
  /** Rolled-up carrier counts (`rolledUpTagCounts`); absent → no count column. */
  counts?: ReadonlyMap<string, number>;
  /**
   * Ids picked as NOT (a filter's exclusions): struck through in the
   * destructive tone. A click on one picks it like any other row.
   */
  negated?: readonly string[];
  /**
   * How a picked row is marked: a trailing ✓ (`check`, the default — a
   * carrier's tags), a leading box (`checkbox` — a filter: ✓ picked, −
   * negated, a dashed − when a tag under it is either), or the row's
   * highlight alone (`none` — a navigation tree: the open view's tag).
   */
  indicator?: "check" | "checkbox" | "none";
  /** Which tags open unfolded: every one (default), or the roots alone. */
  defaultExpanded?: "all" | "roots";
  /** Focus the search on mount (default true — a popover's). */
  autoFocus?: boolean;
  /**
   * Whether a path created from the search is picked (default true). A
   * filter passes false: a new tag carries nothing, so picking it would
   * filter everything out.
   */
  pickCreated?: boolean;
  /**
   * Whether the ⋯ menu offers Delete for a tag (default every tag). The
   * tree's server-side `refuseDelete` still decides; this only hides it.
   */
  canDelete?: (tag: Row) => boolean;
  /** Draw the search-or-create field (default true). A sidebar tree passes false. */
  search?: boolean;
  /**
   * Draw a tag whose `counts` entry is 0 (or absent) faint (default true:
   * `counts` are carrier counts — it holds nothing). False when the counts
   * are a badge (unread), where 0 means nothing new.
   */
  fadeEmpty?: boolean;
  /** What the tags are called in the panel's own words (default "tag"): "New label", "Add sub-label". */
  noun?: string;
  /** Show "No tag" at the top while `selected` is non-empty (single-tag carriers). */
  offerNone?: boolean;
  /** A row was picked (or "No tag" → null). A created path picks its leaf. */
  onPick(tagId: string | null): void;
}
