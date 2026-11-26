import { useCallback, useLayoutEffect, useState } from "react";
import { z } from "zod";
import {
  defineStore,
  useStore,
} from "@plugins/primitives/plugins/dom/plugins/web-storage/web";
import { listenForNavigation } from "./announce-navigation";
import { useScrollRevival } from "./scroll-revival";
import { generatesBox } from "@plugins/primitives/plugins/dom/plugins/box-presence/web";
import {
  beginReloadRestore,
  claimKeptKey,
  claimSharedKey,
  markKept,
  watchFollower,
  type FollowerMark,
} from "./scroller-marks";

/**
 * How many live scrollers may carry one key. `one` (a name written for one
 * scroller): a second throws at its attach. `many` (a key shared by design, a
 * call site's — `<Scroll>`'s default keep): it keeps while one scroller holds
 * it, and nothing once a second does (`claimSharedKey`).
 */
export type KeptInstances = "one" | "many";

/**
 * This document. An offset saved under another one was saved before a reload
 * (or before the tab was restored); one saved under this one is an in-app
 * revisit, which opens at the top the way following a link does — unless the
 * scroller mounts in a revived subtree (`ScrollRevival`: an unloaded in-app tab
 * mounted again), which is a restoration like a reload.
 */
const DOCUMENT_ID = crypto.randomUUID();

/**
 * Every kept scroller's last offset, one entry per key. Session storage: the
 * browser keeps it across a reload of the tab and drops it with the tab.
 */
const offsetStore = defineStore<{ top: number; doc: string }>({
  owner: "auto-scroll.reload-offsets",
  label: "Scroll positions across reload",
  area: "session",
  cap: "64 KB",
  ttl: 7 * 24 * 60 * 60 * 1000,
  whenFull: "evict-oldest",
  schema: z.object({ top: z.number(), doc: z.string() }),
});

const SAVE_DEBOUNCE_MS = 150;

/** Switch the browser's scroll anchoring on `scroller` (`"none"` stands it down). */
function setAnchoring(scroller: HTMLElement, value: string): void {
  scroller.style.overflowAnchor = value;
}

/** Keys that scroll the focused scroller (or the one under the last click). */
const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);

/**
 * Keep a scroller's offset across a reload of the page: the browser's own
 * scroll restoration only knows the document's scroller, never an inner one,
 * and it gives up before async content has arrived anyway.
 *
 * Returns a callback ref for the scroller. `key` names what it shows, stable
 * across a reload (`undefined` keeps nothing). The offset is saved as the
 * reader scrolls (trailing debounce) and when the page hides; after a reload
 * it is put back as content arrives — every DOM change under the scroller
 * re-applies it (clamped, so a windowed list reaching its end loads
 * the next page and the restore carries on), with the browser's scroll
 * anchoring off, until the reader takes over (wheel, touch, a pointer down, a key pressed in it or a scroll
 * key, an announced navigation). A restore is a compensation, not a
 * navigation: it announces nothing.
 *
 * On a stick-to-bottom follower's scroller (`useStickyScroll`) the follower
 * decides. One that persists keeps the reader's place itself: this keep stands
 * down for good. One that does not leaves the reload to this keep, which saves
 * the offset only while the follower is parked (following, it saves nothing:
 * the reload opens at the bottom, following) — so after a reload the follower
 * starts parked where the reader left it (`joinReloadRestore`), and the
 * restore ends as soon as the follower follows again.
 */
