import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Apps } from "@plugins/apps-core/web";
import { ThemeEngine } from "@plugins/ui/plugins/theme-engine/web";
import { mailApp } from "../core";
import { MailLayout } from "./components/mail-layout";
import { mailTheme } from "./internal/theme";

export default {
  description:
    "The Mail app's rail entry and frame: the standard sidebar-less app shell around the column renderer (the threads list is the index pane, the thread being read the column beside it), and the app's own dark theme from the approved prototype.",
  contributions: [
    ThemeEngine.Theme(mailTheme),
    Apps.App({ app: mailApp, component: MailLayout }),
  ],
} satisfies PluginDefinition;
