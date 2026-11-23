import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

/**
 * The upsert's guard: write only what GitHub says that is not older than the
 * row AND differs from it. A catch-up re-lists every run and release it has
 * already stored (each forwarder (re)start — every restart of main's backend),
 * and an identical rewrite is still a write: it fired a change-feed NOTIFY per
 * statement, ~35 per restart, each recomputing every reader of these tables
 * (the publisher's releases row ran its git reads on each, 2026-11-23). A row
 * that would not change is left alone, so the statement touches nothing and
 * the feed sends nothing.
 */
export function newerAndDifferent(
  table: PgTable,
  set: Record<string, unknown>,
): SQL {
  const columns = getTableColumns(table);
  const names = Object.keys(set).map((key) => {
    const column = columns[key];
    if (column === undefined)
      throw new Error(`[github-events] upsert sets "${key}", not a column`);
    return column.name;
  });
  const stored = sql.join(
    names.map((n) => sql`${table}.${sql.identifier(n)}`),
    sql`, `,
  );
  const incoming = sql.join(
    names.map((n) => sql`excluded.${sql.identifier(n)}`),
    sql`, `,
  );
  return sql`excluded.github_updated_at >= ${table}.github_updated_at AND ROW(${stored}) IS DISTINCT FROM ROW(${incoming})`;
}
