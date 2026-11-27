import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import { useAppLinkProps } from "@plugins/apps-core/plugins/tabs/web";
import { debugApp } from "@plugins/apps/plugins/debug/plugins/shell/core";
import { navIcons } from "@plugins/ui/plugins/icons/core";
import { backupRoute } from "../../core";

/** The Backup row's trailing control: open Debug → Backup, the run history. */
export function OpenBackupAction() {
  const inAppLinkProps = useAppLinkProps();
  return (
    <IconButton
      icon={navIcons.expand}
      label="Open backups"
      {...inAppLinkProps(backupRoute.link(debugApp, {}))}
    />
  );
}