export function useScrollAcrossReload(
  key: string | undefined,
  instances: KeptInstances = "one",
): (el: HTMLElement | null) => void {
  const store = useStore(offsetStore);
  const revival = useScrollRevival();
  const [el, setEl] = useState<HTMLElement | null>(null);
  const ref = useCallback((node: HTMLElement | null) => setEl(node), []);

  useLayoutEffect(() => {
    if (!el || key === undefined) return;
    // `one`: throws when another live scroller keeps under this key (see
    // claimKeptKey). `many`: kept only while no other live scroller carries it.
    let standDown = () => {};
    const release =
      instances === "one"
        ? claimKeptKey(el, key)
        : claimSharedKey(el, key, () => standDown());
    if (release === null) {
      // Rendered more than once at a time: no instance can be told apart, and
      // what was kept under it describes none of them.
      store.remove(key);
      return;
    }
    const unmark = markKept(el, key);
    const saved = store.read(key);
    // The follower on this scroller, once it marked it (see watchFollower).
    let follower: FollowerMark | null = null;
    let target =
      saved.kind === "value" &&
      (saved.value.doc !== DOCUMENT_ID ||
        (revival !== null && revival.claim(key, el))) &&
      saved.value.top > 0
        ? saved.value.top
        : null;

    const save = () => {
      // Mid-restore the saved target stands as written: a remount while the
      // page is still loading must find it again.
      if (target !== null) return;
      // A scroller with no layout box (under `display: none` — a hidden tab
      // being unloaded) reads 0, which is not where the reader left it: keep
      // what was saved while it was shown.
      if (!generatesBox(el)) return;
      // Only a parked follower's offset is the reader's place: following, the
      // reload opens it at the bottom anyway (an offset saved would park it),
      // and driving, the reader's scroll has not settled yet.
      if (follower !== null && follower.stance() !== "parked") {
        store.remove(key);
        return;
      }
      const top = el.scrollTop;
      if (top > 0) store.write(key, { top, doc: DOCUMENT_ID });
      else store.remove(key);
    };
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = null;
      save();
    };
    // Trailing-edge debounce, not a poll: a scroll emits events at input
    // frequency and each would otherwise be a storage write.
    const onScroll = () => {
      if (target !== null) return;
      // A follower's offset changes stance-first (its watcher saves then):
      // while it is not parked, its scrolls save nothing.
      if (follower !== null && follower.stance() !== "parked") return;
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, SAVE_DEBOUNCE_MS);
    };

    // While a restore is pending, every DOM change under the scroller re-applies
    // it: content arriving is always a mutation, wherever it lands (a pane body
    // overflows from inside a full-height box, so no size observer on the
    // scroller's own children sees it grow). Observed only while pending.
    //
    // Reaching the offset does not end it: content above keeps settling after
    // it is first reachable (late blocks, highlighting), and the offset was read
    // off the SETTLED layout a reload reproduces. So the browser's scroll
    // anchoring stands down meanwhile — it would carry the reader along with
    // the half-built layout — and the offset is held until the reader acts.
    const arrivals = new MutationObserver(() => apply());
    const anchoring = el.style.overflowAnchor;
    // Tells a follower on this scroller it starts parked at the saved offset.
    const endRestore = target === null ? null : beginReloadRestore(el);
    // Why the restore ends: the reader took over, the follower on this
    // scroller follows again, or this keep gave it up (standing down).
    const stopRestoring = (
      why: "reader" | "follows" | "abandoned" = "reader",
    ) => {
      if (target === null) return;
      target = null;
      arrivals.disconnect();
      // A follower following owns the scroller's anchoring (it stands it
      // down while it pins the bottom): giving the old value back would undo
      // it.
      if (why !== "follows") setAnchoring(el, anchoring);
      endRestore?.(why === "abandoned");
    };
    const readerTakesOver = () => stopRestoring();
    const apply = () => {
      if (target === null) return;
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      const top = Math.min(target, max);
      if (el.scrollTop !== top) el.scrollTop = top;
    };
    // Any key the reader presses here is theirs to act on — a scroll key moves
    // the scroller, typing edits content that must not then be scrolled away.
    const onKeyDown = (e: KeyboardEvent) => {
      const inside = e.target instanceof Node && el.contains(e.target);
      if (inside || (e.target === document.body && SCROLL_KEYS.has(e.key)))
        readerTakesOver();
    };

    if (target !== null) {
      setAnchoring(el, "none");
      arrivals.observe(el, { childList: true, subtree: true });
      // A shared key waits out the commit: a second instance mounting in it
      // stands this one down before anything is written (a microtask still
      // runs before paint).
      if (instances === "one") apply();
      else queueMicrotask(apply);
    }
    const unlisten = listenForNavigation(el, readerTakesOver);
    let detached = false;
    const detach = () => {
      if (detached) return;
      detached = true;
      unmark();
      release();
      stopRestoring();
      unlisten();
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", readerTakesOver);
      el.removeEventListener("touchstart", readerTakesOver);
      el.removeEventListener("pointerdown", readerTakesOver);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pagehide", flush);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", readerTakesOver, { passive: true });
    el.addEventListener("touchstart", readerTakesOver, { passive: true });
    el.addEventListener("pointerdown", readerTakesOver);
    // eslint-disable-next-line shortcuts/no-window-key-listener -- observes, never handles: a key the reader presses in this scroller (or a scroll key on the body) ends the restore; nothing is prevented
    window.addEventListener("keydown", onKeyDown);
    // A reload unmounts nothing: the page hiding is the last chance to save.
    window.addEventListener("pagehide", flush);
    // Standing down for good: this keep no longer owns the scroller's offset,
    // and what it kept no longer describes it.
    standDown = () => {
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = null;
      stopRestoring("abandoned");
      detach();
      store.remove(key);
    };
    const stopWatchingFollows = watchFollower(el, (f) => {
      if (detached) return;
      // A persisting follower took the scroller: its offset is the
      // follower's from now on.
      if (f.persists) {
        standDown();
        return;
      }
      follower = f;
      // Following again (the reader sent a turn, jumped, scrolled to the
      // end): the offset being put back is no longer theirs.
      if (f.stance() === "following") stopRestoring("follows");
      flush();
    });
    return () => {
      stopWatchingFollows();
      if (!detached) flush();
      detach();
    };
  }, [el, key, instances, store, revival]);

  return ref;
}
