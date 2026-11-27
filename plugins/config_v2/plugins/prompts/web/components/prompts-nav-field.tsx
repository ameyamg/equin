import { useMemo, type ReactNode } from "react";
import { useConfigRegistrations } from "@plugins/config_v2/web";
import type { ConfigNavFieldRead } from "@plugins/config_v2/plugins/settings/web";
import { readyResource } from "@plugins/network/plugins/live/plugins/live-state/web";
import { isPromptField } from "../../core";

/**
 * Reads the config nav's `prompts` field (`ConfigNavSlots.Field`): the configs
 * holding at least one prompt field — every agent prompt the user can edit,
 * whichever plugin owns it. Known at once: it is read off the registered
 * descriptors, which every browser has.
 */
export function PromptsNavField({
  children,
}: {
  children: (read: ConfigNavFieldRead) => ReactNode;
}) {
  const registrations = useConfigRegistrations();
  const read = useMemo(
    () =>
      readyResource<ReadonlySet<string>>(
        new Set(
          registrations
            .filter((r) =>
              Object.values(r.descriptor.fields).some(isPromptField),
            )
            .map((r) => r.storePath),
        ),
      ),
    [registrations],
  );
  return children(read);
}
