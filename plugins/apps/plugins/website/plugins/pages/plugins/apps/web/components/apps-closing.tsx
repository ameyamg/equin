import { useState, type FormEvent } from "react";
import { transient } from "@plugins/primitives/plugins/kept-state/core";
import { useOpenPane } from "@plugins/primitives/plugins/pane/web";
import { Card } from "@plugins/primitives/plugins/css/plugins/card/web";
import { Fill } from "@plugins/primitives/plugins/css/plugins/fill/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Theme } from "@plugins/primitives/plugins/css/plugins/theme-boundary/web";
import {
  Button,
  ControlSizeProvider,
  Input,
} from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { subThemeScope } from "@plugins/primitives/plugins/css/plugins/ui-kit/core";
import { downloadPane } from "@plugins/apps/plugins/website/plugins/pages/plugins/download/web";
import { equinClosingTheme } from "../internal/theme";

/**
 * The gallery's last word, in its own sizes (`equinClosingTheme`): "Missing an
 * app?". The page then ends as every reading page does, on the site's Try it
 * band (`Website.PageEnd`, drawn by `WebsiteChrome`). Its distance from the
 * gallery above is the gallery's score, in `apps-gallery.css`.
 */
export function AppsClosing() {
  return (
    <Theme name={subThemeScope(equinClosingTheme)} surface="none">
      <AppsCompose />
    </Theme>
  );
}

/**
 * "Missing an app?" — the gallery's answer to an app it does not have: install
 * equin, then describe it, and an agent composes it. The field is there so the
 * reader can start describing; Build it goes to the download page, because the
 * building happens in equin, not on the site.
 */
function AppsCompose() {
  const openPane = useOpenPane();
  const [idea, setIdea] = useState("");
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    openPane(downloadPane, {}, { mode: "root" });
  };
  return (
    <Card className="website-apps-compose border-foreground/20 rounded-3xl border-dashed bg-transparent shadow-none">
      <Stack direction="row" gap="xl" align="center" wrap>
        <Fill>
          <Stack gap="2xs">
            <Text
              as="h3"
              variant="heading"
              className="font-semibold tracking-[-0.02em]"
            >
              Missing an app?
            </Text>
            <Text as="p" variant="body" tone="muted">
              Install equin, then describe it: an agent composes it from
              existing plugins and builds what is missing.
            </Text>
          </Stack>
        </Fill>
        <Stack
          as="form"
          direction="row"
          gap="xs"
          className="website-apps-compose-ask"
          onSubmit={onSubmit}
        >
          <Fill>
            {/* The field is the small control (42px, 14px text), Build it the
                regular one beside it. */}
            <ControlSizeProvider size="sm">
              <Input
                className="website-apps-compose-field"
                keep={transient(
                  "never sent: Build it opens the download page, the idea is only a prompt to start describing",
                )}
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                placeholder="A habit tracker that reads my calendar…"
                aria-label="Describe the app"
              />
            </ControlSizeProvider>
          </Fill>
          <Button type="submit" variant="secondary" className="font-semibold">
            Build it
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
}
