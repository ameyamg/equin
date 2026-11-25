import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { MarkdownEnhancerSlot } from "@plugins/primitives/plugins/markdown/web";
import { InlineTextWalkerSlot } from "@plugins/primitives/plugins/inline-text/web";
import { FileLinksEnhancer } from "./internal/file-links-enhancer";
import { FileLinksInlineWalker } from "./internal/file-links-inline-walker";
import { CodeEnhancer } from "./internal/code-enhancer";
import { ImgEnhancer } from "./internal/img-enhancer";
import { MarkdownExtensions } from "./slots";

export { MarkdownExtensions } from "./slots";
export type { WebLinkProps } from "./slots";

export default {
  description:
    "Conversation-scoped markdown enhancers: file-links, web links (drawn by the MarkdownExtensions.WebLink contribution — the Browser's, opening its web-page side pane, where the Browser ships — else a plain link opening the site in a new browser tab), inline code enhancements, and image proxying.",
  slots: MarkdownExtensions,
  contributions: [
    MarkdownEnhancerSlot({
      id: "file-links",
      stage: 10,
      Component: FileLinksEnhancer,
    }),
    // Plain-text (non-markdown) counterpart of the file-links markdown
    // enhancer, registered after active-data (stage 10) so chips stay opaque
    // and remaining file paths still linkify. Same useFileTarget resolution.
    InlineTextWalkerSlot({
      id: "file-links",
      stage: 10,
      Component: FileLinksInlineWalker,
    }),
    MarkdownEnhancerSlot({
      id: "code-inline",
      stage: 20,
      Component: CodeEnhancer,
    }),
    MarkdownEnhancerSlot({
      id: "img-proxy",
      stage: 30,
      Component: ImgEnhancer,
    }),
  ],
} satisfies PluginDefinition;
