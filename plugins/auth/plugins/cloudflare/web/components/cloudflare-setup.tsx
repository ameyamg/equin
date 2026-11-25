import { useState } from "react";
import { transient } from "@plugins/primitives/plugins/kept-state/core";
import {
  Button,
  Input,
} from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import {
  Steps,
  Step,
  StepLink,
  StepDone,
  StepNote,
} from "@plugins/primitives/plugins/setup-steps/web";
import {
  getEndpointErrorMessage,
  useFetchEndpoint,
} from "@plugins/infra/plugins/endpoints/web";
import { setApiKey } from "@plugins/auth/core";
import { useAccountStatus } from "@plugins/auth/web";
import {
  foldResource,
  ResourceErrorInline,
} from "@plugins/network/plugins/live/plugins/live-state/web";
import {
  CLOUDFLARE_PROVIDER_ID,
  CLOUDFLARE_TOKENS_URL,
  CLOUDFLARE_TOKEN_PERMISSIONS,
} from "../../core";

/** The Cloudflare token setup, rendered inline in its Accounts pane (`setup: { kind: "steps" }`). */
export function CloudflareSetup() {
  const fetchEndpoint = useFetchEndpoint();
  const [token, setToken] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const status = useAccountStatus(CLOUDFLARE_PROVIDER_ID);
  const connected = foldResource(status, {
    loading: () => false,
    error: () => false,
    unavailable: () => false,
    ready: (account) => account?.connected ?? false,
  });

  async function save() {
    setSaveError(null);
    try {
      await fetchEndpoint(
        setApiKey,
        { provider: CLOUDFLARE_PROVIDER_ID },
        { body: { apiKey: token } },
      );
      setToken("");
    } catch (err) {
      // Central asks Cloudflare whether the token is live before storing it,
      // so a mistyped or revoked token fails HERE, in Cloudflare's words.
      setSaveError(getEndpointErrorMessage(err));
    }
  }

  return (
    <Steps>
      <Step title="Create a Custom Token" state={connected ? "done" : "active"}>
        <Stack gap="sm">
          <StepLink href={CLOUDFLARE_TOKENS_URL} />
          <StepNote>
            Create Token → Custom token. Permissions:{" "}
            {CLOUDFLARE_TOKEN_PERMISSIONS.join(", ")}. Zone Resources: Include ·
            Specific zone · your site&apos;s zone. Deploys use it to find the
            zone and to purge the site&apos;s cached pages after every ship; it
            can change nothing else.
          </StepNote>
        </Stack>
      </Step>

      <Step title="Paste the token" state={connected ? "done" : "active"}>
        <Stack gap="sm">
          {status.status === "error" && (
            <ResourceErrorInline
              variant="inline"
              subject="whether a token is stored"
              error={status.error}
              refetch={status.refetch}
            />
          )}
          {connected ? <StepDone>Token stored and active</StepDone> : null}
          <Input
            type="password"
            placeholder="Cloudflare API token"
            keep={transient("secret: never written to browser storage")}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <Button variant="default" disabled={!token} onClick={save}>
            {connected ? "Replace token" : "Save token"}
          </Button>
          {saveError ? (
            <Text as="p" variant="caption" className="text-destructive">
              {saveError}
            </Text>
          ) : null}
        </Stack>
      </Step>
    </Steps>
  );
}
