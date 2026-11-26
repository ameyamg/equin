import {
  cn,
  WithTooltip,
} from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import {
  RowActions,
  rowActionsAnchor,
} from "@plugins/primitives/plugins/row-actions/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Icon } from "@plugins/ui/plugins/icons/web";
import type React from "react";
import { useId } from "react";

import { dragIndicatorIcon, type ControlPanelHandleProps } from "./handle";
import { useGroupDepth } from "./host";
import { useLabelMark } from "./label-mark";
import type { ControlPanelFit, ControlPanelMark } from "./setting-row";

/**
 * The FORM construction of one field (`layout: "form"`, `ControlPanelForm`):
 * a label column — the label over its description — beside a control column
 * that starts at one x at every depth, then a trailing cell for what the host
 * says about the field (a modified badge, a hover-revealed reset).
 *
 * `Setting`, `Block` and `Group`'s header are this one row with different
 * contents, exactly as they share `SettingRow` in the `rows` layout.
 */
export function FormRow({
  label,
  hint,
  description,
  control,
  fit,
  wide,
  status,
  actions,
  mark,
  note,
  disabled,
  className,
}: {
  label: React.ReactNode;
  hint?: string;
  description?: React.ReactNode;
  /** The control. Omitted for a group's header, which has none. */
  control?: React.ReactNode;
  fit?: ControlPanelFit;
  /** The control goes UNDER the label, the row's whole width (a `Block`). */
  wide?: boolean;
  status?: React.ReactNode;
  actions?: React.ReactNode;
  mark?: ControlPanelMark;
  note?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const descriptionId = useId();
  const labelId = useId();
  const trailing = status != null || actions != null;
  const described = description != null || Boolean(hint);
  return (
    <div
      data-cp-mark={mark === "accent" ? "" : mark}
      data-cp-wide={wide || control == null ? "" : undefined}
      className={cn(
        "cp-form-row text-body",
        "[&_svg:not([class*='size-'])]:icon-auto",
        rowActionsAnchor,
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <FormLabelCell
        hint={hint}
        description={description}
        labelId={labelId}
        descriptionId={descriptionId}
      >
        {label}
      </FormLabelCell>
      {control != null ? (
        // The control cell is a GROUP named by the label and described by the
        // description, so whatever control is in it (an input, a segmented
        // control, a cluster of chips) is announced with the field's name —
        // a control here has no `<label>` of its own.
        <span
          data-cp-cell="value"
          data-cp-fit={fit}
          role="group"
          aria-labelledby={labelId}
          aria-describedby={described ? descriptionId : undefined}
        >
          {control}
        </span>
      ) : null}
      {trailing ? (
        <span data-cp-cell="trailing">
          {status != null ? (
            <span className="flex items-center gap-2xs text-caption text-muted-foreground">
              {status}
            </span>
          ) : null}
          {actions != null ? (
            <RowActions pin={null}>{actions}</RowActions>
          ) : null}
        </span>
      ) : null}
      {note != null ? (
        <Text as="div" variant="caption" tone="muted" className="col-span-full">
          {note}
        </Text>
      ) : null}
    </div>
  );
}

/**
 * The label column: the label (semibold, the field's name) with its
 * description visibly UNDER it — muted prose that wraps. The description is
 * the control cell's accessible description (`aria-describedby` on the cell,
 * which the label names) and hidden inside the label cell, so the name stays
 * the label alone — the split `hint` makes.
 * A `hint` (a host that keeps prose behind a hover) is still a tooltip.
 */
function FormLabelCell({
  hint,
  description,
  labelId,
  descriptionId,
  children,
}: {
  hint?: string;
  description?: React.ReactNode;
  labelId: string;
  descriptionId: string;
  children: React.ReactNode;
}) {
  const mark = useLabelMark();
  const name = (
    <span
      id={labelId}
      className="font-semibold text-strong-foreground wrap-break-word"
    >
      {children}
      {mark != null ? <> {mark}</> : null}
    </span>
  );
  return (
    <Stack as="span" gap="2xs" data-cp-cell="label" className="min-w-0">
      {hint && description == null ? (
        <WithTooltip content={hint}>{name}</WithTooltip>
      ) : (
        name
      )}
      {description != null || hint ? (
        <span
          aria-hidden
          id={descriptionId}
          className={cn(
            description != null
              ? "text-caption text-muted-foreground whitespace-normal wrap-break-word"
              : "sr-only",
          )}
        >
          {description ?? hint}
        </span>
      ) : null}
    </Stack>
  );
}

/**
 * A field at the form's top level is its own band, so the panel draws the
 * hairline between top-level fields and never inside a box. Below the top
 * level it is a bare member: rows in a box are separated by space.
 */
export function FormBand({ children }: { children: React.ReactNode }) {
  const depth = useGroupDepth();
  if (depth > 0) return children;
  return <div className="cp-band">{children}</div>;
}

/**
 * One nesting box (`cp-form-box`). A list item's box (`item`) draws its
 * header INSIDE it — the drag handle, the item's live title, and its actions
 * revealed on hover — so the box is the item, not a frame around a row.
 */
export function FormBox({
  item,
  children,
}: {
  item?: {
    label: React.ReactNode;
    actions?: React.ReactNode;
    handle?: boolean;
    handleProps?: ControlPanelHandleProps;
  };
  children: React.ReactNode;
}) {
  return (
    <div
      data-cp-item={item ? "" : undefined}
      className={cn(
        "cp-form-box",
        item && cn("group/cp-row", rowActionsAnchor),
      )}
    >
      {item ? (
        <Stack
          direction="row"
          align="center"
          gap="xs"
          className="control-min-md"
        >
          {item.handle ? (
            <span
              {...item.handleProps}
              // NOT `data-cp-handle`: that marker opens the PANEL's gutter
              // track (`cp-panel`'s scan), which would move every field of the
              // form the moment a list gained its first item.
              data-cp-form-handle=""
              // Always shown: in a form the grip is the item header's leading
              // mark, so the title never sits behind an empty hover slot.
              className={cn(
                "flex cursor-grab items-center justify-center text-faint-foreground hover:text-foreground",
                item.handleProps?.className,
              )}
            >
              <Icon icon={dragIndicatorIcon} />
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate font-semibold text-strong-foreground">
            {item.label}
          </span>
          {item.actions != null ? (
            <RowActions pin={null}>{item.actions}</RowActions>
          ) : null}
        </Stack>
      ) : null}
      {children}
    </div>
  );
}
