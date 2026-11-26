# mcp

HTTP MCP server at `POST /api/mcp/:conversationId`. Every request builds a
fresh, stateless `McpServer`; the conversation id from the URL is the context
(`McpToolContext`) handed to every contribution — or, as the reserved id
`unattached` (`MCP_UNATTACHED_ID`), a session equin did not launch (see
*Unattached sessions*).

## Two halves

- `server/` — the contribution API only (`Mcp.tool` / `Mcp.scope`, the types,
  the in-process registry). SDK-free, so a plugin that contributes a tool stays
  portable (a browser host registers its
  contributions into a registry nothing serves).
- `machine/` — everything that answers agents: the `POST /api/mcp/:conversationId`
  route (`@modelcontextprotocol/sdk`), the `mcp.catalog` and `mcp.health` values.
  All three are declared `needsMachine` — agents run on the computer — so the
  SDK (and ajv) never reach a browser host's bundle, and a host without the
  computer shows Debug → MCP tools and the health row as not available here.

## Contributing

Both factories return a `Registration` token that goes in the plugin's server
`register: [...]` array. Duplicate names/ids throw at register time.

- `Mcp.tool({ name, description, inputSchema, when?, handler })` — a tool the
  agent can call. `when(ctx)` gates it per conversation: when false the tool is
  not registered on that request's server, so it is absent from `tools/list`
  and a call to it is an unknown-tool error (the handler never runs). It runs
  on **every** MCP request (all gates in parallel), so keep it a cheap lookup;
  a `when` that throws hides only that tool (see *Failure isolation*).
  Omitted: visible everywhere.
  Optional `liveDescription(ctx)` appends a LIVE section to the fixed
  `description` (after a blank line), rendered only for a `tools/list` request
  — i.e. the data as of when the client listed the tools, typically at connect.
  For facts held in the database that an agent needs while using the tool (a
  vocabulary to pick from). `null` adds nothing; a throw is isolated (see
  *Failure isolation*).
- `unattached: true` also serves the tool to a session equin did not launch
  (see *Unattached sessions*); its handler's `conversationId` is then
  `string | null`.
- `profiles?: readonly string[]` on a tool reserves it for those scopes (scratch
  profiles): never listed in the default scope, listed for a profile only when
  that profile's allowlist also names it.
- `Mcp.scope(resolver)` — THE one resolver of a conversation's scope
  (`{kind:"default"}` or `{kind:"profile", profile, tools}`), registered by
  `conversations/workspace/scratch` (inverted so this plugin knows nothing of
  conversations). A profile scope sees exactly its `tools` (an unknown or
  foreign-reserved name throws); `when` still applies on top. Pure filter: `machine/internal/scope.ts`.

## What a session holds

A client lists the tools when it connects and keeps that list: a tool added
since (a deploy) or whose `when` turned true since is not in it until it
reconnects. So every `tools/list` to a conversation records the names it
listed (`mcp_listed_tools`, 30-day retention; the record's failure is isolated
like a contribution's), and `toolCallableBy(conversationId, toolRegistration)`
(server) answers whether the agent can call a tool now — listed to it and its
`when` still true — or why not (`never-listed` / `not-listed` / `hidden`).
`Mcp.tool` returns an `McpToolRegistration` (it names its tool), so a reader
refers to a tool by its declaration, never a spelled name. Its reader: a stop
gate's `tools` (`conversations/stop-gate`), so a gate never demands a tool
the session lacks.

The record also tells a client its list moved. Each listing records a
fingerprint of what it handed over — every tool's name, fixed description and
input schema (`machine/internal/fingerprint.ts`, memoized per tool: a process's first
request converts every schema, later ones pay one hash over the digests). When a conversation's request (not a
`tools/list`, `initialize` or lone notification) mounts a set whose fingerprint
differs — a tool added, hidden, reworded or reshaped — or none is recorded, its
JSON answer is re-sent as an SSE stream with `notifications/tools/list_changed`
before the reply — still stateless, the stream closes with the reply. Claude
Code re-lists at once. A live description section is not in the fingerprint:
it is the data as of the listing by definition. A failed read is reported and
sends no notice.

