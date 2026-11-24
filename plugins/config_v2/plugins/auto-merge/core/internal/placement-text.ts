import type {
  MergePlacement,
  PlacementSkipReason,
} from "@plugins/config_v2/core";

const SKIP_REASON: Record<PlacementSkipReason, string> = {
  "no-claude-account": "no Claude account can run on this computer",
  "usage-limit": "the Claude account was at its usage limit",
  failed: "the model call failed",
  undone: "the merge was undone",
  superseded: "a later update replaced the merge",
  edited: "you changed the lists since",
};

/**
 * The placement job's decision on one merge, in one line — the developer
 * review's header: whether a model re-placed the rows the update added, kept
 * the merge's order, had its answer refused, or was never asked (and why).
 * Null when the merge placed no new row among yours.
 */
export function placementSummary(placement: MergePlacement): string | null {
  switch (placement.status) {
    case "not-needed":
      return null;
    case "pending":
      return "New items placed after their neighbour; a model is placing them…";
    case "skipped":
      return `New items placed after their neighbour; not re-placed: ${SKIP_REASON[placement.reason]}.`;
    case "decided": {
      const count = (v: string) =>
        placement.results.filter((r) => r.verdict === v).length;
      const parts = [
        count("moved") > 0 && `moved new items in ${count("moved")} list(s)`,
        count("same") > 0 && `kept the merge's order in ${count("same")}`,
        count("rejected") > 0 &&
          `answer refused in ${count("rejected")} (merge's order kept)`,
        count("edited") > 0 && `${count("edited")} changed since, left alone`,
      ].filter(Boolean);
      return `Placement (${placement.model}): ${parts.join(", ")}.`;
    }
  }
}

/**
 * Per placed list, a note under the top-level field it sits in: where the
 * list is below the field, and what the placement did there.
 */
export function placementNotes(
  placement: MergePlacement,
): { field: string; text: string }[] {
  if (placement.status === "not-needed") return [];
  const at = (path: readonly string[]) =>
    path.length > 1 ? ` at ${path.slice(1).join(".")}` : "";
  if (placement.status !== "decided") {
    return placement.lists.map((l) => ({
      field: l.path[0]!,
      text: `new ${l.movable.join(", ")} placed after neighbour${at(l.path)}`,
    }));
  }
  return placement.results.map((r) => {
    const list = placement.lists.find(
      (l) => JSON.stringify(l.path) === JSON.stringify(r.path),
    );
    const moved = list?.movable.join(", ") ?? "";
    const text =
      r.verdict === "moved"
        ? `model placed ${moved}${at(r.path)}`
        : r.verdict === "same"
          ? `model kept the merge's place for ${moved}${at(r.path)}`
          : r.verdict === "rejected"
            ? `model's order refused${at(r.path)}: ${r.reason ?? "invalid"}`
            : `not re-placed${at(r.path)}: changed since`;
    return { field: r.path[0]!, text };
  });
}
