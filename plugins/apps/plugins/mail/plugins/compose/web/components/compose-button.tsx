import type { ReactNode } from "react";
import { Button } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import { useOpenCompose } from "../internal/use-draft";

const composeIcon = symbol("edit");

/** The sidebar's Compose (the prototype's): opens a compose window on a new draft. */
export function ComposeButton({
  className,
}: {
  className?: string;
}): ReactNode {
  const openCompose = useOpenCompose();
  return (
    <Button
      variant="outline"
      className={className}
      onClick={() => openCompose({ kind: "new" })}
    >
      <Icon icon={composeIcon} className="text-primary-text" />
      Compose
    </Button>
  );
}
