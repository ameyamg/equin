import type { ReactElement } from "react";
import { GrantAccessButton } from "@plugins/auth/web";
import { PUBSUB_SCOPES } from "../../core";

/** Asks Google for the Pub/Sub scope on the connected account, in a popup (other granted scopes are kept). */
export function PubSubGrantButton({
  label = "Grant Pub/Sub access",
}: {
  label?: string;
}): ReactElement {
  return (
    <GrantAccessButton
      providerId="google"
      scopes={[...PUBSUB_SCOPES]}
      label={label}
      variant="default"
    />
  );
}
