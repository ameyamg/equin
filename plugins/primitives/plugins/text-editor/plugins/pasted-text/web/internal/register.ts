import { registerNodeExtension } from "@plugins/primitives/plugins/text-editor/web";
import { PASTED_TEXT_RE } from "../../core";
import { pastedTextWebNode } from "./pasted-text-node";

// Side-effect: every text editor reads a `<pasted_content>` tag back as the
// block — after a reload, a draft restore, a copy between editors. The tag
// holds newlines, so the family is scanned over the whole text.
registerNodeExtension({
  id: "pasted-text",
  node: pastedTextWebNode,
  pattern: PASTED_TEXT_RE,
  spansLines: true,
});
