import { clientLog } from "@plugins/primitives/plugins/log-channels/web";
import { getTabId } from "@plugins/primitives/plugins/scope/plugins/tab-id/web";
import { isToastHostSuppressed } from "./suppress-toasts";

/**
 * The `toasts` client log: every decision a tab makes about a toast — a
 * notification arriving at its bell (announced or skipped, and why), the
 * toast gate (raised, or skipped for its audience or an off-screen page),
 * sonner mounting it and it going away. A toast the user says never showed is
 * then explained from the log (`~/.equin/worktrees/<wt>/logs/toasts.jsonl`)
 * instead of guessed: which tabs received it, and what each one did.
 *
 * Every line is stamped with the page's state at that instant — the tab, its
 * visibility (the announcement gate), whether it has focus (an extension
 * popover takes focus but leaves the page visible) and the toast host's state.
 */
export function logToast(line: string): void {
  const visible = document.visibilityState;
  const focus = document.hasFocus() ? "focused" : "unfocused";
  clientLog(
    "toasts",
    `[tab ${getTabId().slice(0, 8)} ${visible} ${focus} host=${hostState()}] ${line}`,
  );
}

/** How many `<Toasts/>` stacks are mounted on this page (one, or none). */
let mountedHosts = 0;

/** The toast stack mounted (`ToasterHost`'s drawn half), for the log's host state. */
export function markToastHostMounted(): () => void {
  mountedHosts++;
  return () => {
    mountedHosts--;
  };
}

/**
 * Whether a raised toast can be drawn: `drawn` (the stack is mounted),
 * `suppressed` (a surface turned it off — the toast is not drawn), `absent`
 * (no stack mounted yet, or none on this page: sonner replays it once one
 * mounts).
 */
function hostState(): "drawn" | "suppressed" | "absent" {
  if (isToastHostSuppressed()) return "suppressed";
  return mountedHosts > 0 ? "drawn" : "absent";
}
