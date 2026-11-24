import { useToast } from "@plugins/shell/plugins/notifications/web";

/** Say which merges Undo could not put back, and why (the registry's words). */
export function useAnnounceRefused(): (
  refused: { storePath: string; reason: string }[],
) => void {
  const toast = useToast();
  return (refused) => {
    if (refused.length === 0) return;
    toast({
      type: "config-auto-merge-undo-refused",
      category: "other",
      variant: "warning",
      title:
        refused.length === 1
          ? "One setting could not be undone"
          : `${refused.length} settings could not be undone`,
      description: refused.map((r) => r.reason).join(" "),
    });
  };
}
