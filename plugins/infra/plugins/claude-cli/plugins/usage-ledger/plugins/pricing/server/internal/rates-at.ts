import { desc, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "@plugins/database/server";
import {
  TOKEN_KINDS,
  type DayBucket,
} from "@plugins/infra/plugins/claude-cli/plugins/usage-ledger/core";
import { _claudeModelRates, _claudePriceVersions } from "./tables";

// Pricing tokens the ledger has not filed yet — a stretch of an hour, read
// straight from the transcripts (conversations/usage's cost at a reading
// position) — exactly as `claude_spend_hours_v` prices a filed hour: the rates
// of the NEWEST version whose `effective_from` is at or before the hour, one
// dot product of the tier-split tokens with the materialized rates, and no
// price (never $0) for a model that version has no row for. The version rule
// and the dot product are the view's (`views.ts`); keep the two in step.

type RateRow = typeof _claudeModelRates.$inferSelect;

/** One version's rates, by `${model} ${speed}` — what a bucket is priced with. */
export type RatesInForce = ReadonlyMap<string, RateRow>;

const rateKey = (model: string, speed: string) => `${model} ${speed}`;

/** The rates of the price version in force at `hour` (empty when none is). */
export async function ratesInForceAt(
  exec: DbExecutor,
  hour: Date,
): Promise<RatesInForce> {
  const v = _claudePriceVersions;
  const [version] = await exec
    .select({ id: v.id })
    .from(v)
    .where(sql`${v.effectiveFrom} <= ${hour.toISOString()}::timestamptz`)
    .orderBy(desc(v.effectiveFrom), desc(v.id))
    .limit(1);
  if (!version) return new Map();
  const rows = await exec
    .select()
    .from(_claudeModelRates)
    .where(eq(_claudeModelRates.versionId, version.id));
  return new Map(rows.map((r) => [rateKey(r.model, r.speed), r]));
}

/**
 * A bucket's cost at `rates`, or `null` when they hold no rate for its model
 * and speed — unpriced, as the view's NULL, never $0.
 *
 * A bucket of no tokens costs $0 under any price, rate or not: the ledger
 * never files one (`usageLedgerUpsert` drops all-zero rows), so the view never
 * calls it unpriced, and neither may this. Claude Code's `<synthetic>`
 * pseudo-model (an interrupted or failed turn) carries only zeros — priced as
 * `null` it flagged a fully priced conversation's cost as missing a price.
 */
export function priceWithRates(
  rates: RatesInForce,
  bucket: Pick<DayBucket, "model" | "speed" | (typeof TOKEN_KINDS)[number]>,
): number | null {
  const r = rates.get(rateKey(bucket.model, bucket.speed));
  if (!r) return hasTokens(bucket) ? null : 0;
  let cost = 0;
  for (const kind of TOKEN_KINDS) {
    cost += bucket[kind].below * r[`${kind}Below`];
    cost += bucket[kind].above * r[`${kind}Above`];
  }
  return cost;
}

function hasTokens(
  bucket: Pick<DayBucket, (typeof TOKEN_KINDS)[number]>,
): boolean {
  return TOKEN_KINDS.some(
    (kind) => bucket[kind].below !== 0 || bucket[kind].above !== 0,
  );
}
