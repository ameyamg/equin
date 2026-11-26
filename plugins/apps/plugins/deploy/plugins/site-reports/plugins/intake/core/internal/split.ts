import { z } from "zod";
import { cappedList } from "@plugins/packages/plugins/list-bound/core";
import {
  CLIENT_FAMILIES,
  CLIENT_OSES,
  type StallClient,
} from "@plugins/reports/plugins/main-thread-stall/core";
import { SITE_REPORT_LIMITS as L } from "./limits";

/**
 * A split count saturates at int4's ceiling, like the row's own `count`: it
 * still says "at least this many".
 */
const SPLIT_COUNT_MAX = 2_147_483_647;
const SplitCount = z.number().int().min(1).max(SPLIT_COUNT_MAX);

/**
 * How one fingerprint's occurrences split, coarsely, so a visitor report can
 * be diagnosed (one Safari occurrence and 300 from one Chrome extension no
 * longer read the same):
 *
 * - `clients` — occurrences per browser family and OS, the stall kind's own
 *   coarse classification (`coarseClient`: family and OS only, never the user
 *   agent, a version or a device). At most 9 × 8 entries, by the enums.
 * - `paths` — occurrences per page pathname, the `maxSplitPaths` most seen;
 *   the rest are counted together in `otherPaths`.
 *
 * Nothing here names or links a visitor: no user agent, no IP, no visitor or
 * session id. So it cannot say how many distinct visits an error spans — that
 * would need a per-visitor identifier, which the site never keeps.
 *
 * Kept since the column existed: occurrences counted before it are the row's
 * `count` minus the split's total.
 */
export const SiteReportSplitSchema = z
  .object({
    clients: cappedList(
      z
        .object({
          family: z.enum(CLIENT_FAMILIES),
          os: z.enum(CLIENT_OSES),
          count: SplitCount,
        })
        .strict(),
      { max: CLIENT_FAMILIES.length * CLIENT_OSES.length },
    ),
    paths: cappedList(
      z.object({ path: z.string(), count: SplitCount }).strict(),
      { max: L.maxSplitPaths },
    ),
    otherPaths: z.number().int().min(0).max(SPLIT_COUNT_MAX),
  })
  .strict();
export type SiteReportSplit = z.infer<typeof SiteReportSplitSchema>;

export const EMPTY_SITE_REPORT_SPLIT: SiteReportSplit = {
  clients: [],
  paths: [],
  otherPaths: 0,
};

const add = (a: number, b: number): number => Math.min(a + b, SPLIT_COUNT_MAX);

/**
 * Two splits as one: counts summed per client and per path, the paths cut to
 * the `maxSplitPaths` most seen (ties keep the earlier — `a`'s — first) and
 * the rest folded into `otherPaths`. PURE.
 */
export function mergeSiteReportSplits(
  a: SiteReportSplit,
  b: SiteReportSplit,
): SiteReportSplit {
  const clients = new Map<string, SiteReportSplit["clients"][number]>();
  for (const c of [...a.clients, ...b.clients]) {
    const key = `${c.family}/${c.os}`;
    const held = clients.get(key);
    clients.set(key, held ? { ...held, count: add(held.count, c.count) } : c);
  }
  const paths = new Map<string, number>();
  for (const p of [...a.paths, ...b.paths])
    paths.set(p.path, add(paths.get(p.path) ?? 0, p.count));
  // Stable: equal counts keep their first-seen order.
  const ranked = [...paths].sort(([, x], [, y]) => y - x);
  const kept = ranked.slice(0, L.maxSplitPaths);
  const folded = ranked
    .slice(L.maxSplitPaths)
    .reduce((n, [, c]) => add(n, c), 0);
  return {
    clients: [...clients.values()].sort((x, y) => y.count - x.count),
    paths: kept.map(([path, count]) => ({ path, count })),
    otherPaths: add(add(a.otherPaths, b.otherPaths), folded),
  };
}

/** The split of `count` occurrences on one page in one kind of browser. */
export function siteReportSplitOf(
  client: StallClient,
  path: string,
  count: number,
): SiteReportSplit {
  return {
    clients: [{ ...client, count }],
    paths: [{ path, count }],
    otherPaths: 0,
  };
}
