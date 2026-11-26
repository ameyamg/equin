import { useMemo, type ReactNode } from "react";
import {
  InlineTextWalkerContext,
  useInlineTextWalker,
  type InlineTextWalker,
} from "@plugins/primitives/plugins/inline-text/web";
import { splitPastedText } from "../../core";
import { PastedTextBlock } from "../components/pasted-text-block";

// A string cut into its runs: the text around each block stays a string (so
// later walkers still see it), each block is a component.
function splitString(text: string, key: string): ReactNode[] {
  if (!text.includes("<pasted_content>")) return [text];
  return splitPastedText(text).map((seg, i) =>
    seg.kind === "text" ? (
      seg.text
    ) : (
      <PastedTextBlock key={`${key}-${i}`} body={seg.body} />
    ),
  );
}

// Registered first, so handed the raw string. The block's body is a
// component, so later walkers leave the pasted text as it was pasted.
function splitBlocks(children: ReactNode): ReactNode {
  if (typeof children === "string") {
    const runs = splitString(children, "p");
    return runs.length === 1 ? runs[0] : runs;
  }
  return children;
}

/** Draws every `<pasted_content>` block in a sent message (or any plain-text surface) as the block. */
export function PastedTextWalker({ children }: { children: ReactNode }) {
  const walker = useMemo<InlineTextWalker>(
    () => ({ transform: splitBlocks }),
    [],
  );
  const value = useInlineTextWalker(walker);
  return (
    <InlineTextWalkerContext.Provider value={value}>
      {children}
    </InlineTextWalkerContext.Provider>
  );
}
