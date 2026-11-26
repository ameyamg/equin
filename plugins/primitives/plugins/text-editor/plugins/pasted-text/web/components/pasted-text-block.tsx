import { useLayoutEffect, useRef, useState } from "react";
import { stopLexicalPropagation } from "lexical";
import { CopyButton } from "@plugins/primitives/plugins/copy-to-clipboard/web";
import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import {
  hoverRevealGroup,
  hoverRevealTargetWithGroupFocus,
} from "@plugins/primitives/plugins/hover-reveal/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Clip } from "@plugins/primitives/plugins/css/plugins/clip/web";
import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";
import { Scroll } from "@plugins/primitives/plugins/css/plugins/scroll/web";
import { Inset } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { growClass } from "@plugins/primitives/plugins/css/plugins/grow/web";
import { yieldClass } from "@plugins/primitives/plugins/css/plugins/yield/web";
import { rigidClass } from "@plugins/primitives/plugins/css/plugins/rigid/web";
import {
  cn,
  ControlSizeProvider,
  Textarea,
} from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { transient } from "@plugins/primitives/plugins/kept-state/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import { symbol, type IconRef } from "@plugins/ui/plugins/icons/core";
import { lineCount, pastedTextKind, type PastedTextKind } from "../../core";

const KIND: Record<PastedTextKind, { label: string; icon: IconRef }> = {
  log: { label: "Pasted log", icon: symbol("terminal") },
  code: { label: "Pasted code", icon: symbol("code") },
  json: { label: "Pasted JSON", icon: symbol("data-object") },
  text: { label: "Pasted text", icon: symbol("notes") },
};

const chevronIcon = symbol("chevron-right");
const deleteIcon = symbol("delete");
const expandIcon = symbol("unfold-more");

/** Folded: the first three lines, fading out. Open: the whole text, scrolling past a cap. */
const FOLDED =
  "max-h-[4.6lh] cursor-pointer [mask-image:linear-gradient(black_35%,transparent)]";
const OPEN = "max-h-96";

/** What the block can do to itself where it is being composed. */
export interface PastedTextEditing {
  onChange: (body: string) => void;
  onDelete: () => void;
  /** Put the body back as plain text where the block was. */
  onExpand: () => void;
}

/**
 * A pasted block: a header (`› <icon> Pasted log · N lines`) over the text,
 * folded to its first three lines. A click on the header or the folded text
 * unfolds it. Copy shows on hover; with `editing` the text is editable, and
 * Delete and Expand (back to plain text) join Copy.
 *
 * The same block in the composer and in a sent message, so what was pasted
 * looks the same before and after it is sent.
 */
export function PastedTextBlock({
  body,
  editing,
}: {
  body: string;
  editing?: PastedTextEditing;
}) {
  const [open, setOpen] = useState(false);
  const kind = KIND[pastedTextKind(body)];
  const lines = lineCount(body);
  return (
    <Clip
      className={cn(
        hoverRevealGroup,
        "block w-full rounded-md border border-border bg-muted/40",
      )}
      contentEditable={false}
    >
      <Inset l="sm" r="xs" y="2xs">
        <Line className="gap-xs">
          <Line
            as="button"
            type="button"
            className={cn(
              growClass(),
              yieldClass("x"),
              "gap-xs text-muted-foreground hover:text-foreground",
            )}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <Icon
              icon={chevronIcon}
              className={cn(
                rigidClass(),
                "size-3.5 transition-transform",
                open && "rotate-90",
              )}
            />
            <Icon
              icon={kind.icon}
              className={cn(rigidClass(), "size-3.5 text-primary-text")}
            />
            <Text variant="caption">{kind.label}</Text>
          </Line>
          <ControlSizeProvider size="xs">
            <Line className={hoverRevealTargetWithGroupFocus}>
              <CopyButton text={body} tooltip="Copy" />
              {editing && (
                <>
                  <IconButton
                    icon={deleteIcon}
                    label="Delete"
                    onClick={editing.onDelete}
                  />
                  <IconButton
                    icon={expandIcon}
                    label="Expand to plain text"
                    onClick={editing.onExpand}
                  />
                </>
              )}
            </Line>
          </ControlSizeProvider>
          <Text variant="caption" tone="muted" className={rigidClass()}>
            {lines === 1 ? "1 line" : `${lines} lines`}
          </Text>
        </Line>
      </Inset>
      <Inset x="sm" b="xs">
        <Scroll
          axis="y"
          keep={transient("a pasted block's own text: reopened at its top")}
          className={open ? OPEN : FOLDED}
          onClick={open ? undefined : () => setOpen(true)}
        >
          {editing ? (
            <BodyEditor body={body} onChange={editing.onChange} />
          ) : (
            <Text
              as="pre"
              variant="code"
              className="whitespace-pre-wrap break-words"
            >
              {body}
            </Text>
          )}
        </Scroll>
      </Inset>
    </Clip>
  );
}

/**
 * Lexical's handlers that a keystroke, paste or clipboard event inside the
 * textarea would otherwise reach: Enter would send the message, a paste would
 * land in the editor (or become another block), typing would move the editor's
 * own selection. Marked at the textarea, before the event bubbles to the
 * editor's root, so the textarea keeps every one.
 */
const OWN_EVENTS = [
  "keydown",
  "keyup",
  "keypress",
  "beforeinput",
  "input",
  "paste",
  "copy",
  "cut",
  "drop",
  "compositionstart",
  "compositionend",
] as const;

function BodyEditor({
  body,
  onChange,
}: {
  body: string;
  onChange: (body: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // The textarea's own copy of the text. The node's body arrives a Lexical
  // update later; a textarea controlled by it directly re-renders with the OLD
  // value first and loses its caret to the end on every keystroke. An outside
  // change (undo) still reaches it: a body it has not seen replaces its copy.
  const [text, setText] = useState(body);
  const [seen, setSeen] = useState(body);
  if (body !== seen) {
    setSeen(body);
    if (body !== text) setText(body);
  }
  useLayoutEffect(() => {
    const el = ref.current!;
    for (const type of OWN_EVENTS)
      el.addEventListener(type, stopLexicalPropagation);
    return () => {
      for (const type of OWN_EVENTS)
        el.removeEventListener(type, stopLexicalPropagation);
    };
  }, []);
  return (
    <Text as="div" variant="code">
      <Textarea
        ref={ref}
        bare
        fitContent
        // The node's body is what the draft serializes, and the draft is kept.
        keep={transient("the draft holding this block keeps its text")}
        value={text}
        spellCheck={false}
        aria-label="Pasted text"
        className="block w-full resize-none border-0 bg-transparent text-inherit outline-none [font:inherit] [white-space:pre]"
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value);
        }}
      />
    </Text>
  );
}
