import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "endpoints:no-raw-json-handlers",
    paths: ["machine/internal/handle-mcp.ts"],
    kind: "sanctioned",
    reason:
      "The MCP route speaks JSON-RPC, not an implement() endpoint: a request it fails to serve is answered as a JSON-RPC error body with HTTP 500 (attached to the rethrown error via answerThrowWith), so the agent reads the failed tool and its cause.",
  },
  {
    rule: "no-raw-sse",
    paths: [
      "machine/internal/handle-mcp.ts",
      "machine/internal/handle-mcp.test.ts",
    ],
    kind: "sanctioned",
    reason:
      "Not live state: the MCP streamable-HTTP spec's own form of one POST's answer, closed with the reply. A client's stale tool list is told to re-list by a notifications/tools/list_changed in front of the reply; a JSON answer has no room for it, and the client speaks no other channel.",
  },
] satisfies Exemptions;
