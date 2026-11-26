import type { ReactNode } from "react";
import type { Contribution } from "@plugins/framework/plugins/web-sdk/core";
import { renderIsolated } from "@plugins/primitives/plugins/slot-render/web";
import { MailProviderUi } from "../slots";

/**
 * The registered provider's connect surface (v1: one provider), for a mail
 * read refused `not-connected` — the list's, the reader's. `message` is the
 * server's own sentence for the refusal.
 */
export function MailProviderConnect({
  message,
}: {
  message: string;
}): ReactNode {
  const providers = MailProviderUi.Connect.useContributions();
  const provider = providers[0];
  if (provider === undefined || providers.length !== 1) {
    throw new Error(
      `Mail: v1 serves one mail provider, ${providers.length} contribute a connect surface`,
    );
  }
  return renderIsolated(
    MailProviderUi.Connect,
    provider as unknown as Contribution,
    { message },
  );
}
