import { useCopyToClipboard } from "@plugins/primitives/plugins/copy-to-clipboard/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import type { RowAction } from "../slots";

const checkIcon = symbol("check");
const contentCopyIcon = symbol("content-copy");

/**
 * A copy action for a row: `null` text means the row has nothing to copy (the
 * action is absent). The glyph turns into a check once copied.
 */
export function useCopyAction(
  text: string | null,
  label: string,
): RowAction | null {
  const { copy, copied } = useCopyToClipboard(text ?? "");
  if (text === null) return null;
  return {
    kind: "button",
    icon: copied ? checkIcon : contentCopyIcon,
    label,
    onClick: copy,
  };
}
