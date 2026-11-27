import type { ReactElement } from "react";
import { Center } from "@plugins/primitives/plugins/css/plugins/center/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";

/**
 * The local provider's connect surface: there is nothing to connect — a
 * mailbox kept on this device exists once one was set up (a demo's seed), so
 * it says only the server's sentence ("No local mailbox on this device.").
 */
export function LocalMailConnect({
  message,
}: {
  message: string;
}): ReactElement {
  return (
    <Center axis="both" className="min-h-full">
      <Stack gap="md" align="center" className="max-w-sm text-center">
        <Text as="h1" variant="heading">
          Mail
        </Text>
        <Text as="p" variant="body" tone="muted">
          {message}
        </Text>
      </Stack>
    </Center>
  );
}