## Unattached sessions

A `claude` started in a terminal — the usual way to recover a broken main —
carries none of the variables equin hands the agents it launches
(`EQUIN_PARENT_URL`, `EQUIN_CONVERSATION_ID`). `.mcp.json` falls back to main's
origin and the `unattached` id for them, so such a session still reaches the
server (the gateway reads a request with no `Origin` / `Sec-Fetch-Site` as the
owner — a local tool). The check `mcp:mcp-json-in-sync` pins `.mcp.json`'s URL
to `MCP_UNATTACHED_ID` and main's `namespaceUrl`, since JSON cannot import them.

- An unattached request is served exactly the tools declared
  `unattached: true`. No scope resolver, `when` or live description runs: each
  is a function of a conversation, and an unattached tool may declare none of
  them (`?: never`).
- Such a tool's handler gets `McpCallerContext` — `conversationId: string |
  null`, `null` when unattached — so tsc makes it answer without a
  conversation. Whatever it would read off the conversation (its worktree, its
  deploy) defaults to main. Every other tool keeps `conversationId: string`.
- Opt a tool in only when it is read-only and means something with no
  conversation: the debug reads (`get_timeline`, `query_db`,
  `get_queue_health`, `get_runtime_profile`), `read_page`, the `browser_*`
  tools. Writes that are credited to a conversation (page notes, task filing)
  and tools about the agent's own conversation or task tree stay out.
- Making a terminal session a real equin conversation (task, worktree, mandate,
  system-prompt sections) is a separate, parked idea (the Parking page).

## Catalog

`mcp.catalog` (core, a `liveValue` fixed for the process) lists every tool
and the scope resolver with the plugin that declared each
(recorded via `registeringPlugin()` at register time). Each tool's input schema
is read off a real `tools/list` over an in-memory client (`machine/internal/catalog.ts`),
through the same `mountTool` the request path uses — so it is exactly what
agents receive. Shown by Debug → MCP tools (`debug/mcp-tools`).

## No server instructions

The server sends no MCP server instructions, and there is no way to contribute
one. `Mcp.instructions` existed until 2026-11-12 and carried the Mandate, the
global page instructions and the Task tree — until Claude Code was seen cutting
the instructions at **4,096 characters, silently**: a supervisor's Mandate and
page section filled the budget, a global instructions card was cut mid-header
while recorded as received, and the Task tree never arrived
(`research/2026-11-12-conversations-system-prompt-sections.md`).

- **How to use a tool** goes in its `description` (or `liveDescription`).
- **Context about the agent and its task** is a `SystemPrompt.Section`
  ([`conversations/system-prompt`](../../../conversations/plugins/system-prompt/CLAUDE.md)):
  appended to the agent's system prompt at every spawn, uncapped, its size shown
  in the context card.

## Failure isolation

Every per-connection contribution callback — a `liveDescription`, a `when`
gate — runs through `runContribution`
(`machine/internal/isolate.ts`): a throw stays that contribution's failure, never
the connection's. It is reported (server log + a `crash` report via
server-core's `reportServerError`) and rendered where the contribution would
have been:

- live description → the fixed description plus a "section unavailable" notice
  naming the error, so the agent knows guidance is missing;
- `when` → the tool is hidden for that request (fail closed: a gate that cannot
  answer never grants).

Why not fail the whole request: these are independent contributions from
unrelated plugins. Failing the connect for one of them (as it did until
2026-10-28) let a single broken contribution — the tree-digest instructions
section, since moved to the system prompt — take down every equin
tool for every agent for over an hour, including `exit_clean` / `flag_raise`, the
very tools an agent would use to report it. Loud means *reported and visible*,
not *blast radius of everything*. The scope resolver stays global: there is one,
and without it no tool set can be computed.

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Description: The MCP contribution API, SDK-free: Mcp.tool / Mcp.scope register a tool or THE scope resolver (no server instructions: context about an agent is a conversations/system-prompt section) into the in-process registry the desktop half (machine/) serves over HTTP — so a plugin contributing to the MCP server stays portable. Owns mcp_listed_tools (the tools last listed to each conversation — what its client holds) and toolCallableBy(conversationId, toolRegistration): whether a conversation's agent can call a tool now (listed to it and its when still true), or why not.
- Load-bearing: yes
- Server:
  - Contributes:
    - `resource.declare` "mcp.catalog"
    - `resource.declare` "mcp.health"
  - Uses:
    - `database.db`
    - `infra/retention.defineRetention`
  - DB schema: `plugins/infra/plugins/mcp/server/internal/tables.ts`
  - Exports (types):
    - `McpCallerContext`
    - `McpConversationTool`
    - `McpScope`
    - `McpScopeResolver`
    - `McpTool`
    - `McpToolCallContext`
    - `McpToolContext`
    - `McpToolRegistration`
    - `McpToolResult`
    - `McpUnattachedTool`
    - `ToolReach`
  - Exports (values):
    - `Mcp`
    - `toolCallableBy`
  - Register: `defineJob('retention.mcp_listed_tools')`
  - Resources:
    - `mcp.catalog` (push, fixed, whole: every Mcp.tool the code registers — fixed for the process, a hundred or so, whole: the scratch profiles a tool is reserved for — one or two, whole: one JSON Schema object's top-level keywords (type, properties, required, …) — a handful)
    - `mcp.health` (push, notified, capped: MCP_HEALTH_MAX_DEGRADED)
- Machine:
  - Uses:
    - `infra/endpoints.machineHandler`
    - `network/live.serveValue`
  - Routes: `POST /api/mcp/:conversationId`
- Core:
  - Uses:
    - `infra/endpoints.defineEndpoint`
    - `network/live.liveValue`
    - `packages/list-bound.cappedList`
    - `packages/list-bound.wholeList`
    - `packages/list-bound.wholeRecord`
  - Exports (types):
    - `McpCatalog`
    - `McpCatalogTool`
    - `McpDegraded`
    - `McpHealth`
  - Exports (values):
    - `agentToolName`
    - `MCP_HEALTH_MAX_DEGRADED`
    - `MCP_SERVER_NAME`
    - `MCP_UNATTACHED_ID`
    - `mcpCatalog`
    - `McpCatalogSchema`
    - `McpCatalogToolSchema`
    - `McpDegradedSchema`
    - `mcpHealth`
    - `McpHealthSchema`
    - `mcpRequest`
- Cross-plugin:
  - Imported by: 32 plugins — full list in [REFERENCE.md](./REFERENCE.md)
    - `tasks` ×10
    - `conversations` ×7
    - `debug` ×6
    - `apps` ×4
    - `infra` ×2
    - `database/query`
    - `hints/ask`
    - `page/annotations/agent-access`
  - Endpoint callers: `health`
- Exemptions:
  - Exempts itself from:
    - `endpoints:no-raw-json-handlers` — `machine/internal/handle-mcp.ts` (sanctioned)
    - `no-raw-sse` — `machine/internal/handle-mcp.ts`, `machine/internal/handle-mcp.test.ts` (sanctioned)
- Sub-plugins:
  - **`browser`** [exempt] — The health report's Agent browser row: whether the machine's agent-browser host runs, its sessions (what each is for — its task's title — its tab count, and how long until it closes if left idle), a…
  - **`health`** — The health report's MCP server row: critical while the latest MCP request failed (agents launched from here have no equin tools), attention while a per-connection contribution (a tool's gate or live…

<!-- AUTOGENERATED:END -->
