import { useLive } from "@plugins/network/plugins/live/web";
import {
  mapResource,
  useCombinedResources,
} from "@plugins/network/plugins/live/plugins/live-state/web";
import {
  upstreamPublication,
  upstreamPublisherStatus,
  type GitHubPublication,
  type PublisherStatus,
} from "@plugins/upstream/plugins/release/core";
import type { PublisherView } from "./releases-view";
import type { Read } from "./updates-view";

/**
 * The releases row's read: the publisher status, joined with what GitHub
 * published of its newest release (read once the status names the tag).
 * Ready only once both are — the row never claims a GitHub state it has
 * not read; a failed read of either is the row's failure.
 */
export function usePublisher(): Read<PublisherView> {
  const status = useLive(upstreamPublisherStatus);
  const latest =
    status.status === "ready" && status.data.kind === "publisher"
      ? status.data.latest
      : null;
  const publication = useLive(
    upstreamPublication,
    latest === null ? null : { tag: latest.tag },
  );
  const both = useCombinedResources({ status, publication });
  if (latest === null) return mapResource(status, (s) => joined(s, null));
  return mapResource(both, (b) => joined(b.status, b.publication));
}

function joined(
  status: PublisherStatus,
  github: GitHubPublication | null,
): PublisherView {
  return status.kind === "publisher" ? { ...status, github } : status;
}
