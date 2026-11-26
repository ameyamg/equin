import { z } from "zod";
import { ReportKind } from "@plugins/reports/server";
import { syncStandingReports } from "@plugins/reports/plugins/engine/server";
import type { ReportInput } from "@plugins/reports/core";
import type { OrphanReport } from "@plugins/config_v2/core";
import { defineWarmup } from "@plugins/infra/plugins/warmup/server";
import type { ReportRow } from "@plugins/reports/server";
import { auditUserConfigOrphans } from "./orphan-audit";

export const STRANDED_CONFIG_KIND = "config-orphans-stranded";

const StrandedConfigPayloadSchema = z.object({
  /** `<hier>/<name>` of the stranded config. */
  storeKey: z.string().min(1),
  /** Its files on disk, relative to the user layer (overrides and leftovers). */
  files: z.array(z.string()),
});

type StrandedConfigPayload = z.infer<typeof StrandedConfigPayloadSchema>;

/**
 * The payload of a row filed before one report per config: one row per
 * namespace (fingerprint `config-orphans-stranded`), listing every stranded
 * config. Never filed again, but such rows live on (an investigated row is
 * never swept), so their tasks still render.
 */
const LegacyStrandedConfigPayloadSchema = z.object({
  count: z.number().int().positive(),
  storeKeys: z.array(z.string()),
});

const StoredStrandedConfigPayloadSchema = z.union([
  StrandedConfigPayloadSchema,
  LegacyStrandedConfigPayloadSchema,
]);

/**
 * The `config-orphans-stranded` report kind: **a saved setting no longer
 * applies.** A config override sits at a place no live config reads — the
 * plugin was removed, or it moved onto a destination that already had
 * settings (plugin moves otherwise carry saved settings along; see relocate's
 * apply-moves). The app silently runs the defaults instead.
 *
 * Only real user overrides count. Leftover generated snapshots (origins,
 * ancestors) hold no user data and never report.
 *
 * One row per stranded config (the fingerprint is its store key), synced as a
 * STANDING condition (`syncStandingReports`): the boot audit re-observes it on
 * every restart, and that is not another occurrence. A config stranded later is
 * a new row, so it is news exactly once. Once it is no longer stranded
 * (discarded, or a live config reads it again) the next audit clears it — its
 * report closed when nobody took it up — and a later stranding files again. Before this, one row per namespace was
 * re-recorded on every boot: report-1795697585-xixclh counted 26 "occurrences"
 * of one leftover in 3.5 hours — every restart, never a new stranding.
 */
export const strandedConfigKind = ReportKind({
  kind: STRANDED_CONFIG_KIND,
  schema: StrandedConfigPayloadSchema,
  fingerprint: (d: StrandedConfigPayload) =>
    `${STRANDED_CONFIG_KIND}:${d.storeKey}`,
  meta: {
    tag: "[config]",
    notif: "A saved setting no longer applies",
    variant: "warning",
    category: "error",
  },
  renderTask: (row: ReportRow) => {
    const d = StoredStrandedConfigPayloadSchema.parse(row.data);
    if ("storeKey" in d)
      return { title: strandedConfigTitle(d), description: describe(d) };
    return {
      title: `[config] ${d.count} saved setting(s) no longer apply`,
      description: describe({ storeKey: d.storeKeys.join(", "), files: [] }),
    };
  },
});

function strandedConfigTitle(d: StrandedConfigPayload): string {
  return `[config] Saved setting \`${d.storeKey}\` no longer applies`;
}

function describe(d: StrandedConfigPayload): string {
  return [
    `This namespace's user-layer config holds an override of \`${d.storeKey}\` ` +
      "that no live config reads, so the app runs the defaults instead.",
    ...(d.files.length > 0
      ? ["", "Its files:", "", ...d.files.map((f) => `- \`${f}\``)]
      : []),
    "",
    "Open Debug → Config Orphans for the files, their sizes and where the config likely moved.",
    "Decide with the user: carry the settings over to the config's new location, " +
      "or discard them if the config is gone for good (the row's Discard action). " +
      "Never discard an override without asking — the user layer is not versioned.",
  ].join("\n");
}

/** The audit's stranded configs, as the reports they file — one per config. */
export function strandedConfigReports(report: OrphanReport): ReportInput[] {
  return report.orphans
    .filter((o) => o.riskClass === "stranded-data")
    .map((o) => {
      const data: StrandedConfigPayload = {
        storeKey: o.storeKey,
        files: o.files.map((f) => f.relPath),
      };
      return {
        kind: STRANDED_CONFIG_KIND,
        source: "server-config-audit",
        message: strandedConfigTitle(data),
        data,
      };
    });
}

/**
 * Audit this namespace's saved settings: file each newly stranded one, and
 * clear each that no longer is.
 */
export async function reportStrandedConfig(): Promise<void> {
  await syncStandingReports(
    STRANDED_CONFIG_KIND,
    strandedConfigReports(await auditUserConfigOrphans()),
  );
}

/**
 * The boot audit, as a declared warm-up rather than an `onAllReady` hook: it
 * only files a report, so nothing waits on it — yet in `onAllReady` it held
 * the barrier the warm-up drain starts after (~800 ms on a main boot). The
 * drain still runs after every `onReady`, so the audit sees the full live
 * config registry. `worktree` scope: the user layer it audits is this
 * namespace's.
 */
export const strandedConfigWarmup = defineWarmup({
  name: "config-orphans.stranded",
  description:
    "Checks whether any of your saved settings no longer apply, and reports them.",
  scope: "worktree",
  run: reportStrandedConfig,
});
