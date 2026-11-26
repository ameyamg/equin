import { FullPane } from "@plugins/layouts/plugins/full-pane/web";
import { AppShellLayout } from "@plugins/primitives/plugins/app-shell/web";

/**
 * The Mail app's surface: the standard sidebar-less app shell around the
 * full-pane renderer. The threads plugin registers the app's index pane, whose
 * DataView draws the mail sidebar as its own `aside` — the sidebar's views ARE
 * the list's views, so they live in one surface.
 */
export function MailLayout() {
  return (
    <AppShellLayout>
      <FullPane />
    </AppShellLayout>
  );
}
