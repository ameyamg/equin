import type { BoxLink } from "@plugins/apps/plugins/deploy/plugins/box-link/core";
import type { ProbedPublicPath } from "../../core";

// The links this instance holds, in memory: written by the link manager
// alone, read by the served values' loaders.
const links = new Map<string, BoxLink>();

export function currentLinks(): Record<string, BoxLink> {
  return Object.fromEntries(links);
}

export function linkOf(deploymentId: string): BoxLink | undefined {
  return links.get(deploymentId);
}

export function setLink(link: BoxLink): void {
  links.set(link.deploymentId, link);
}

export function dropLink(deploymentId: string): boolean {
  realBoxes.delete(deploymentId);
  publicPaths.delete(deploymentId);
  return links.delete(deploymentId);
}

// Which linked deployments are on a REAL box (over SSH, or blocked from
// dialing) rather than a demo's stand-in (this instance itself): the ones
// the public-path probe watches.
const realBoxes = new Set<string>();

export function setRealBox(deploymentId: string, real: boolean): void {
  if (real) realBoxes.add(deploymentId);
  else realBoxes.delete(deploymentId);
}

/** The linked deployments on a real box (main only links any). */
export function realBoxDeploymentIds(): string[] {
  return [...realBoxes];
}

export function isRealBox(deploymentId: string): boolean {
  return realBoxes.has(deploymentId);
}

export function linkedDeploymentIds(): string[] {
  return [...links.keys()];
}

// The public paths this instance probes (the public-path probe's records),
// in memory: written by the probe alone (and its boot read-back).
const publicPaths = new Map<string, ProbedPublicPath>();

export function publicPathOf(
  deploymentId: string,
): ProbedPublicPath | undefined {
  return publicPaths.get(deploymentId);
}

export function setPublicPath(
  deploymentId: string,
  path: ProbedPublicPath,
): void {
  publicPaths.set(deploymentId, path);
}
