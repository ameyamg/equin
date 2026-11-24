import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { DerivedTable } from "@plugins/database/plugins/derived-tables/server";
import { IdKinds } from "@plugins/ids/server";
import { decisionExchangeIdKind, decisionIdKind } from "../core";
import { decisionsOpenCapability } from "./internal/capability";
import { decisionExchangeFacts } from "./internal/facts";
import { decisionHistorySource } from "./internal/history";
import {
  decisionExchangesServed,
  decisionsListServed,
} from "./internal/resources";
import {
  listDecisionsTool,
  openDecisionTool,
  updateDecisionTool,
} from "./internal/tools";

export { _decisionExchanges, _decisions } from "./internal/tables";

export default {
  description:
    "Agent decisions, the record: the decisions table (one per question an agent asks the user, owned by its task, labelled D<n>, in state decision / action / fyi / other / closed with an outcome) and its append-only thread (decision_exchanges: answers, questions and the agent's replies, notes); each decision's thread facts materialized per decision (decision_exchange_facts), from which the decisions.list window derives the inbox tab (needs / sent / fyi / closed) and the new mark; decisions.exchanges, one decision's thread; the decision history source (every edit a version, the closed version pinned before a reopen); and the open_decision / update_decision / list_decisions MCP tools, granted by decisions.open (a closed decision accepts only notes and replies unless the call reopens it).",
  contributions: [
    IdKinds.Kind({ kind: decisionIdKind }),
    IdKinds.Kind({ kind: decisionExchangeIdKind }),
    ...decisionsListServed.declare,
    ...decisionExchangesServed.declare,
    DerivedTable(decisionExchangeFacts.rollup),
    decisionsOpenCapability,
  ],
  register: [
    decisionHistorySource,
    openDecisionTool,
    updateDecisionTool,
    listDecisionsTool,
  ],
} satisfies ServerPluginDefinition;
