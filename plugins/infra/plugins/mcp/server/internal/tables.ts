import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * The tools this server last listed to each conversation (`tools/list`): what
 * its agent's MCP client holds. A client lists the tools when it connects and
 * keeps that list for the session — a tool added since, or one whose `when`
 * turned true since, is not in it (2026-11-26: every session started before
 * `turn_for` shipped was asked by the stop gate to call a tool it did not
 * have). Read by `toolCallableBy`. No FK: this plugin knows nothing of
 * conversations, so rows are bounded by `listedToolsRetention`.
 */
export const _mcpListedTools = pgTable("mcp_listed_tools", {
  conversationId: text("conversation_id").primaryKey(),
  tools: text("tools").array().notNull(),
  listedAt: timestamp("listed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
