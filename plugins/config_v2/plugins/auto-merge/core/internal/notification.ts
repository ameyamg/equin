import { z } from "zod";

/** The update notification's type and its action kind (web: `Notifications.Action`). */
export const AUTO_MERGE_NOTIFICATION_TYPE = "config-auto-merge";
export const AUTO_MERGE_ACTION_KIND = "config-auto-merge";

/** What the notification's action reads back: the merges it announced. */
export const autoMergePayloadSchema = z.object({
  targets: z
    .array(
      z.object({
        storePath: z.string(),
        scopeId: z.string().optional(),
        recordId: z.string(),
      }),
    )
    .max(500),
});
export type AutoMergePayload = z.infer<typeof autoMergePayloadSchema>;

/** The notification's line 2: which configs, in the user's words. */
export function autoMergeDescription(names: readonly string[]): string {
  const shown = names.slice(0, 3).join(", ");
  const more = names.length - 3;
  return `Your changes were kept: ${shown}${more > 0 ? ` and ${more} more` : ""}.`;
}

/** A config's name as the user knows it: the plugin it belongs to, then the config. */
export function configDisplayName(storePath: string, scopeId?: string): string {
  const parts = storePath.replace(/\.jsonc$/, "").split("/");
  const name = parts.pop()!;
  const owner = parts.at(-1) ?? name;
  const label =
    name === "config" || name === owner ? owner : `${owner} › ${name}`;
  return scopeId ? `${label} (${scopeId.replace(/^app:/, "")})` : label;
}
