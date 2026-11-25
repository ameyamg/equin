import type { WebLinkProps } from "@plugins/conversations/plugins/conversation-view/plugins/markdown-extensions/web";
import { activationProps } from "@plugins/primitives/plugins/link-gesture/web";
import { useWebPageLink } from "./page-pane";

/**
 * A transcript's web link: a plain click opens the page in the web-page side
 * pane beside the conversation; ⌘/Ctrl-, Shift- and middle-click are left to
 * the browser, which opens the site in a new tab. A real `<a href>`, so
 * copying, hovering and keyboard-following behave as on any link.
 */
export function BrowserWebLink({ href, children, ...rest }: WebLinkProps) {
  const webPageLink = useWebPageLink();
  return (
    <a
      {...rest}
      className="text-primary-text underline"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      {...activationProps(webPageLink(href), { isolate: true })}
    >
      {children}
    </a>
  );
}
