/**
 * Input made in another tab, arriving here: a draft typed in one tab is kept
 * in storage shared with every tab, so each keystroke redraws the same draft
 * wherever else it is open (the Wish editor repainting its paragraph at the
 * typist's pace). That is the page showing what the person is doing, not a
 * loop — but this tab saw no input of its own, so to the detector's idle gate
 * (no input for IDLE_MS) it looks exactly like one. So the code that hears
 * another tab's write and hands it to this page's readers marks remote input
 * there, and the detector counts it as activity, the way it counts a key press.
 *
 * Mark it only where another tab's write is delivered to a reader of this
 * page: a write nothing here reads redraws nothing, and silences nothing.
 */
let lastAt = Number.NEGATIVE_INFINITY;

/** Another tab's write was just delivered to this page's readers. */
export function markRemoteInput(): void {
  lastAt = performance.now();
}

/** When remote input was last marked (`performance.now()` time; -Infinity if never). */
export function lastRemoteInputAt(): number {
  return lastAt;
}
