import type { ReactNode } from "react";
import type { Contribution } from "@plugins/framework/plugins/web-sdk/core";
import { renderIsolated } from "@plugins/primitives/plugins/slot-render/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { MailProviderUi } from "../slots";

/**
 * The registered providers' connect surfaces, for a mail read refused
 * `not-connected` — the list's, the reader's. `message` is the server's own
 * sentence for the refusal (it names the provider, or the choice to make
 * when several are connected). One provider: its surface alone; several
 * (a composition shipping a demo mailbox beside Gmail): each, one under the
 * other; none: a refusal can only come from a provider, so it is a bug.
 */
export function MailProviderConnect({
  message,
}: {
  message: string;
}): ReactNode {
  const providers = MailProviderUi.Connect.useContributions();
  if (providers.length === 0) {
    throw new Error(
      `Mail: no mail provider contributes a connect surface (refused: ${message})`,
    );
  }
  if (providers.length === 1) {
    return renderIsolated(
      MailProviderUi.Connect,
      providers[0] as unknown as Contribution,
      { message },
    );
  }
  return (
    <Stack gap="xl">
      {providers.map((p) => (
        <div key={p.id}>
          {renderIsolated(
            MailProviderUi.Connect,
            p as unknown as Contribution,
            { message },
          )}
        </div>
      ))}
    </Stack>
  );
}
