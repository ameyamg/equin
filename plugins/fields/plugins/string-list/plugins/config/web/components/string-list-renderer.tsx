import { defineFieldShape } from "@plugins/config_v2/plugins/fields/web";
import type {
  FieldShape,
  FieldShapeProps,
} from "@plugins/config_v2/plugins/fields/core";
import { transient } from "@plugins/primitives/plugins/kept-state/core";
import { stringListFieldType } from "@plugins/fields/plugins/string-list/core";
import {
  Button,
  Input,
} from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { useControlPanelLayout } from "@plugins/primitives/plugins/css/plugins/control-panel/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Fill } from "@plugins/primitives/plugins/css/plugins/fill/web";
import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import {
  hoverRevealGroup,
  hoverRevealTargetWithGroupFocus,
} from "@plugins/primitives/plugins/hover-reveal/web";
import { focusElement } from "@plugins/primitives/plugins/dom/plugins/scroll-reveal/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import { useEffect, useRef, useState } from "react";

const addIcon = symbol("add");
const closeIcon = symbol("close");

/**
 * A list of short strings (glob patterns, hosts, tags).
 *
 * In a FORM (`ControlPanelForm`) it is ONE control: one input per line, the
 * way the values are read — Enter opens a new line under the current one,
 * Backspace in an empty line removes it, a line's ✕ shows on hover, "Add"
 * appends. A list item there is a box with a header, which is the right
 * weight for a record and far too much for one string.
 *
 * Anywhere else (a popover, a pane of rows) it stays a `list` whose items are
 * `value` shapes — the panel's own rows, reorderable by their handles.
 */
const StringListRenderer = defineFieldShape({
  type: stringListFieldType,
  useShape: (props) => {
    const form = useControlPanelLayout() === "form";
    // Both arms' hooks run on every render (a hook's order is unconditional);
    // the host decides which shape is handed back.
    const rows = useRowsShape(props);
    if (!form) return rows;
    return {
      kind: "value",
      fit: "field",
      control: (
        <StringLines
          value={props.value}
          placeholder={props.field.meta.placeholder}
          onChange={props.onChange}
        />
      ),
    };
  },
});

/** The list-of-rows shape the panel draws outside a form. */
function useRowsShape({
  field,
  value,
  onChange,
}: FieldShapeProps<string[]>): FieldShape {
    // The stored value is a bare `string[]` whose entries can duplicate and
    // mutate freely, so a string cannot be its own id. We keep a parallel id
    // array, positionally aligned to `value`, and reconcile it whenever
    // `value`'s length changes underneath us (external edit, reset). A row then
    // keeps its identity across a typing session even as its text changes.
    const [ids, setIds] = useState<string[]>(() =>
      Array.from({ length: value.length }, () => crypto.randomUUID()),
    );
    if (ids.length !== value.length) {
      const next = ids.slice(0, value.length);
      while (next.length < value.length) next.push(crypto.randomUUID());
      setIds(next);
    }

    const indexOf = (id: string) => ids.indexOf(id);

    return {
      kind: "list",
      addLabel: "Add item",
      items: value.map((entry, index) => ({
        id: ids[index] ?? String(index),
        shape: {
          kind: "value",
          fit: "field",
          control: (
            <StringItemInput
              value={entry}
              placeholder={field.meta.placeholder}
              onCommit={(next) => {
                if (value[index] === next) return;
                onChange(value.map((v, i) => (i === index ? next : v)));
              }}
            />
          ),
        },
      })),
      onAdd: () => {
        setIds([...ids, crypto.randomUUID()]);
        onChange([...value, ""]);
      },
      onRemove: (id) => {
        const index = indexOf(id);
        if (index < 0) return;
        setIds(ids.filter((_, i) => i !== index));
        onChange(value.filter((_, i) => i !== index));
      },
      onMove: (activeId, overId) => {
        const from = indexOf(activeId);
        const to = indexOf(overId);
        if (from < 0 || to < 0 || from === to) return;
        const nextIds = [...ids];
        const [movedId] = nextIds.splice(from, 1);
        nextIds.splice(to, 0, movedId!);
        const nextValue = [...value];
        const [movedVal] = nextValue.splice(from, 1);
        nextValue.splice(to, 0, movedVal!);
        setIds(nextIds);
        onChange(nextValue);
      },
    };
}

function StringItemInput({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  onCommit: (next: string) => void;
}) {
  const [local, setLocal] = useState(value);
  const [focused, setFocused] = useState(false);
  if (!focused && local !== value) setLocal(value);
  return (
    <Input
      keep={transient(
        "committed on blur; a row's id is minted per mount, so there is no stable subject to keep it under",
      )}
      value={local}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        setFocused(false);
        onCommit(local);
      }}
    />
  );
}

