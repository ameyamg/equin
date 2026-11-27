import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";

export {
  createInViewWatcher,
  useInView,
  type InViewOptions,
  type InViewRoot,
  type InViewTarget,
  type InViewWatcher,
} from "./internal/in-view";
export {
  MountWhenNear,
  type MountWhenNearProps,
} from "./internal/mount-when-near";
export { useNear, type UseNearOptions } from "./internal/use-near";

export default {
  description:
    "The one sanctioned home for new IntersectionObserver: createInViewWatcher(onChange, options) is the DOM layer, owning the WeakSet enrollment rule so a re-enrollment pass costs nothing, and useInView(target, onChange, {deps}) is the React layer — observes one element, hands the most recent entry of each batch to a stabilised callback, and rebuilds the observer only when deps change (the rebuild is what re-delivers against a still-intersecting element). <MountWhenNear fallback scrollRoot?> mounts a heavy section only once its box nears the visible part of its scroller, then keeps it (a dashboard pays for what is on screen, not for every section below the fold). useNear(boxRef, {rootMargin?, scrollRoot?}) is the non-latching read: whether the box is near the visible part of its scroller now, following it both ways (false in a hidden subtree) — for what a list row holds only while it can be seen, such as its live reads.",
  contributions: [],
} satisfies PluginDefinition;
