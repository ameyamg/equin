import { parseDestination, type SiteFeedDestination } from "../../core";
import type { ResolvedDestination } from "../../server";
import { remoteRefusal } from "../../server/internal/destination-rules";

/**
 * Where a Publish goes. No `requested`: every destination this instance
 * publishes to (a refused one — a deployment, off main — is left out, and
 * shows its refusal in the UI). One `requested`: that one, if it is a copy of
 * the site serving the feed and not refused.
 */
export function publishTargets(
  destinations: readonly ResolvedDestination[],
  requested: SiteFeedDestination | undefined,
):
  | { kind: "queue"; destinations: SiteFeedDestination[] }
  | { kind: "refused"; message: string } {
  if (requested === undefined) {
    return {
      kind: "queue",
      destinations: destinations
        .filter((d) => d.refusal === null)
        .map((d) => d.destination),
    };
  }
  const match = destinations.find((d) => d.destination === requested);
  if (match === undefined) {
    return {
      kind: "refused",
      message: `${requested} is not a copy of the site serving this feed (its composition does not ship the feed, or it no longer exists).`,
    };
  }
  if (match.refusal !== null)
    return { kind: "refused", message: match.refusal };
  return { kind: "queue", destinations: [match.destination] };
}

/**
 * What one (item, destination) run does, from what the user wants of the
 * item NOW (never from what queued the run) and whether a publication row
 * stands for it there:
 *
 * | item | row | → |
 * |---|---|---|
 * | published | yes | `publish` (upsert — a first publish, an edit, a retry) |
 * | draft | yes | `unpublish` (delete there, then the row goes) |
 * | either | no | `nothing` (never queued there, or already gone) |
 */
export function decidePublication(input: {
  wanted: boolean;
  held: boolean;
}): "publish" | "unpublish" | "nothing" {
  if (!input.held) return "nothing";
  return input.wanted ? "publish" : "unpublish";
}

/**
 * How one run reaches its destination. A deployment is refused off main
 * (`remoteRefusal`): a worktree's database holds production's deployment
 * rows, and no run from a worktree ever opens SSH to one. The job's own
 * check, under the fan-out's (which never queues a refused destination): a
 * row queued on main and run in a worktree restored from it still stops here.
 */
export function routeDestination(
  destination: SiteFeedDestination,
  onMain: boolean,
):
  | { kind: "local" }
  | { kind: "deployment"; deploymentId: string }
  | { kind: "refused"; message: string } {
  const target = parseDestination(destination);
  if (target.kind === "local") return target;
  const refusal = remoteRefusal(onMain);
  return refusal === null ? target : { kind: "refused", message: refusal };
}
