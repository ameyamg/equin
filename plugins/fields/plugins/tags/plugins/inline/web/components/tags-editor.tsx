import { useMemo, useRef, useState, type ReactNode } from "react";
import { InlinePopover } from "@plugins/primitives/plugins/overlay/plugins/popover/web";
import { Badge } from "@plugins/primitives/plugins/css/plugins/badge/web";
import { Clip } from "@plugins/primitives/plugins/css/plugins/clip/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import type { CellEditorProps } from "@plugins/primitives/plugins/data-view/web";
import {
  TagPickerPanel,
  tagRowsOfOptions,
} from "@plugins/tag-tree/plugins/picker/web";

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Compact inline tags editor: an open-by-default popover holding the shared
 * tag picker (`tag-tree/picker`'s `TagPickerPanel`, read-only) over the
 * field's options — a forest when they carry `parent` (a tag tree's
 * `tagFieldOptions`, a mail account's labels), a list of roots otherwise.
 * Search finds a tag by its path; a click toggles it. An option marked
 * `fixed` (set by other means — a mail role) is neither offered nor removed.
 * The accumulated set commits on dismiss via `onCommitValues` — or cancels if
 * unchanged (and on Esc).
 */
export function TagsEditor(props: CellEditorProps): ReactNode {
  // The row's values when the editor opened: what Esc returns to, fixed for its life.
  const [initial] = useState<readonly string[]>(() =>
    props.values ? [...props.values] : [],
  );
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState<string[]>(() => [...initial]);
  const closed = useRef(false);
  const options = props.field.options;
  // The options, plus each value the row holds that no option names (a tag
  // deleted since): listed as a root of its raw value, so it can be removed.
  const rows = useMemo(() => {
    const known = new Set((options ?? []).map((o) => o.value));
    return tagRowsOfOptions([
      ...(options ?? []),
      ...initial
        .filter((v) => !known.has(v))
        .map((v) => ({ value: v, label: v })),
    ]);
  }, [options, initial]);
  const fixed = useMemo(
    () => new Set((options ?? []).filter((o) => o.fixed).map((o) => o.value)),
    [options],
  );

  const labelFor = (v: string) =>
    options?.find((o) => o.value === v)?.label ?? v;

  function toggle(v: string) {
    setSelected((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
    );
  }
  function finish(commit: boolean) {
    if (closed.current) return;
    closed.current = true;
    setOpen(false);
    if (commit && !sameTags(selected, initial)) props.onCommitValues(selected);
    else props.onCancel();
  }

  const shown = selected.filter((v) => !fixed.has(v));
  return (
    <InlinePopover
      open={open}
      onOpenChange={(next) => {
        if (!next) finish(true);
        else setOpen(true);
      }}
      width="picker"
      padding="xs"
      maxHeight="xl"
      trigger={
        <Clip className="whitespace-nowrap">
          <Stack direction="row" gap="xs">
            {shown.length === 0 ? (
              <span className="italic text-muted-foreground/50">Empty</span>
            ) : (
              shown.map((t) => (
                <Badge key={t} variant="muted">
                  {labelFor(t)}
                </Badge>
              ))
            )}
          </Stack>
        </Clip>
      }
    >
      <div
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            finish(false);
          }
        }}
      >
        <TagPickerPanel
          tags={rows}
          selected={selected}
          exclude={(t) => fixed.has(t.id)}
          onPick={(id) => {
            if (id !== null) toggle(id);
          }}
        />
      </div>
    </InlinePopover>
  );
}
