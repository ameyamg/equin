import {
  deploymentDestination,
  SITE_FEED_LOCAL_DESTINATION,
  type SiteFeedDestination,
  type SitePublishScope,
} from "../../core";

/**
 * Why THIS instance may not publish to deployed sites — or null on main.
 * A worktree's database is a fork of main's: it holds the production
 * deployments' rows, and its SSH reaches production, so a draft written there
 * would land on the real site. The Deploy button has no such rule (a deploy
 * from a worktree is scoped by `launched_from`), so this one is the feeds'
 * own: publishing to a deployed site is main's alone. This instance's own
 * copy (`local`) is published to from anywhere.
 */
export function remoteRefusal(onMain: boolean): string | null {
  return onMain
    ? null
    : "Publishing to deployed sites happens from the main checkout only — this worktree publishes to its own copy.";
}

export function publishScopeOf(onMain: boolean): SitePublishScope {
  const reason = remoteRefusal(onMain);
  return {
    remote: reason === null ? { kind: "allowed" } : { kind: "refused", reason },
  };
}

/** One copy of the site an item of a feed can be published to. */
export type ResolvedDestination =
  | {
      readonly destination: SiteFeedDestination;
      readonly kind: "local";
      /** The feed's page on this instance; null when it declares none. */
      readonly url: string | null;
      readonly refusal: null;
    }
  | {
      readonly destination: SiteFeedDestination;
      readonly kind: "deployment";
      readonly deploymentId: string;
      /** The feed's page on the deployed site; null with no hostname. */
      readonly url: string | null;
      /** Why it is not published to from here (off main); null: it is. */
      readonly refusal: string | null;
    };

/** A deployment as destination resolution reads it. */
export interface DestinationDeployment {
  readonly id: string;
  readonly compositionId: string;
  readonly hostnames: readonly string[];
}

/**
 * Where the site shows the feed: its first hostname plus the feed's
 * `pagePath` (the root when it declares none). Null for a site with no
 * hostname — reachable only on its server.
 */
export function deployedPageUrl(
  hostnames: readonly string[],
  pagePath: string | undefined,
): string | null {
  const host = hostnames.find((h) => !h.startsWith("*."));
  return host === undefined ? null : `https://${host}${pagePath ?? "/"}`;
}

/**
 * Every copy of the site an item of a feed goes to, in order: each
 * deployment whose composition ships the feed's declaring plugin (in the
 * order given — oldest first), then this instance. Pure: what ships and
 * whether this is main are the caller's reads.
 */
export function destinationsOf(input: {
  deployments: readonly DestinationDeployment[];
  /** The deployments whose composition closure includes the declaring plugin. */
  shipping: ReadonlySet<string>;
  onMain: boolean;
  pagePath: string | undefined;
  localUrl: string | null;
}): ResolvedDestination[] {
  const refusal = remoteRefusal(input.onMain);
  return [
    ...input.deployments
      .filter((d) => input.shipping.has(d.id))
      .map((d): ResolvedDestination => ({
        destination: deploymentDestination(d.id),
        kind: "deployment",
        deploymentId: d.id,
        url: deployedPageUrl(d.hostnames, input.pagePath),
        refusal,
      })),
    {
      destination: SITE_FEED_LOCAL_DESTINATION,
      kind: "local",
      url: input.localUrl,
      refusal: null,
    },
  ];
}

/**
 * The one destination whose success stands for the item's (what posting it
 * elsewhere waits on, and links to): the first deployment this instance
 * publishes to, else this instance.
 */
export function primaryDestination(
  destinations: readonly ResolvedDestination[],
): ResolvedDestination {
  const remote = destinations.find(
    (d) => d.kind === "deployment" && d.refusal === null,
  );
  const primary =
    remote ?? destinations.find((d) => d.kind === "local") ?? undefined;
  if (primary === undefined) {
    throw new Error("site-feeds: a feed has no destination, not even local");
  }
  return primary;
}

/** Which destinations a Publish fans out to: every one not refused. */
export function publishableDestinations(
  destinations: readonly ResolvedDestination[],
): ResolvedDestination[] {
  return destinations.filter((d) => d.refusal === null);
}
