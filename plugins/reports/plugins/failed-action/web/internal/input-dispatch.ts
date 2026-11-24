/**
 * Which errors the user caused: an error is the user's action failing when it
 * is raised WHILE the browser is still dispatching a trusted input event (a
 * click, a key, a submit) — by a handler of that input, or by work that
 * input's own dispatch runs.
 *
 * - The browser reports a listener's uncaught throw (the `error` event) at
 *   once, inside the dispatch; React 19 catches its own handlers' throws and
 *   hands them to `reportError`, which dispatches `error` synchronously — so
 *   the input is still being dispatched when the window's error listener runs.
 * - "Still being dispatched" is `eventPhase !== NONE` (it is reset to `NONE`
 *   when the dispatch ends, DOM § dispatch). Inside it run the listeners and
 *   the microtask checkpoint after each of them — so a React sync-lane render
 *   the click caused counts too, and so would a background React update's
 *   effects that the click's render happens to flush first (only one that
 *   throws past every error boundary reaches `error` at all). What can never
 *   count: anything in a later task — a timer, a live push, a fetch's
 *   continuation, the Scheduler's deferred renders.
 * - `isTrusted`: the user did it — an event a script dispatched is not. A
 *   script's dispatch nested inside a trusted one (a key handler calling
 *   `button.click()`) is still inside the trusted dispatch, so it counts.
 * - A stack, not one slot: a trusted dispatch can run inside another (a
 *   handler focusing or submitting synchronously), and an error after the
 *   inner one ended is still inside the outer. A default action (a submit
 *   button's `submit`, an input's `change`) runs after its click's dispatch
 *   ended, as its own trusted event — so it is in `USER_ACTION_EVENTS` itself.
 *
 * What it does not see: a handler's ASYNC failure (a rejection after an
 * `await` of real work) surfaces later, outside any dispatch, as an unhandled
 * rejection — nothing ties it back to the input, so it is not claimed (a
 * timing guess would claim background failures too). Nor a throw in a window
 * capture listener registered before this watch, nor input inside an iframe.
 */

/** The inputs that are a user's action — not pointer moves, scrolls or focus. */
export const USER_ACTION_EVENTS = [
  "click",
  "dblclick",
  "auxclick",
  "contextmenu",
  "pointerdown",
  "pointerup",
  "mousedown",
  "mouseup",
  "touchstart",
  "touchend",
  "keydown",
  "keyup",
  "beforeinput",
  "input",
  "change",
  "submit",
  "reset",
  "beforetoggle",
  "dragstart",
  "dragend",
  "paste",
  "cut",
  "copy",
  "drop",
] as const;

export interface InputDispatchWatch {
  /** Called at the start of each trusted user-action event's dispatch. */
  enter(event: Event): void;
  /** The user-action event being dispatched right now, innermost first; null when none. */
  current(): Event | null;
}

export function createInputDispatchWatch(): InputDispatchWatch {
  const open: Event[] = [];
  const prune = () => {
    while (open.length > 0 && open[open.length - 1]!.eventPhase === Event.NONE)
      open.pop();
  };
  return {
    enter(event) {
      prune();
      // Bounded by construction: each entry is still in dispatch, and
      // dispatches only nest as deep as the call stack.
      open.push(event);
    },
    current() {
      prune();
      return open.at(-1) ?? null;
    },
  };
}

/**
 * Watch `target`'s trusted user-action dispatches: window capture listeners,
 * so they run before every handler of the page except window capture
 * listeners registered earlier (the window is the first stop of every
 * dispatch's path). Returns the watch and its stop.
 */
export function watchInputDispatch(target: Window): {
  watch: InputDispatchWatch;
  stop: () => void;
} {
  const watch = createInputDispatchWatch();
  const onInput = (event: Event) => {
    if (event.isTrusted) watch.enter(event);
  };
  for (const type of USER_ACTION_EVENTS)
    target.addEventListener(type, onInput, { capture: true, passive: true });
  return {
    watch,
    stop: () => {
      for (const type of USER_ACTION_EVENTS)
        target.removeEventListener(type, onInput, { capture: true });
    },
  };
}
