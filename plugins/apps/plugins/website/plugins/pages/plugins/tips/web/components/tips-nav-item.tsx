import { useOpenPane } from "@plugins/primitives/plugins/pane/web";
import { WebsiteLearnLink } from "@plugins/apps/plugins/website/plugins/shell/web";
import { tipsPane } from "../panes";

/** "Tips" in the shared site header's Learn menu. Opens the tips page. */
export function TipsNavItem() {
  const openPane = useOpenPane();
  return (
    <WebsiteLearnLink
      label="Tips"
      gloss="Small things equin can do"
      {...openPane.link(tipsPane, {}, { mode: "root" })}
    />
  );
}
