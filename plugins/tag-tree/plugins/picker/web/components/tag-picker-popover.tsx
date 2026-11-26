import { useMemo, useState, type ReactElement, type ReactNode } from "react";
import type { TagRow, TagTree } from "@plugins/tag-tree/plugins/engine/core";
import {
  useTagTree,
  useTagTreeActions,
} from "@plugins/tag-tree/plugins/engine/web";
import { InlinePopover } from "@plugins/primitives/plugins/overlay/plugins/popover/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { mapResource } from "@plugins/network/plugins/live/plugins/live-state/web";
import {
  TAG_TREE_ABILITIES,
  type TagPickerOptions,
  type TagPickerRow,
  type TagPickerSource,
} from "../internal/types";
import { TagPickerPanel } from "./tag-picker-panel";

interface PopoverChrome {
  /** The element that opens it (a `TagPathChip`, a `＋ Tag` button). */
  trigger: ReactElement;
  /**
   * Whether a pick closes it (default true: a carrier of one tag). A carrier
   * of many (a thread's labels) passes false, so several picks — each
   * toggling one — make one visit.
   */
  closeOnPick?: boolean;
}

/** Over a declared tag tree: its rows live, every edit through its endpoints, every ability. */
export type TagTreePopoverProps<Row extends TagRow = TagRow> =
  TagPickerOptions<Row> & PopoverChrome & { tree: TagTree<Row> };

/** Over a backend that is not a tag tree (Mail's labels): its rows, abilities and writes. */
export type TagSourcePopoverProps<Row extends TagPickerRow = TagPickerRow> =
  TagPickerOptions<Row> & PopoverChrome & { source: TagPickerSource<Row> };

export type TagPickerPopoverProps<Row extends TagRow = TagRow> =
  TagTreePopoverProps<Row> | TagSourcePopoverProps<Row>;

/**
 * The tag picker in a popover anchored on `trigger`, wired to its backend: a
 * declared `tree` (its rows live through `useTagTree`, every edit through its
 * endpoints, every ability), or a `source` (rows, abilities and writes of a
 * backend that is not a tag tree). A pick closes it unless `closeOnPick` is
 * false; each open starts fresh (empty query, every tag unfolded). The tree
 * is read only while it is open.
 */
export function TagPickerPopover<Row extends TagRow>(
  props: TagTreePopoverProps<Row>,
): ReactNode;
export function TagPickerPopover<Row extends TagPickerRow>(
  props: TagSourcePopoverProps<Row>,
): ReactNode;
export function TagPickerPopover(
  props: TagTreePopoverProps | TagSourcePopoverProps,
): ReactNode {
  const { trigger, onPick, closeOnPick = true } = props;
  const [open, setOpen] = useState(false);
  const pick = (id: string | null) => {
    if (closeOnPick) setOpen(false);
    onPick(id);
  };
  return (
    <InlinePopover
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      width="picker"
      // Menu parity: the panel declares no inset, the popover owns it.
      padding="xs"
      maxHeight="xl"
      resetOnClose
    >
      {"source" in props ? (
        <SourceBody
          {...pickerOptions(props)}
          source={props.source}
          onPick={pick}
        />
      ) : (
        <TreeBody {...pickerOptions(props)} tree={props.tree} onPick={pick} />
      )}
    </InlinePopover>
  );
}

/** The panel's own options, without the popover's props and the backend. */
function pickerOptions<P extends PopoverChrome>(
  props: P,
): Omit<P, "trigger" | "closeOnPick" | "tree" | "source"> {
  const {
    trigger: _trigger,
    closeOnPick: _closeOnPick,
    tree: _tree,
    source: _source,
    ...options
  } = props as P & { tree?: unknown; source?: unknown };
  return options;
}

function TreeBody<Row extends TagRow>({
  tree,
  ...options
}: TagPickerOptions<Row> & { tree: TagTree<Row> }) {
  const rows = useTagTree(tree);
  const writes = useTagTreeActions(tree);
  const read = useMemo(
    () =>
      mapResource(rows, (tags) => ({ tags, abilities: TAG_TREE_ABILITIES })),
    [rows],
  );
  return <SourceBody source={{ read, writes }} {...options} />;
}

function SourceBody<Row extends TagPickerRow>({
  source,
  ...options
}: TagPickerOptions<Row> & { source: TagPickerSource<Row> }) {
  const { read, writes } = source;
  switch (read.status) {
    case "loading":
      return <Loading variant="rows" />;
    case "error":
      return <Text tone="destructive">{read.error.message}</Text>;
    case "ready":
      return (
        <TagPickerPanel
          tags={read.data.tags}
          writes={writes}
          abilities={read.data.abilities}
          {...options}
        />
      );
  }
}
