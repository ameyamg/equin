import { ActionMenu } from "@plugins/primitives/plugins/action-presentation/web";
import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import { rowOrStale, useLive } from "@plugins/network/plugins/live/web";
import { pageData, pagesTree } from "@plugins/page/plugins/editor/core";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { pageDetailPane } from "../panes";
import { PageDetail } from "../slots";
import { useTrashPage } from "../internal/use-trash-page";

const moreIcon = symbol("more-horiz");
const deleteIcon = symbol("delete");

/**
 * The page's "⋯" menu in the page-detail header (`pageDetailPane.Actions`):
 * every `PageDetail.MenuItem` contribution (favorites, …), then — after a
 * separator, as the one destructive entry — Move to trash, which this plugin
 * owns because it owns what trashing the open page does to the pane.
 *
 * An `ActionMenu`: once the header's bar runs out of room and moves it into
 * its own "⋯" panel, its entries are that panel's rows — never a "⋯" inside
 * the "⋯".
 */
export function PageMenuAction() {
  const { pageId } = pageDetailPane.useParams();
  return (
    <ActionMenu
      label="Page actions"
      icon={moreIcon}
      groups={[
        <PageDetail.MenuItem.Render key="items">
          {(item) => <item.component pageId={pageId} />}
        </PageDetail.MenuItem.Render>,
        <MoveToTrashAction key="trash" pageId={pageId} />,
      ]}
    />
  );
}

function MoveToTrashAction({ pageId }: { pageId: string }) {
  const trashPage = useTrashPage();
  // The title names the undo entry, so the action waits for the page's row
  // (the header already holds it — a cache hit). Disabled is the truthful
  // render both while it loads and once the page is gone (nothing left to trash).
  const row = rowOrStale(useLive(pagesTree, { id: pageId })) ?? null;
  return (
    <IconButton
      icon={deleteIcon}
      label="Move to trash"
      variant="destructive"
      disabled={row === null}
      onClick={() => {
        if (row === null) return;
        return trashPage({ id: pageId, title: pageData(row).title });
      }}
    />
  );
}
