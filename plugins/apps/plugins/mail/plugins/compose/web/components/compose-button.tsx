import type { ReactNode } from "react";
import {
  Button,
  cn,
  ControlSizeProvider,
} from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
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
    // The prototype's `.compose`: a raised 34px button ringed in the input
    // line, its pen in the accent.
    <ControlSizeProvider size="lg">
    <Button
        variant="secondary"
        // In the sidebar's icon rail (`rail:`) the pen alone.
        className={cn(
          "font-semibold ring-1 ring-input ring-inset rail:px-none",
          className,
        )}
      onClick={() => openCompose({ kind: "new" })}
    >
      <Icon icon={composeIcon} className="text-primary-text" />
        <span className="rail:sr-only">Compose</span>
    </Button>
    </ControlSizeProvider>
  );
}
