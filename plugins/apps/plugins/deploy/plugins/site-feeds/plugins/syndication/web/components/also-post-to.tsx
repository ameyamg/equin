import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { FieldDef, FieldsRecord } from "@plugins/fields/core";
import { boolField } from "@plugins/fields/plugins/bool/plugins/config/core";
import { FieldsForm } from "@plugins/config_v2/plugins/fields/web";
import { SecretFieldStatusContext } from "@plugins/fields/plugins/secret/plugins/config/web";
import { useLive } from "@plugins/network/plugins/live/web";
import { matchResource } from "@plugins/network/plugins/live/plugins/live-state/web";
import { useEndpointMutation } from "@plugins/infra/plugins/endpoints/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";
import {
  SectionLabel,
  Text,
} from "@plugins/primitives/plugins/css/plugins/text/web";
import { Icon } from "@plugins/ui/plugins/icons/web";
import type { SiteFeedCardProps } from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/editor/web";
import {
  defaultTargetSettings,
  secretConfigKeys,
  syndicationTargetSettings,
  type SyndicationTargetDecl,
  type SyndicationTargetSettings,
} from "../../core";
import { saveSyndicationSettings, sendTestPost } from "../../shared";
import { Button } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { SyndicationTargets } from "../slots";

type TestPostResult =
  | { kind: "posted"; remoteId: string; url?: string }
  | { kind: "failed"; error: string };

/**
 * **Also post to** — under a feed's items: every target this app provides,
 * each switched on or off for this feed and set up with its own
 * fields. A feed whose declaration has no `syndicate` says it cannot be.
 */
export function AlsoPostTo({ feed, openItemId }: SiteFeedCardProps): ReactNode {
  const targets = SyndicationTargets.Target.useContributions();
  const settings = useLive(
    syndicationTargetSettings,
    feed.syndicate === undefined ? null : { feedId: feed.id },
  );
  return (
    <Stack gap="sm">
      <SectionLabel>Also post to</SectionLabel>
      {feed.syndicate === undefined ? (
        <Text as="p" variant="caption" tone="muted">
          This feed can&apos;t be cross-posted: its declaration names no fields
          to post (no <code>syndicate</code>).
        </Text>
      ) : targets.length === 0 ? (
        <Text as="p" variant="caption" tone="muted">
          No service to post to: no plugin of this app provides one.
        </Text>
      ) : (
        matchResource(settings, {
          ready: (all) => (
            <Stack gap="md">
              {targets.map(({ target }) => (
                <TargetSettings
                  key={target.id}
                  feedId={feed.id}
                  openItemId={openItemId}
                  target={target}
                  settings={all[target.id] ?? defaultTargetSettings()}
                />
              ))}
            </Stack>
          ),
        })
      )}
    </Stack>
  );
}

/** The switch heading a target's own fields: one form, so it renders like them. */
const ENABLED_KEY = "enabled";

function TargetSettings({
  feedId,
  openItemId,
  target,
  settings,
}: {
  feedId: string;
  openItemId: string | null;
  target: SyndicationTargetDecl;
  settings: SyndicationTargetSettings;
}): ReactNode {
  const save = useEndpointMutation(saveSyndicationSettings);
  const [refusal, setRefusal] = useState<string | null>(null);

  const fields = useMemo<FieldsRecord>(
    () => ({
      [ENABLED_KEY]: boolField({ label: `Post to ${target.label}` }),
      ...target.configFields,
    }),
    [target],
  );
  // A secret is never read back: its field says set / unset, by def.
  const secretOf = useMemo(() => {
    const byDef = new Map<FieldDef<string>, string>();
    for (const key of secretConfigKeys(target.configFields)) {
      byDef.set(target.configFields[key] as FieldDef<string>, key);
    }
    return byDef;
  }, [target]);
  const { secretsSet } = settings;
  const isSet = useCallback(
    (field: FieldDef<string>): boolean => {
      const key = secretOf.get(field);
      return key !== undefined && secretsSet[key] === true;
    },
    [secretOf, secretsSet],
  );

  // Stored values through the declaration (a field added since takes its
  // default); a secret's value is never here.
  const defaults = target.configSchema.safeParse({});
  const values: Record<string, unknown> = {
    ...(defaults.success ? (defaults.data as Record<string, unknown>) : {}),
    ...settings.config,
    ...Object.fromEntries([...secretOf.values()].map((k) => [k, ""])),
    [ENABLED_KEY]: settings.enabled,
  };

  if (save.kind === "unavailable") {
    return (
      <Text as="p" variant="caption" tone="muted">
        {save.message}
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      <Line gap="xs">
        <Icon icon={target.icon} />
        <Text variant="label">{target.label}</Text>
      </Line>
      <SecretFieldStatusContext.Provider value={isSet}>
        <FieldsForm
          fields={fields}
          values={values}
          onChange={(key, value) => {
            const body =
              key === ENABLED_KEY
                ? { enabled: value === true, set: {} }
                : { set: { [key]: value } };
            save.mutate(
              {
                body: {
                  feedId,
                  targetId: target.id,
                  ...body,
                },
              },
              {
                onSuccess: (answer) =>
                  setRefusal(
                    answer.kind === "saved"
                      ? null
                      : answer.kind === "invalid"
                        ? `Not saved: ${answer.message}`
                        : `No plugin provides "${answer.targetId}" any more.`,
                  ),
              },
            );
          }}
        />
      </SecretFieldStatusContext.Provider>
      {refusal !== null && (
        <Text as="p" variant="caption" tone="destructive">
          {refusal}
        </Text>
      )}
      <TestPost feedId={feedId} targetId={target.id} openItemId={openItemId} />
    </Stack>
  );
}

/**
 * **Send test post** — the item open above, posted to this target NOW with
 * its settings as saved (on or off), recording nothing: the target's answer
 * is shown — its post's link when it gives one. Point it at a private
 * channel: the post stays there.
 */
function TestPost({
  feedId,
  targetId,
  openItemId,
}: {
  feedId: string;
  targetId: string;
  openItemId: string | null;
}): ReactNode {
  const test = useEndpointMutation(sendTestPost);
  const [answer, setAnswer] = useState<TestPostResult | null>(null);
  if (test.kind === "unavailable") return null;
  return (
    <Stack gap="2xs">
      <Line gap="xs">
        <Button
          variant="outline"
          disabled={openItemId === null}
          tooltip={
            openItemId === null
              ? "Open an item to send it as a test"
              : undefined
          }
          onClick={async () => {
            if (openItemId === null) return;
            setAnswer(
              await test.mutateAsync({
                body: { feedId, targetId, itemId: openItemId },
              }),
            );
          }}
        >
          Send test post
        </Button>
        {openItemId === null && (
          <Text variant="caption" tone="muted">
            Open an item to send it
          </Text>
        )}
      </Line>
      {answer?.kind === "posted" && (
        <Text as="p" variant="caption" tone="muted" data-test-post="posted">
          Posted (not recorded).{" "}
          {answer.url !== undefined ? (
            <a href={answer.url} target="_blank" rel="noopener noreferrer">
              {answer.url}
            </a>
          ) : (
            `Its id there: ${answer.remoteId}`
          )}
        </Text>
      )}
      {answer?.kind === "failed" && (
        <Text
          as="p"
          variant="caption"
          tone="destructive"
          data-test-post="failed"
        >
          Not posted: {answer.error}
        </Text>
      )}
    </Stack>
  );
}
