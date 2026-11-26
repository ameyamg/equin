import { useState, type ReactElement } from "react";
import { transient } from "@plugins/primitives/plugins/kept-state/core";
import {
  Button,
  Input,
} from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import {
  foldResource,
  ResourceErrorInline,
} from "@plugins/network/plugins/live/plugins/live-state/web";
import { useLive } from "@plugins/network/plugins/live/web";
import {
  Step,
  StepDone,
  StepLink,
  StepNote,
  Steps,
} from "@plugins/primitives/plugins/setup-steps/web";
import {
  getEndpointErrorMessage,
  useFetchEndpoint,
} from "@plugins/infra/plugins/endpoints/web";
import {
  PubSubGrantButton,
  usePubSubAccess,
  type PubSubAccess,
} from "@plugins/integrations/plugins/google-pubsub/web";
import {
  disableGmailPush,
  enableGmailPush,
  GCP_PROJECT_ID,
  gmailPushStatus,
  type GmailPushSetupResult,
  type GmailPushStatus,
} from "../../core";

const CONSOLE = "https://console.cloud.google.com";

/**
 * Instant updates (Gmail push), in the Accounts pane: before setup, the
 * steps — the Pub/Sub scope, the project (the one holding the OAuth client),
 * then Enable, which creates everything through the API; once set up, where
 * it stands and Turn off.
 */
export function GmailPushSetup(): ReactElement {
  const status = useLive(gmailPushStatus);
  const access = usePubSubAccess();
  // Only a read that can fail can be retried (an unavailable one never errors).
  const refetchAccess =
    access.status === "unavailable" ? async () => {} : access.refetch;
  return foldResource(status, {
    loading: () => <Loading variant="rows" count={3} />,
    error: (error) => (
      <ResourceErrorInline
        variant="block"
        subject="the instant-updates state"
        error={error}
        refetch={status.refetch}
      />
    ),
    ready: (s) =>
      s.setup !== null ? (
        <PushOn status={s} />
      ) : (
        foldResource(access, {
          loading: () => <Loading variant="rows" count={3} />,
          error: (error) => (
            <ResourceErrorInline
              variant="block"
              subject="the Google account's access"
              error={error}
              refetch={refetchAccess}
            />
          ),
          unavailable: (message) => (
            <Text variant="body" tone="muted">
              {message}
            </Text>
          ),
          ready: (a) => <EnableSteps access={a} main={s.main} />,
        })
      ),
  });
}

function EnableSteps({
  access,
  main,
}: {
  access: PubSubAccess;
  main: boolean;
}): ReactElement {
  const fetchEndpoint = useFetchEndpoint();
  const [projectId, setProjectId] = useState("");
  const [result, setResult] = useState<GmailPushSetupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const trimmed = projectId.trim();
  const valid = GCP_PROJECT_ID.test(trimmed);
  const granted = access === "granted";

  async function enable() {
    setError(null);
    setResult(null);
    try {
      setResult(
        await fetchEndpoint(
          enableGmailPush,
          {},
          { body: { projectId: trimmed } },
        ),
      );
    } catch (err) {
      setError(getEndpointErrorMessage(err));
    }
  }

  return (
    <Stack gap="xl">
      <Text as="p" variant="caption" className="text-muted-foreground">
        Without instant updates, Mail checks Gmail for changes on a timer while
        it is open. With them, Gmail tells this computer the moment something
        changes, through Google Cloud Pub/Sub in your own project — nothing has
        to be reachable from the internet.
        {main
          ? ""
          : " This is a worktree: it gets its own subscription, which Google deletes a day after the worktree stops using it."}
      </Text>
      <Steps>
        <Step title="Grant Pub/Sub access" state={granted ? "done" : "active"}>
          <Stack gap="sm">
            {granted ? (
              <StepDone>Pub/Sub access granted</StepDone>
            ) : access === "disconnected" ? (
              <StepNote>
                Connect your Google account first (Google, above).
              </StepNote>
            ) : (
              <Stack direction="row" gap="sm">
                <PubSubGrantButton />
              </Stack>
            )}
            <StepNote>
              Lets this computer create a topic and a subscription in your
              project, and read the change notifications Gmail publishes.
            </StepNote>
          </Stack>
        </Step>
        <Step
          title="Turn on the Cloud Pub/Sub API"
          state={granted ? "active" : "upcoming"}
        >
          <Stack gap="sm">
            <StepLink
              href={`${CONSOLE}/apis/library/pubsub.googleapis.com${valid ? `?project=${trimmed}` : ""}`}
            />
            <StepNote>
              In the project that holds your Google OAuth client — Gmail only
              publishes to a topic in that project. Pub/Sub&apos;s free tier
              covers this many times over.
            </StepNote>
          </Stack>
        </Step>
        <Step title="Enable" state={granted ? "active" : "upcoming"}>
          <Stack gap="sm">
            <Input
              placeholder="my-project-123"
              keep={transient("a project id typed once, sent with Enable")}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            />
            {trimmed && !valid ? (
              <Text as="p" variant="caption" className="text-destructive">
                A project ID: 6–30 lowercase letters, digits and hyphens,
                starting with a letter.
              </Text>
            ) : null}
            <Stack direction="row" gap="sm">
              <Button
                variant="default"
                disabled={!valid || !granted}
                onClick={enable}
              >
                Enable instant updates
              </Button>
            </Stack>
            <SetupOutcome result={result} />
            {error ? (
              <Text as="p" variant="caption" className="text-destructive">
                {error}
              </Text>
            ) : null}
          </Stack>
        </Step>
      </Steps>
    </Stack>
  );
}

