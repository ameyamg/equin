import { useEffect, useMemo } from "react";
import { useLatestRef } from "@plugins/primitives/plugins/latest-ref/web";
import { Shortcuts } from "../slots";
import { getCachedCombo, matchesEvent } from "./parse-keys";
import { comboIsCommand, targetClaimsKey } from "./target-claims-key";
import { useDynamicShortcuts } from "./dynamic-registry";
import { getFocusedSurfaceId } from "./focused-surface";
import { regionWinners } from "./region";

export function ShortcutManager() {
  const staticShortcuts = Shortcuts.Shortcut.useContributions();
  const dynamicShortcuts = useDynamicShortcuts();
  // Static path stays byte-identical; the dynamic (surface-scoped) list is
  // simply concatenated to build the active set.
  const shortcuts = useMemo(
    () => [...staticShortcuts, ...dynamicShortcuts],
    [staticShortcuts, dynamicShortcuts],
  );
  const shortcutsRef = useLatestRef(shortcuts);

  useEffect(() => {
    if (import.meta.env.DEV) {
      const byCombo = new Map<string, string[]>();
      for (const s of shortcutsRef.current) {
        const key = s.keys.toLowerCase();
        const ids = byCombo.get(key) ?? [];
        ids.push(s.id);
        byCombo.set(key, ids);
      }
      const regioned = new Set(
        shortcutsRef.current.filter((s) => s.region).map((s) => s.id),
      );
      for (const [combo, ids] of byCombo) {
        // Regioned twins (two lists' j / k) are told apart by their regions.
        if (ids.length > 1 && !ids.every((id) => regioned.has(id))) {
          console.warn(
            `[shortcuts] Key combo "${combo}" registered by: ${ids.join(", ")}. ` +
              `Highest precedence wins; use "when" guards or distinct precedences to resolve.`,
          );
        }
      }
    }
  }, [shortcuts]);

  useEffect(() => {
    // Typed `Event`, not `KeyboardEvent`: a "keydown" is not always a keyboard
    // event. Chrome's autofill (picking a saved address or password) and
    // password-manager extensions dispatch plain `Event`s named "keydown" with
    // no `key`, `code` or modifier fields — the DOM typings' keydown →
    // KeyboardEvent mapping lies for them. Such an event names no key, so it is
    // never a shortcut; narrowing here makes every read below sound.
    // The element last under the pointer, for a region claiming its key by
    // pointer (`ShortcutRegion.pointer`); `null` once the pointer left the page.
    let pointerAt: Node | null = null;
    function handlePointerOver(event: Event) {
      pointerAt = event.target instanceof Node ? event.target : null;
    }
    // The element last pressed: where focus really is when the focused
    // element is a container around it — the body after a click on
    // unfocusable text, or a page block's caret host, which takes focus for
    // the block it draws. A region inside that container holds the key.
    let pressedAt: Node | null = null;
    function handlePointerDown(event: Event) {
      pressedAt = event.target instanceof Node ? event.target : null;
    }
    function handlePointerOut(event: Event) {
      if (event instanceof PointerEvent && event.relatedTarget === null)
        pointerAt = null;
    }
    function handleKeyDown(event: Event) {
      if (!(event instanceof KeyboardEvent)) return;
      const e = event;
      // An element that already handled the key owns it: a tree or list moving
      // its selection with the arrows, a row activated by Space. This window
      // listener runs after React's root-delegated handlers, so their
      // preventDefault is visible here.
      if (e.defaultPrevented) return;
      const active = shortcutsRef.current;
      const editable = targetClaimsKey(e);
      const eligible: typeof active = [];
      for (const shortcut of active) {
        const parsed = getCachedCombo(shortcut.keys);
        if (!parsed) continue;
        if (!matchesEvent(parsed, e)) continue;
        // While typing, plain-key shortcuts yield to the field so the keystroke
        // is inserted. Commands (Cmd/Ctrl/Alt combos, function keys) never
        // type, so they still fire; a shortcut may opt in via enableInInputs.
        if (editable && !comboIsCommand(parsed) && !shortcut.enableInInputs)
          continue;
        if (
          shortcut.surfaceId !== undefined &&
          shortcut.surfaceId !== getFocusedSurfaceId()
        )
          continue;
        eligible.push(shortcut);
      }
      // Several instances binding one key on one surface: the one whose
      // region holds the key (focus, else pointer) — never a guess.
      const regioned = eligible.filter((s) => s.region !== undefined);
      const contenders =
        regioned.length === 0
          ? eligible
          : [
              ...eligible.filter((s) => s.region === undefined),
              ...regionWinners(regioned, {
                focus: focusPlace(e.target, pressedAt),
                pointer: pointerAt,
              }),
            ];
      let winner: (typeof active)[number] | null = null;
      let winnerPrecedence = -Infinity;
      for (const shortcut of contenders) {
        // `when` runs on the region's owner only: a region that holds the key
        // but has nothing to do with it (an empty Submit) never hands it to
        // another region's twin.
        if (shortcut.when && !shortcut.when(e)) continue;
        const precedence = shortcut.precedence ?? 0;
        if (precedence > winnerPrecedence) {
          winner = shortcut;
          winnerPrecedence = precedence;
        }
      }

      if (winner) {
        e.preventDefault();
        winner.handler();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerover", handlePointerOver, true);
    window.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("pointerout", handlePointerOut, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerover", handlePointerOver, true);
      window.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("pointerout", handlePointerOut, true);
    };
  }, []);

  return null;
}

/**
 * Where focus is, for the region test: the key's target — or, when that
 * target is a container around the last press (the body, a caret host that
 * took focus for the block pressed in), the pressed element, which says
 * where in the container the user is. A press outside the target says
 * nothing about it.
 */
function focusPlace(
  target: EventTarget | null,
  pressedAt: Node | null,
): Node | null {
  if (!(target instanceof Node)) return null;
  return pressedAt !== null &&
    pressedAt !== target &&
    pressedAt.isConnected &&
    target.contains(pressedAt)
    ? pressedAt
    : target;
}
