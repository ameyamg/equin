import type { ReactNode } from "react";
import { Card } from "@plugins/primitives/plugins/css/plugins/card/web";
import { Center } from "@plugins/primitives/plugins/css/plugins/center/web";
import { Fill } from "@plugins/primitives/plugins/css/plugins/fill/web";
import { rigidClass } from "@plugins/primitives/plugins/css/plugins/rigid/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { cn } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import "./download-card.css";

/**
 * One of the page's closing cards: an icon in a tile of the card's light, a
 * title over one line, and the way on (a pill) at the end of the row. The
 * `tone` names the light (`download-card.css`): `tips` the tips' warm bulb,
 * `demo` the accent's blue. Below 16rem of words, the pill wraps under them.
 */
export function DownloadCard({
  tone,
  icon,
  title,
  line,
  action,
}: {
  tone: "tips" | "demo";
  icon: ReactNode;
  title: string;
  line: string;
  action: ReactNode;
}) {
  return (
    <Card data-tone={tone} className="download-card shadow-none">
      <Stack
        direction="row"
        gap="none"
        align="center"
        wrap
        className="download-card-row"
      >
        <Center aria-hidden className={cn("download-card-tile", rigidClass())}>
          {icon}
        </Center>
        <Fill className="min-w-64">
          <Stack gap="none" align="start">
            <Text
              as="h3"
              variant="heading"
              className="font-semibold tracking-[-0.01em]"
            >
              {title}
            </Text>
            <Text
              as="p"
              variant="label"
              tone="muted"
              className="download-card-line font-normal"
            >
              {line}
            </Text>
          </Stack>
        </Fill>
        {action}
      </Stack>
    </Card>
  );
}
