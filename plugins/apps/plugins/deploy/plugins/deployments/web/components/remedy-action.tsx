import type { ReactElement } from "react";
import { Button } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { useOpenPane } from "@plugins/primitives/plugins/pane/web";
import { accountPane, useAccountName } from "@plugins/auth/web";
import type { DeployRemedy } from "../../core";

/**
 * A refused run's remedy as the action itself: the button that takes the user
 * to where the refusal is cleared. Derived from the run's typed `remedy`
 * (`DeployRemedy`, read from the CLI's remedy line), never from its sentence —
 * so every surface showing a failed run offers the same fix, and none names
 * the account it leads to.
 */
export function RemedyAction({
  remedy,
}: {
  remedy: DeployRemedy | null;
}): ReactElement | null {
  if (remedy === null) return null;
  switch (remedy.kind) {
    case "account":
      return <OpenAccount accountId={remedy.accountId} />;
  }
}

/** Open the account's pane in Settings → Accounts, named by its own contribution. */
function OpenAccount({ accountId }: { accountId: string }): ReactElement {
  const openPane = useOpenPane();
  const name = useAccountName({ accountId }) ?? accountId;
  return (
    <Button
      variant="outline"
      {...openPane.link(accountPane, { accountId }, { mode: "root" })}
    >
      Open {name} in Settings
    </Button>
  );
}
