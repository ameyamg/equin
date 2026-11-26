import { useState, type ReactNode } from "react";
import { ControlPanelPopover } from "@plugins/primitives/plugins/css/plugins/control-panel/web";
import { Cluster } from "@plugins/primitives/plugins/css/plugins/cluster/web";
import { Fill } from "@plugins/primitives/plugins/css/plugins/fill/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import {
  Button,
  ControlSizeProvider,
} from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";
import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import type { FieldDef, FilterNode } from "../../core";
import { deleteNode } from "../internal/filter-tree-ops";
import { unlockedFilter } from "../internal/locked-rules";
import { describeFilterRuleParts } from "../internal/summarize-filter";
import { useDataViewControls } from "./controls/controls-context";
import { FilterControlPanel } from "./filter/filter-control-panel";

const closeIcon = symbol("close");
const addIcon = symbol("add");

/**
 * The active view's filter as a row of chips, one per top-level rule — the
 * field's label in the text colour, the rest muted — each opening the Filter
 * panel and carrying × to drop its rule, then a "+ Filter" chip opening the
 * same panel, then the surface's `actions` at the row's end (Save / Discard
 * for a drafted view). A nested group reads as one chip ("2 rules").
 *
 * Reads the controls context, so it renders inside the DataView (its band, an
 * arrangement, the `aside`). When to show it is the surface's call — a view
 * whose filter defines it may keep it hidden until the view is edited.
 */
export function DataViewFilterChips(props: {
  /** Drawn at the row's end, after a spacer. */
  actions?: ReactNode;
  className?: string;
}): ReactNode {
  const { filter: controller, fields } = useDataViewControls();
  const { filter, setFilter, resolveOperatorSet } = controller;
  const [open, setOpen] = useState<string | null>(null);
  // A locked rule is the view's base, never a chip (`FilterRule.locked`).
  const nodes = unlockedFilter(filter)?.children ?? [];
  const panel = (key: string, trigger: React.ReactElement) => (
    <ControlPanelPopover
      key={key}
      open={open === key}
      onOpenChange={(next) => setOpen(next ? key : null)}
      align="start"
      trigger={trigger}
      label="Filter"
    >
      <FilterControlPanel />
    </ControlPanelPopover>
  );
  return (
    <ControlSizeProvider size="sm">
      <Cluster gap="xs" className={props.className}>
        {nodes.map((node) => {
          const words = nodeWords(node, fields, resolveOperatorSet);
          if (words === null) return null;
          return (
            <Line
              key={node.id}
              className="gap-xsm rounded-full bg-card pr-xs pl-smd whitespace-nowrap shadow-xs hover:bg-hover-fill"
              data-part="dv.filter-chip"
            >
              {panel(
                node.id,
                <Line as="button" className="gap-xsm">
                  <Text variant="caption" className="text-foreground">
                    {words.field}
                  </Text>
                  {words.rest !== "" ? (
                    <Text variant="caption" tone="muted">
                      {words.rest}
                    </Text>
                  ) : null}
                </Line>,
              )}
              <IconButton
                icon={closeIcon}
                label={`Remove ${words.field} ${words.rest}`}
                onClick={() => {
                  if (filter === null) return;
                  const next = deleteNode(filter, node.id);
                  setFilter(next.children.length === 0 ? null : next);
                }}
              />
            </Line>
          );
        })}
        {panel(
          "__add",
          <Button
            variant="outline"
            className="rounded-full text-muted-foreground"
            data-part="dv.filter-chip-add"
          >
            <Icon icon={addIcon} />
            Filter
          </Button>,
        )}
        {props.actions !== undefined ? (
          <>
            <Fill />
            {props.actions}
          </>
        ) : null}
      </Cluster>
    </ControlSizeProvider>
  );
}

/** A top-level node in words: a rule's own, a group as its rule count. */
function nodeWords(
  node: FilterNode,
  fields: FieldDef<unknown>[],
  resolveOperatorSet: Parameters<typeof describeFilterRuleParts>[2],
): { field: string; rest: string } | null {
  if (node.kind === "group") {
    const n = node.children.length;
    return n === 0 ? null : { field: `${n} rules`, rest: "" };
  }
  return describeFilterRuleParts(node, fields, resolveOperatorSet, {
    spell: true,
  });
}
