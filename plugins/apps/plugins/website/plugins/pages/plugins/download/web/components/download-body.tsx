import { WebsiteChrome } from "@plugins/apps/plugins/website/plugins/shell/web";
import { downloadPane } from "../panes";
import { DownloadOpening } from "./download-opening";
import { DownloadInstall } from "./download-install";

/**
 * The download page's body: the heading, then the one install band inside
 * `WebsiteChrome`. Its own chunk (`websitePagePart`), fetched only where the
 * page is shown.
 */
export function DownloadBody() {
  return (
    // The page is the way in itself, and closes on its own two cards (Learn the
    // tricks, Try it in your browser first): no Try it band after them.
    <WebsiteChrome pane={downloadPane} pageEnd={false}>
      <DownloadOpening />
      <DownloadInstall />
    </WebsiteChrome>
  );
}
