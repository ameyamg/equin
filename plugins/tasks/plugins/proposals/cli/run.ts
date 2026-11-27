import type { CliAction } from "@plugins/framework/plugins/cli/core";
import { callEndpoint } from "@plugins/infra/plugins/endpoints/server";
import { gatewayPortSync } from "@plugins/infra/plugins/launcher/plugins/gateway-port/data-dirs";
import { readEnv } from "@plugins/infra/plugins/launcher/plugins/env-names/core";
import { namespaceUrl } from "@plugins/infra/plugins/namespace/core";
import { checkoutNamespace } from "@plugins/infra/plugins/paths/core";
import { REPO_ROOT } from "@plugins/infra/plugins/paths/plugins/repo-root/core";
import { sendProposals, type ProposalOutcome } from "../core";
import type { ProposeOptions } from "./index";

function line(
  type: string,
  recordId: string,
  outcome: ProposalOutcome,
): string {
  switch (outcome.kind) {
    case "proposed":
      return `proposed ${outcome.id} (v${outcome.revision}) ${type} ${recordId}: ${outcome.changed.join(", ")}`;
    case "unchanged":
      return `unchanged ${type} ${recordId} (same as main's)`;
    case "decided":
      return `already ${outcome.state} ${type} ${recordId} (${outcome.id}): edit it again to propose anew`;
    case "refused":
      return `refused ${type} ${recordId}: ${outcome.message}`;
  }
}

const run: CliAction<[], ProposeOptions> = async (opts) => {
  if (!opts.message?.trim()) {
    throw new Error("--message is required: say what changed and why");
  }
  const conversationId = readEnv("CONVERSATION_ID");
  if (conversationId === undefined) {
    throw new Error(
      "no agent conversation in this shell: ./equin propose is run by an agent from its own session",
    );
  }
  const only = opts.only?.map((spec) => {
    const at = spec.indexOf(":");
    if (at <= 0 || at === spec.length - 1) {
      throw new Error(
        `--only ${spec}: expected <type>:<id>, e.g. site-feed-item:sfe-…`,
      );
    }
    return { type: spec.slice(0, at), id: spec.slice(at + 1) };
  });
  // This checkout's own backend: it reads the records from its database.
  const origin = namespaceUrl(
    await checkoutNamespace(REPO_ROOT),
    "",
    gatewayPortSync(),
  );
  const answer = await callEndpoint(
    sendProposals,
    {},
    {
      origin,
      body: {
        conversationId,
        note: opts.message.trim(),
        ...(only ? { only } : {}),
      },
    },
  );
  if (answer.kind === "refused") {
    throw new Error(answer.message);
  }
  if (answer.results.length === 0) {
    process.stdout.write(
      "nothing to propose: no record of a registered type was changed in this worktree since it was forked\n",
    );
    return;
  }
  for (const r of answer.results) {
    process.stdout.write(`${line(r.type, r.recordId, r.outcome)}\n`);
  }
  if (answer.results.some((r) => r.outcome.kind === "refused")) {
    process.exitCode = 1;
  }
};

export default run;
