import { MillerColumns } from "@plugins/layouts/plugins/miller/web";
import { AppShellLayout } from "@plugins/primitives/plugins/app-shell/web";

/**
 * The Mail app's surface: the standard sidebar-less app shell around the
 * column renderer — the threads list (the index pane, whose DataView draws the
 * mail sidebar as its own `aside`: the sidebar's views ARE the list's views)
 * and, beside it, the thread being read.
 */
export function MailLayout() {
  return (
    <AppShellLayout>
      <MillerColumns />
    </AppShellLayout>
  );
}
