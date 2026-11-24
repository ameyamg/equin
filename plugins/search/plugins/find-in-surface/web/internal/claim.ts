import { generatesBox } from "@plugins/primitives/plugins/dom/plugins/box-presence/web";

/**
 * Which mounted find region a Ctrl+F belongs to.
 *
 * Several are mounted at once: two panes side by side in one tab (one surface,
 * so the surface gate cannot tell them apart), and every hidden tab. The key
 * goes to ONE of them:
 *
 * 1. the region (or its open bar) holding the focus;
 * 2. else the visible region the pointer last pressed in;
 * 3. else the only visible region.
 *
 * Otherwise nobody claims it, and the browser's own find opens — better than
 * opening a bar in a pane the reader did not mean.
 */
export interface FindClaimant {
  root(): HTMLElement | null;
  bar(): HTMLElement | null;
}

const mounted = new Set<FindClaimant>();
let lastPressed: FindClaimant | null = null;

export function mountClaimant(c: FindClaimant): () => void {
  mounted.add(c);
  return () => {
    mounted.delete(c);
    if (lastPressed === c) lastPressed = null;
  };
}

export function pressedIn(c: FindClaimant): void {
  lastPressed = c;
}

/** A region is visible when any box inside it is drawn (the root itself has none: `display: contents`). */
function visible(c: FindClaimant): boolean {
  const root = c.root();
  if (!root?.isConnected) return false;
  for (const child of root.children) if (generatesBox(child)) return true;
  return false;
}

export function claimantOf(target: EventTarget | null): FindClaimant | null {
  const shown = [...mounted].filter(visible);
  if (target instanceof Node) {
    const holder = shown.find(
      (c) => c.root()!.contains(target) || (c.bar()?.contains(target) ?? false),
    );
    if (holder) return holder;
  }
  if (lastPressed && shown.includes(lastPressed)) return lastPressed;
  return shown.length === 1 ? shown[0]! : null;
}
