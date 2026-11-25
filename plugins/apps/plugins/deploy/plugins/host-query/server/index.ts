import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";

export {
  hostOnlyQueryOverSsh,
  hostOnlyWriteOverSsh,
  markServerBoxIsThisInstance,
  standInServerIds,
} from "./internal/host-query";
export { deployHostStandIns } from "./internal/tables";
export type {
  HostQueryAnswer,
  HostQueryOptions,
  HostWriteOptions,
} from "./internal/query-over-ssh";

export default {
  description:
    "hostOnlyQueryOverSsh(deploymentId, path, schema, { maxAnswerBytes? }): resolves a deployment's server and pinned SSH target, curls one host-only route of the install through its own gateway on the loopback port (two SSH sessions at most), refuses an answer over maxAnswerBytes unread (curl --max-filesize on the box, re-checked here), and answers the parsed answer, which of SSH, the request or the answer failed, or not-found. hostOnlyWriteOverSsh(deploymentId, path, body, schema, { maxSeconds? }): the POST sibling — the JSON body on the SSH session's stdin, never in an argv — with the same resolution, failures and stand-in arm. markServerBoxIsThisInstance(serverId) marks a demo's server whose box is this instance: its host-only routes are answered through this instance's own gateway, no SSH (the same answer cap applies); standInServerIds() lists those servers.",
} satisfies ServerPluginDefinition;
