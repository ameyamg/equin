import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { MillerColumns } from "@plugins/layouts/plugins/miller/web";
import { AppShellLayout } from "@plugins/primitives/plugins/app-shell/web";
import {
  ComposeLayer,
  ComposeProvider,
} from "@plugins/apps/plugins/mail/plugins/compose/web";

/**
 * The Mail app's surface: the standard sidebar-less app shell around the
 * column renderer — the threads list (the index pane, whose DataView draws the
 * mail sidebar as its own `aside`: the sidebar's views ARE the list's views)
 * and, beside it, the thread being read — with the compose layer (compose
 * windows, the outbox) over all of it. The surface is the `mail` container
 * the sidebar sizes itself by (an icon rail below 800px, the prototype's).
 */
export function MailLayout() {
  return (
    <ComposeProvider>
      <Stack gap="none" className="@container/mail h-full min-h-0">
        <AppShellLayout>
          <MillerColumns />
          <ComposeLayer />
        </AppShellLayout>
      </Stack>
    </ComposeProvider>
  );
}