function SetupOutcome({
  result,
}: {
  result: GmailPushSetupResult | null;
}): ReactElement | null {
  if (result === null || result.kind === "enabled") return null;
  switch (result.kind) {
    case "needs-scope":
      return (
        <Stack gap="sm">
          <Text as="p" variant="caption" className="text-destructive">
            Google has not granted Pub/Sub access on this connection yet.
          </Text>
          <Stack direction="row" gap="sm">
            <PubSubGrantButton />
          </Stack>
        </Stack>
      );
    case "api-disabled":
      return (
        <Stack gap="sm">
          <Text as="p" variant="caption" className="text-destructive">
            The Cloud Pub/Sub API is off in this project. Turn it on, wait a
            minute, then Enable again.
          </Text>
          {result.activationUrl ? (
            <StepLink href={result.activationUrl} />
          ) : null}
        </Stack>
      );
    case "needs-gmail":
      return (
        <Text as="p" variant="caption" className="text-destructive">
          Gmail access is not granted on this Google connection (Google, above):{" "}
          {result.message}
        </Text>
      );
    case "unreachable":
      return (
        <Text as="p" variant="caption" className="text-destructive">
          Could not reach Google — try again: {result.message}
        </Text>
      );
    case "refused":
      return (
        <Stack gap="xs">
          <Text as="p" variant="caption" className="text-destructive">
            Google refused the {result.step} step: {result.message}
          </Text>
          {result.step === "watch" ? (
            <StepNote>
              Gmail&apos;s permission to publish to the new topic can take a
              minute or two to apply: Enable again shortly. If it keeps failing,
              check the project is the one holding your Google OAuth client.
            </StepNote>
          ) : null}
        </Stack>
      );
  }
}

function PushOn({ status }: { status: GmailPushStatus }): ReactElement {
  const fetchEndpoint = useFetchEndpoint();
  const [error, setError] = useState<string | null>(null);
  const setup = status.setup!;
  const s = status.state;
  async function turnOff() {
    setError(null);
    try {
      await fetchEndpoint(disableGmailPush, {});
    } catch (err) {
      setError(getEndpointErrorMessage(err));
    }
  }
  return (
    <Stack gap="lg">
      {s.kind === "live" ? (
        <StepDone>Instant updates on — changes arrive as they happen</StepDone>
      ) : s.kind === "down" ? (
        <Text as="p" variant="caption" className="text-destructive">
          Not delivering since {new Date(s.since).toLocaleString()}: {s.message}
          . Mail checks every 30 seconds meanwhile; this reconnects by itself.
        </Text>
      ) : (
        <Text as="p" variant="caption" className="text-muted-foreground">
          Connecting…
        </Text>
      )}
      <Stack gap="xs">
        <Text as="p" variant="caption" className="text-muted-foreground">
          Project {setup.projectId} · subscription{" "}
          {setup.subscription.split("/").at(-1)}
          {setup.watchExpiresAt
            ? ` · Gmail watch renews before ${new Date(setup.watchExpiresAt).toLocaleDateString()}`
            : ""}
        </Text>
      </Stack>
      <Stack direction="row" gap="sm">
        <Button variant="outline" onClick={turnOff}>
          Turn off instant updates
        </Button>
      </Stack>
      {error ? (
        <Text as="p" variant="caption" className="text-destructive">
          {error}
        </Text>
      ) : null}
    </Stack>
  );
}
