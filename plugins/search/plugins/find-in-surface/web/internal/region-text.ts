import { generatesBox } from "@plugins/primitives/plugins/dom/plugins/box-presence/web";
import type { TextPart } from "@plugins/search/plugins/find-in-surface/core";

/** A region's text as the reader sees it, and the nodes it was read from. */
export interface RegionText {
  text: string;
  nodes: readonly Text[];
  parts: readonly TextPart[];
}

/** Elements whose text is never what the reader reads on screen. */
const UNREAD =
  "svg,script,style,template,input,textarea,select,[aria-hidden='true'],.sr-only";

/**
 * The text of `root` as it reads on screen.
 *
 * - Only text that is drawn: an element with no box (`display: none`, a
 *   closed toggle's body that is still mounted) contributes nothing, nor does
 *   text a screen reader alone hears.
 * - A line break where the reader sees one — between two boxes that are not
 *   inline (two blocks, two cells) and at a `<br>` — and nowhere else. A line
 *   break in the HTML source is a space, unless the element preserves white
 *   space (a code block), where it is the break it shows.
 *
 * Line breaks between boxes belong to no text node; each node's `at` is where
 * its text starts in `text`, so a match maps back to DOM positions exactly.
 */
export function regionText(root: HTMLElement): RegionText {
  const style = new Map<Element, CSSStyleDeclaration>();
  const styleOf = (el: Element): CSSStyleDeclaration => {
    let s = style.get(el);
    if (!s) {
      s = getComputedStyle(el);
      style.set(el, s);
    }
    return s;
  };
  const blockOf = (el: Element): Element => {
    for (let e: Element | null = el; e && e !== root; e = e.parentElement) {
      const display = styleOf(e).display;
      if (!display.startsWith("inline") && display !== "contents") return e;
    }
    return root;
  };
  const drawn = new Map<Element, boolean>();
  const isDrawn = (el: Element): boolean => {
    let d = drawn.get(el);
    if (d === undefined) {
      d = generatesBox(el) && el.closest(UNREAD) === null;
      drawn.set(el, d);
    }
    return d;
  };

  const nodes: Text[] = [];
  const parts: TextPart[] = [];
  let text = "";
  let lastBlock: Element | null = null;
  const lineBreak = () => {
    if (text !== "" && !text.endsWith("\n")) text += "\n";
  };

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof HTMLBRElement) {
      if (isDrawn(node.parentElement ?? root)) lineBreak();
      continue;
    }
    if (!(node instanceof Text) || node.data === "") continue;
    const parent = node.parentElement;
    if (!parent || !isDrawn(parent)) continue;
    const block = blockOf(parent);
    if (lastBlock !== null && block !== lastBlock) lineBreak();
    lastBlock = block;
    const preserves = /^(pre|break-spaces)/.test(styleOf(parent).whiteSpace);
    nodes.push(node);
    parts.push({ at: text.length, length: node.data.length });
    // Same length either way, so offsets into `text` are offsets into the node.
    text += preserves ? node.data : node.data.replace(/[\n\r\t\f]/g, " ");
  }
  return { text, nodes, parts };
}
