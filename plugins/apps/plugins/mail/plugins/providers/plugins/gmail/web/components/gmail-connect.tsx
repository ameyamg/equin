import type { ReactNode } from "react";
import { GmailAccessEmptyState } from "@plugins/integrations/plugins/gmail/web";

/**
 * Gmail's connect surface for Mail: the shared "Gmail is not usable yet"
 * state — what is missing and the control that fixes it — with the server's
 * sentence for when the connection itself looks fine.
 */
export function GmailConnect({ message }: { message: string }): ReactNode {
  return <GmailAccessEmptyState title="Mail" whenReady={message} />;
}
