import { and, eq } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { defineSecretNamespace } from "@plugins/infra/plugins/secrets/core";
import {
  getSecret,
  getSecretMetadata,
  setSecret,
} from "@plugins/infra/plugins/secrets/server";
import { serveValue } from "@plugins/network/plugins/live/machine";
import { deploymentIdKind } from "@plugins/apps/plugins/deploy/plugins/deployments/core";
import {
  secretConfigKeys,
  syndicationTargetSettings,
  type SyndicationTargetSettings,
} from "../../core";
import {
  syndicationTargetOf,
  type SyndicationTargetContribution,
} from "../../server";
import { _siteFeedSyndicationSettings } from "../../server/internal/tables";

/**
 * A target's secret config values (a webhook URL, a token), one per site,
 * feed, target and field. `instance` — like the settings rows they belong to:
 * a worktree testing a target keeps its own copy and never overwrites main's.
 */
export const SYNDICATION_SECRETS = defineSecretNamespace("site-feeds", {
  scope: "instance",
});

function secretRef(
  deploymentId: string,
  feedId: string,
  targetId: string,
  fieldKey: string,
) {
  return {
    namespace: SYNDICATION_SECRETS,
    key: `${deploymentId}/${feedId}/${targetId}/${fieldKey}`,
  };
}

type SettingsRow = typeof _siteFeedSyndicationSettings.$inferSelect;

async function readRows(
  deploymentId: string,
  feedId: string,
): Promise<SettingsRow[]> {
  return db
    .select()
    .from(_siteFeedSyndicationSettings)
    .where(
      and(
        eq(
          _siteFeedSyndicationSettings.deploymentId,
          deploymentIdKind.key(deploymentId),
        ),
        eq(_siteFeedSyndicationSettings.feedId, feedId),
      ),
    );
}

/** The stored non-secret values of a target's config, minus any key that is now a secret. */
function plainConfig(
  target: SyndicationTargetContribution,
  stored: Record<string, unknown>,
): Record<string, unknown> {
  const secrets = new Set(secretConfigKeys(target.target.configFields));
  return Object.fromEntries(
    Object.entries(stored).filter(
      ([k]) => k in target.target.configFields && !secrets.has(k),
    ),
  );
}

/** Every saved target's settings for one site's feed, as the browser sees them. */
export const syndicationSettingsServed = serveValue(syndicationTargetSettings, {
  source: "external",
  // The truth is the settings table plus the secrets store (which no change
  // feed sees); `saveTargetSettings` writes both, then notifies.
  changes: "notified",
  reads: {
    tables: [_siteFeedSyndicationSettings],
    reason:
      "a target's row says whether it is on and holds its plain config; the secrets beside it are set only by the same save, which notifies",
  },
  loader: async ({ deploymentId, feedId }) => {
    const out: Record<string, SyndicationTargetSettings> = {};
    for (const row of await readRows(deploymentId, feedId)) {
      const target = syndicationTargetOf(row.targetId);
      // A target whose plugin was removed: its row stays, unseen.
      if (target === null) continue;
      const secretsSet: Record<string, boolean> = {};
      for (const key of secretConfigKeys(target.target.configFields)) {
        const meta = await getSecretMetadata(
          secretRef(deploymentId, feedId, row.targetId, key),
        );
        secretsSet[key] = meta.set;
      }
      out[row.targetId] = {
        enabled: row.enabled,
        config: plainConfig(target, row.config),
        secretsSet,
      };
    }
    return out;
  },
});

/**
 * One target's whole config for a site's feed — the stored values with its
 * secrets read back, parsed against its declaration (defaults filled) — and
 * whether it is on. Null when never saved.
 */
export async function loadTargetSettings(
  deploymentId: string,
  feedId: string,
  target: SyndicationTargetContribution,
): Promise<{ enabled: boolean; config: Record<string, unknown> } | null> {
  const row = (await readRows(deploymentId, feedId)).find(
    (r) => r.targetId === target.target.id,
  );
  if (row === undefined) return null;
  return {
    enabled: row.enabled,
    config: await fullConfig(deploymentId, feedId, target, row.config, {}),
  };
}

