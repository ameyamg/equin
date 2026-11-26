export type { AttributeSource } from "./internal/decode";
export { decodeHtmlText, readHtmlAttr } from "./internal/decode";
export type {
  HtmlEdit,
  ScanHandlers,
  ScannedElement,
  StartTagEditor,
  StartTagRewriter,
} from "./internal/scan";
export {
  replaceElementText,
  rewriteStartTag,
  rewriteStartTags,
  scanHtml,
} from "./internal/scan";