/**
 * The lines, held HERE as the source of truth while edits are in flight: the
 * stored value comes back from the server a round trip later, and a line's id
 * must move with its text in the same render, never be realigned by length in
 * between (which handed one line's input to its neighbour). The stored value
 * replaces the lines only when it arrives differing from them — an edit from
 * outside, a reset.
 */
function StringLines({
  value,
  placeholder,
  onChange,
}: {
  value: readonly string[];
  placeholder?: string;
  onChange: (next: string[]) => void;
}) {
  const [state, setState] = useState(() => ({
    source: value,
    lines: [...value],
    ids: value.map(mintId),
  }));
  if (state.source !== value) {
    setState(
      sameLines(value, state.lines)
        ? { ...state, source: value }
        : {
            source: value,
            lines: [...value],
            ids:
              value.length === state.ids.length ? state.ids : value.map(mintId),
          },
    );
  }
  const { lines, ids } = state;
  const [focusId, setFocusId] = useState<string | null>(null);

  const commit = (nextLines: string[], nextIds: string[]) => {
    setState({ source: state.source, lines: nextLines, ids: nextIds });
    onChange(nextLines);
  };
  const insertAfter = (index: number, current: string) => {
    const id = mintId();
    const next = [...lines];
    next[index] = current;
    next.splice(index + 1, 0, "");
    commit(next, [...ids.slice(0, index + 1), id, ...ids.slice(index + 1)]);
    setFocusId(id);
  };
  const append = () => {
    const id = mintId();
    commit([...lines, ""], [...ids, id]);
    setFocusId(id);
  };
  const removeAt = (index: number) => {
    setFocusId(ids[index - 1] ?? ids[index + 1] ?? null);
    commit(
      lines.filter((_, i) => i !== index),
      ids.filter((_, i) => i !== index),
    );
  };

  return (
    <Stack gap="2xs">
      {lines.map((entry, index) => {
        const id = ids[index]!;
        return (
          <Stack
            key={id}
            direction="row"
            align="center"
            gap="2xs"
            className={hoverRevealGroup}
          >
            <Fill>
              <LineInput
                value={entry}
                label={`Line ${index + 1}`}
                placeholder={placeholder}
                focus={focusId === id}
                onFocused={() => setFocusId(null)}
                onCommit={(next) => {
                  if (next !== entry)
                    commit(
                      lines.map((v, i) => (i === index ? next : v)),
                      ids,
                    );
                }}
                onEnter={(current) => insertAfter(index, current)}
                onBackspaceEmpty={() => removeAt(index)}
              />
            </Fill>
            <IconButton
              icon={closeIcon}
              label={`Remove line ${index + 1}`}
              className={hoverRevealTargetWithGroupFocus}
              onClick={() => removeAt(index)}
            />
          </Stack>
        );
      })}
      <span>
        <Button variant="ghost" onClick={append}>
          <Icon icon={addIcon} />
          Add
        </Button>
      </span>
    </Stack>
  );
}

function LineInput({
  value,
  label,
  placeholder,
  focus,
  onFocused,
  onCommit,
  onEnter,
  onBackspaceEmpty,
}: {
  value: string;
  label: string;
  placeholder?: string;
  /** Take focus once (a line just opened by Enter, or the one above a removed one). */
  focus: boolean;
  onFocused: () => void;
  onCommit: (next: string) => void;
  onEnter: (current: string) => void;
  onBackspaceEmpty: () => void;
}) {
  const [local, setLocal] = useState(value);
  const [focused, setFocused] = useState(false);
  if (!focused && local !== value) setLocal(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focus) return;
    // The user's own Enter / Backspace moved here: keep the line in view.
    if (ref.current) focusElement(ref.current, { reveal: true });
    onFocused();
  }, [focus, onFocused]);
  return (
    <Input
      ref={ref}
      aria-label={label}
      keep={transient(
        "committed on blur; a line's id is minted per mount, so there is no stable subject to keep it under",
      )}
      value={local}
      placeholder={placeholder}
      spellCheck={false}
      className="font-mono"
      onFocus={() => setFocused(true)}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        setFocused(false);
        onCommit(local);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onEnter(local);
        } else if (e.key === "Backspace" && local === "") {
          e.preventDefault();
          onBackspaceEmpty();
        }
      }}
    />
  );
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function mintId(): string {
  return crypto.randomUUID();
}

export { StringListRenderer };
