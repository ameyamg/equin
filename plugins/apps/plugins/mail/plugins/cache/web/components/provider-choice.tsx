import type { ReactNode } from "react";
import { useSetConfig } from "@plugins/config_v2/web";
import { MailProviderUi } from "@plugins/apps/plugins/mail/plugins/provider/web";
import { Button } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Center } from "@plugins/primitives/plugins/css/plugins/center/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { mailAccountConfig } from "../../core";

/**
 * In place of a mail list or thread refused `provider-not-chosen` (several
 * providers' accounts connected, none chosen): one button per registered
 * provider, each writing Settings → Config → Mail account — the same
 * setting — so the choice is made where the question is asked. `message`
 * is the server's sentence naming the connected ones.
 */
export function MailProviderChoice({
  message,
}: {
  message: string;
}): ReactNode {
  const providers = MailProviderUi.Connect.useContributions();
  const setConfig = useSetConfig(mailAccountConfig);
  return (
    <Center axis="both" className="min-h-full">
      <Stack gap="md" align="center" className="max-w-sm text-center">
        <Text as="h1" variant="heading">
          Mail
        </Text>
        <Text as="p" variant="body" tone="muted">
          {message}
        </Text>
        <Stack direction="row" gap="sm">
          {providers.map((p) => (
            <Button
              key={p.id}
              variant="outline"
              onClick={() => {
                setConfig("provider", p.id);
              }}
            >
              {p.label}
            </Button>
          ))}
        </Stack>
      </Stack>
    </Center>
  );
}
