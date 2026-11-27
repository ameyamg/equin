import { databaseForkedAt } from "@plugins/database/plugins/fork-point/server";
import { mediaAttachmentIds } from "@plugins/fields/plugins/media/core";
import {
  AttachmentBlobs,
  getAttachment,
} from "@plugins/infra/plugins/attachments/server";
import {
  callEndpoint,
  implement,
} from "@plugins/infra/plugins/endpoints/server";
import { EndpointError } from "@plugins/infra/plugins/endpoints/core";
import { servedGatewayPort } from "@plugins/infra/plugins/launcher/plugins/gateway-port/core";
import {
  MAIN_WORKTREE_NAME,
  namespaceUrl,
} from "@plugins/infra/plugins/namespace/core";
import { agentOriginHeaders } from "@plugins/infra/plugins/request-origin/core";
import {
  isMain,
  runtimeNamespace,
} from "@plugins/infra/plugins/runtime-identity/core";
import {
  importProposalAttachment,
  missingProposalAttachments,
  PROPOSALS_PER_SEND_MAX,
  receiveProposal,
  sendProposals,
  type ProposalOutcome,
} from "../../core";
import { proposalTypeOf, proposalTypes } from "./registry";
import { resolveValues } from "./values";

/** Where an agent's proposals go: main's backend, through the gateway. */
function mainOrigin(): string {
  return namespaceUrl(MAIN_WORKTREE_NAME, "", servedGatewayPort());
}

/** Every request to main says an agent session caused it (main's write gate reads it). */
const AGENT_HEADERS = agentOriginHeaders("equin-propose");

type SendAnswer =
  | {
      kind: "sent";
      results: { type: string; recordId: string; outcome: ProposalOutcome }[];
    }
  | { kind: "refused"; message: string };

/**
 * Hand this worktree's edits to main: each record of a registered type this
 * database wrote since its fork (or only `only`), its files first (only those
 * main lacks), then the record itself. One answer per record.
 */
export async function send(input: {
  conversationId: string;
  note: string;
  only?: { type: string; id: string }[];
}): Promise<SendAnswer> {
  if (isMain()) {
    return {
      kind: "refused",
      message:
        "this is main: proposals are made from an agent's worktree, whose database is a fork of main's",
    };
  }
  const forkedAt = await databaseForkedAt();
  if (forkedAt === null) {
    return {
      kind: "refused",
      message:
        "this database was not forked from main's: there is no main record to propose a change to",
    };
  }
  const records =
    input.only ??
    (
      await Promise.all(
        proposalTypes().map(async (t) =>
          (await t.touchedSince(forkedAt)).map((id) => ({ type: t.id, id })),
        ),
      )
    ).flat();
  if (records.length > PROPOSALS_PER_SEND_MAX) {
    return {
      kind: "refused",
      message: `${records.length} records changed here — at most ${PROPOSALS_PER_SEND_MAX} per propose: pick them with --only`,
    };
  }
  const origin = mainOrigin();
  const worktree = runtimeNamespace();
  const results = [];
  for (const record of records) {
    results.push({
      type: record.type,
      recordId: record.id,
      outcome: await sendOne(record, {
        origin,
        worktree,
        forkedAt,
        note: input.note,
        conversationId: input.conversationId,
      }).catch((err: unknown): ProposalOutcome => {
        // Main answered an error, or did not answer: this record was not
        // proposed — said with its reason, while the records before it (already
        // stored on main) keep their answers and the ones after it are tried.
        if (err instanceof EndpointError || err instanceof TypeError) {
          return {
            kind: "refused",
            message: `main did not take it: ${err.message}`,
          };
        }
        throw err;
      }),
    });
  }
  return { kind: "sent", results };
}

async function sendOne(
  record: { type: string; id: string },
  ctx: {
    origin: string;
    worktree: string;
    forkedAt: Date;
    note: string;
    conversationId: string;
  },
): Promise<ProposalOutcome> {
  const type = proposalTypeOf(record.type);
  if (type === null) {
    return { kind: "refused", message: `no record type "${record.type}" here` };
  }
  const found = await type.read(record.id);
  if (found === null) {
    return {
      kind: "refused",
      message: `no ${type.label} ${record.id} here (deleted since?)`,
    };
  }
  const fields = type.fieldsOf(found.scope);
  if (fields === null) {
    return {
      kind: "refused",
      message: `${type.label}: unknown scope "${found.scope}"`,
    };
  }
  const resolved = resolveValues(fields, found.values);
  if (resolved.kind === "invalid") {
    return {
      kind: "refused",
      message: `${type.label} ${record.id} no longer fits its fields: ${resolved.message}`,
    };
  }
  const ids = mediaAttachmentIds(fields, resolved.values);
  if (ids.length > 0) {
    const { missing } = await callEndpoint(
      missingProposalAttachments,
      {},
      { origin: ctx.origin, body: { ids }, headers: AGENT_HEADERS },
    );
    for (const id of missing) {
      const att = await getAttachment(id);
      if (att === null) {
        return {
          kind: "refused",
          message: `the file ${id} is not in this worktree`,
        };
      }
      const blob = await AttachmentBlobs.get().read(att.diskPath);
      if (blob === null) {
        return {
          kind: "refused",
          message: `the bytes of ${att.filename} (${id}) are gone from the store`,
        };
      }
      await callEndpoint(
        importProposalAttachment,
        { id },
        {
          origin: ctx.origin,
          body: blob,
          query: { filename: att.filename, mime: att.mime, size: att.size },
          headers: AGENT_HEADERS,
        },
      );
    }
  }
  return callEndpoint(
    receiveProposal,
    {},
    {
      origin: ctx.origin,
      body: {
        type: type.id,
        scope: found.scope,
        recordId: record.id,
        values: resolved.values,
        note: ctx.note,
        conversationId: ctx.conversationId,
        worktree: ctx.worktree,
        forkedAt: ctx.forkedAt.toISOString(),
      },
      headers: AGENT_HEADERS,
    },
  );
}

export const handleSendProposals = implement(sendProposals, ({ body }) =>
  send(body),
);
