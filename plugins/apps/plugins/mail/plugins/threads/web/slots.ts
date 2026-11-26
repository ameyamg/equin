import { defineItemActions } from "@plugins/primitives/plugins/data-view/web";
import type { MailThreadRow } from "@plugins/apps/plugins/mail/plugins/cache/core";

/** The thread list's row actions (the hover cluster): triage. */
export const ThreadItemActions = defineItemActions<MailThreadRow>();
