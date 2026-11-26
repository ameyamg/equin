import type { ComponentType } from "react";
import { defineSlot } from "@plugins/framework/plugins/web-sdk/core";

/**
 * What a mail provider draws in the browser. A provider kind contributes its
 * own (`providers/*`); a consumer renders the registered one and names none.
 */
export interface MailProviderConnectContribution {
  /** The provider kind (`MailProviderDefinition.id`, e.g. `gmail`). */
  id: string;
  /**
   * In place of a list the account cannot answer (`not-connected`): what is
   * missing and the control that fixes it, in place — never a route to
   * Settings. `message` is the server's own sentence for the refusal.
   */
  component: ComponentType<{ message: string }>;
}

export const MailProviderUi = {
  /** The provider's connect surface (one per provider kind). */
  Connect: defineSlot<MailProviderConnectContribution>({
    docLabel: (c) => c.id,
  }),
};
