import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { ConfigV2 } from "@plugins/config_v2/server";
import { IdKinds } from "@plugins/ids/server";
import { implement } from "@plugins/infra/plugins/endpoints/server";
import {
  discardMailDraft,
  mailComposeConfig,
  mailDraftIdKind,
  saveMailDraft,
  sendMailDraft,
  startMailDraft,
  undoSendMailDraft,
} from "../core";
import { draftTableExclusions } from "./internal/declarations";
import {
  attachmentLinkContributions,
  mailDraftMirrorJob,
  mailDraftServed,
  mailSignatureServed,
  mailSendJob,
  mailDraftsRetention,
  outbox,
} from "./internal/served";

export { _mailDrafts } from "./internal/tables";

export default {
  description:
    "The Mail app's compose, server half: mail_drafts — each draft's working copy (recipients as typed, subject, body, files, the thread it answers, In-Reply-To / References and the quote of what it answers) and the outbox — mail.draft (one draft, pushed on every save), mail.signature (the account's signature as the editor shows it, read from the provider when an editor opens), and the writes: start (blank, reply, reply all, forward — recipients, Re:/Fwd:, quote and threading derived from the message answered — or continue a draft message a thread holds, adopting a draft made elsewhere), save, send (queued for the undo-send delay, Settings → Config mail-compose, 10 s by default), undo send and discard; mail.draft-mirror (settled per draft) copies a draft to the provider's drafts and deletes it there on discard; mail.send sends a due draft through the provider, built by packages/mime, never twice (claimed before the call, its own Message-ID, a lost answer settled with findMessage), and a send given up reopens the draft with the reason and a notification. Left out of worktree forks.",
  httpRoutes: {
    [startMailDraft.route]: implement(startMailDraft, ({ body }) =>
      outbox.start(body.id, body.start),
    ),
    [saveMailDraft.route]: implement(saveMailDraft, ({ params, body }) =>
      outbox.save(params.id, body.content),
    ),
    [sendMailDraft.route]: implement(sendMailDraft, ({ params, body }) =>
      outbox.send(params.id, body.content),
    ),
    [undoSendMailDraft.route]: implement(undoSendMailDraft, ({ params }) =>
      outbox.undoSend(params.id),
    ),
    [discardMailDraft.route]: implement(discardMailDraft, ({ params }) =>
      outbox.discard(params.id),
    ),
  },
  contributions: [
    IdKinds.Kind({ kind: mailDraftIdKind }),
    ...mailDraftServed.declare,
    ...mailSignatureServed.declare,
    ...attachmentLinkContributions,
    ...draftTableExclusions,
    ConfigV2.Register({ descriptor: mailComposeConfig }),
  ],
  register: [mailDraftMirrorJob, mailSendJob, mailDraftsRetention],
} satisfies ServerPluginDefinition;
