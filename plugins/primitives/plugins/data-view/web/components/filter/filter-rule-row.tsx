import type { ReactNode } from "react";
import { ControlPanel } from "@plugins/primitives/plugins/css/plugins/control-panel/web";
import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import type { FilterConjunction, FilterRule } from "../../../core";
import { useFilterEditor } from "../../internal/use-filter-editor";
import { ConjunctionCell } from "./conjunction-cell";
import { FieldPicker } from "./field-picker";
import { OperatorPicker } from "./operator-picker";
import { isOperatorOffered } from "../../internal/rule-resolution";
import { symbol } from "@plugins/ui/plugins/icons/core";

const accountTreeIcon = symbol("account-tree");

/**
 * One rule, as one line of the builder's shared grid:
 * `[conjunction] [field ▾] [operator ▾] [value] [⤳ ✕]`. The value editor is the
 * resolved operator's `ValueInput`, rendered only when the operator takes one.
 *
 * The row is a `ControlPanel.RuleRow`, so the cells are TRACKS: the value cell no
 * longer needs a hand-rolled `min-w-0 flex-1` wrapper to absorb the slack, the
 * trailing controls no longer need `useHoverReveal` to stay out of the way (the
 * row-actions primitive inside the grid owns the reveal), and a value-less
 * operator leaves its track empty instead of the row re-flowing around it.
 *
 * "Turn into group" sits in `actions`, before the built-in remove — the advanced
 * path, beside the everyday one.
 */
export function FilterRuleRow(props: {
  rule: FilterRule;
  index: number;
  groupConjunction: FilterConjunction;
  onSetConjunction: (conjunction: FilterConjunction) => void;
  fixedConjunction: boolean;
}): ReactNode {
  const { rule } = props;
  const editor = useFilterEditor();
  const field = editor.fields.find((f) => f.id === rule.fieldId);
  const opSet = field
    ? editor.resolveOperatorSet(field.type ?? "text")
    : undefined;
  const operator = opSet?.operators.find((o) => o.id === rule.operatorId);
  const ValueInput = operator?.hasValue ? operator.ValueInput : undefined;

  return (
    <ControlPanel.RuleRow
      prefix={
        <ConjunctionCell
          index={props.index}
          conjunction={props.groupConjunction}
          onChange={props.onSetConjunction}
          fixed={props.fixedConjunction}
        />
      }
      field={
        <FieldPicker
          fields={editor.fields}
          value={rule.fieldId}
          onChange={(fieldId) => editor.changeRuleField(rule.id, fieldId)}
        />
      }
      operator={
        opSet ? (
          <OperatorPicker
            operators={opSet.operators.map((o) =>
              // One the field's source cannot run stays resolvable (its
              // label), never offered.
              isOperatorOffered(o, field!) ? o : { ...o, hidden: true },
            )}
            value={rule.operatorId}
            onChange={(operatorId) =>
              editor.changeRuleOperator(rule.id, operatorId)
            }
          />
        ) : (
          <Text as="span" variant="caption" tone="muted">
            (unknown field)
          </Text>
        )
      }
      value={
        ValueInput && field ? (
          <ValueInput
            value={rule.value}
            // A locked rule's value is a viewer: it opens to be read
            // ("2 selected" → which two), never written.
            {...(rule.locked === true
              ? {}
              : {
                  onChange: (value: unknown) =>
                    editor.setRuleValue(rule.id, value),
                })}
            field={field}
          />
        ) : null
      }
      {...(rule.locked === true
        ? // The view's base rule: shown, never changed (`FilterRule.locked`).
          { locked: { label: "Part of this view" } }
        : {
            actions: (
              <IconButton
                icon={accountTreeIcon}
                label="Turn into group"
                onClick={() => editor.wrapRuleInGroup(rule.id)}
              />
            ),
            onRemove: () => editor.deleteNode(rule.id),
            removeLabel: "Remove filter",
          })}
    />
  );
}