async function fullConfig(
  deploymentId: string,
  feedId: string,
  target: SyndicationTargetContribution,
  stored: Record<string, unknown>,
  newSecrets: Record<string, string>,
): Promise<Record<string, unknown>> {
  const config: Record<string, unknown> = plainConfig(target, stored);
  for (const key of secretConfigKeys(target.target.configFields)) {
    config[key] =
      newSecrets[key] ??
      (await getSecret(
        secretRef(deploymentId, feedId, target.target.id, key),
      )) ??
      "";
  }
  return config;
}

export type SaveSettingsAnswer =
  | { kind: "saved" }
  | { kind: "invalid"; message: string }
  | { kind: "unknown-target"; targetId: string };

/**
 * Save one target's settings for a site's feed: `enabled` if given, and the
 * config values one edit changed merged onto the stored ones — a secret
 * field's value into the secrets store, the rest into the row. The merged
 * config must parse against the target's declaration, and an enabled target
 * must accept it (`validate`): otherwise nothing is saved.
 */
export async function saveTargetSettings(input: {
  deploymentId: string;
  feedId: string;
  targetId: string;
  enabled?: boolean;
  set: Record<string, unknown>;
}): Promise<SaveSettingsAnswer> {
  const target = syndicationTargetOf(input.targetId);
  if (target === null) {
    return { kind: "unknown-target", targetId: input.targetId };
  }
  const { configFields } = target.target;
  const unknown = Object.keys(input.set).filter((k) => !(k in configFields));
  if (unknown.length > 0) {
    return {
      kind: "invalid",
      message: `${target.target.label} has no setting ${unknown.join(", ")}.`,
    };
  }
  const secretKeys = new Set(secretConfigKeys(configFields));
  const newSecrets: Record<string, string> = {};
  const plainSet: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input.set)) {
    if (!secretKeys.has(k)) {
      plainSet[k] = v;
      continue;
    }
    if (typeof v !== "string") {
      return { kind: "invalid", message: `${k} must be text.` };
    }
    newSecrets[k] = v.trim();
  }

  const row = (await readRows(input.deploymentId, input.feedId)).find(
    (r) => r.targetId === input.targetId,
  );
  const stored = { ...(row?.config ?? {}), ...plainSet };
  const enabled = input.enabled ?? row?.enabled ?? false;
  const merged = await fullConfig(
    input.deploymentId,
    input.feedId,
    target,
    stored,
    newSecrets,
  );
  const parsed = target.target.configSchema.safeParse(merged);
  if (!parsed.success) {
    return {
      kind: "invalid",
      message: parsed.error.issues
        .map((i) => `${i.path.join(".") || "config"}: ${i.message}`)
        .join("; "),
    };
  }
  // An enabled target must be usable as configured; an off one may be half set up.
  const why = enabled
    ? (target.calls.validate?.(parsed.data as Record<string, unknown>) ?? null)
    : null;
  if (why !== null) return { kind: "invalid", message: why };

  for (const [k, v] of Object.entries(newSecrets)) {
    await setSecret(
      secretRef(input.deploymentId, input.feedId, input.targetId, k),
      v,
    );
  }
  const config = plainConfig(target, stored);
  await db
    .insert(_siteFeedSyndicationSettings)
    .values({
      deploymentId: deploymentIdKind.key(input.deploymentId),
      feedId: input.feedId,
      targetId: input.targetId,
      enabled,
      config,
    })
    .onConflictDoUpdate({
      target: [
        _siteFeedSyndicationSettings.deploymentId,
        _siteFeedSyndicationSettings.feedId,
        _siteFeedSyndicationSettings.targetId,
      ],
      set: { enabled, config },
    });
  syndicationSettingsServed.notify({
    deploymentId: input.deploymentId,
    feedId: input.feedId,
  });
  return { kind: "saved" };
}

/** The targets switched on for a site's feed that this app still provides. */
export async function enabledTargets(
  deploymentId: string,
  feedId: string,
): Promise<SyndicationTargetContribution[]> {
  return (await readRows(deploymentId, feedId))
    .filter((r) => r.enabled)
    .map((r) => syndicationTargetOf(r.targetId))
    .filter((t): t is SyndicationTargetContribution => t !== null);
}
