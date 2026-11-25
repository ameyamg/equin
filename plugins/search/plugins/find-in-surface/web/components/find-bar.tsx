import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { z } from "zod";
import {
  findPattern,
  endPoint,
  startPoint,
  type FindOptions,
} from "@plugins/search/plugins/find-in-surface/core";
import { keptField } from "@plugins/primitives/plugins/kept-state/core";
import {
  defineKept,
  useKept,
  useTransient,
} from "@plugins/primitives/plugins/kept-state/web";
import {
  Button,
  ControlSizeProvider,
  Separator,
  Textarea,
} from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Pin } from "@plugins/primitives/plugins/css/plugins/pin/web";
import { Placed } from "@plugins/primitives/plugins/css/plugins/coords/web";
import { Surface } from "@plugins/primitives/plugins/css/plugins/surface/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Fill } from "@plugins/primitives/plugins/css/plugins/fill/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { rigidClass } from "@plugins/primitives/plugins/css/plugins/rigid/web";
import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import { useSurfaceShortcuts } from "@plugins/primitives/plugins/shortcuts/web";
import { findScrollParent } from "@plugins/primitives/plugins/dom/plugins/auto-scroll/web";
import { useLatestRef } from "@plugins/primitives/plugins/latest-ref/web";
import {
  focusElement,
  revealElement,
} from "@plugins/primitives/plugins/dom/plugins/scroll-reveal/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import { findRootScope } from "../internal/find-root-scope";
import { regionText } from "../internal/region-text";
import { clearMatches, paintMatches } from "../internal/paint";
import {
  claimantOf,
  mountClaimant,
  pressedIn,
  type FindClaimant,
} from "../internal/claim";
import "./find-in-surface.css";

const searchIcon = symbol("search");
const previousIcon = symbol("expand-less");
const nextIcon = symbol("expand-more");
const closeIcon = symbol("close");

/** Where the reader was looking: the bar, its query and its options survive a reload. */
const findView = defineKept({
  owner: "search.find-bar",
  tier: "view",
  schema: z.object({
    open: z.boolean(),
    query: z.string(),
    matchCase: z.boolean(),
    wholeWord: z.boolean(),
  }),
});

const CLOSED = { open: false, query: "", matchCase: false, wholeWord: false };

/** The matches in the region, in document order, and which one is current (-1: none). */
interface Found {
  ranges: readonly Range[];
  active: number;
}
const NOTHING: Found = { ranges: [], active: -1 };

/** A selection longer than this is not a query anyone meant. */
const MAX_PREFILL = 400;

function matchRanges(
  root: HTMLElement,
  options: FindOptions,
  query: string,
): Range[] {
  const pattern = findPattern(query, options);
  if (!pattern) return [];
  const { text, nodes, parts } = regionText(root);
  const ranges: Range[] = [];
  for (const m of text.matchAll(pattern)) {
    if (m[0].length === 0) continue;
    const a = startPoint(parts, m.index);
    const b = endPoint(parts, m.index + m[0].length);
    const range = document.createRange();
    range.setStart(nodes[a.part]!, a.offset);
    range.setEnd(nodes[b.part]!, b.offset);
    if (!range.collapsed) ranges.push(range);
  }
  return ranges;
}

/**
 * Which match is current after a re-read. The one the reader was on, or the
 * next after it when it is gone; with none yet, the first at or below the top
 * of what is on screen — a new query never jumps back to the top of the page.
 */
function pickActive(
  ranges: readonly Range[],
  previous: Range | null,
  scroller: HTMLElement,
): number {
  if (ranges.length === 0) return -1;
  const kept =
    previous?.startContainer.isConnected === true
      ? ranges.findIndex(
          (r) => r.compareBoundaryPoints(Range.START_TO_START, previous) >= 0,
        )
      : -2;
  if (kept >= 0) return kept;
  if (kept === -1) return 0;
  const top = scroller.getBoundingClientRect().top;
  const below = ranges.findIndex(
    (r) => r.getBoundingClientRect().bottom >= top,
  );
  return below < 0 ? 0 : below;
}

/** Bring a match into view when it is not, a third of the way down. */
function reveal(
  range: Range,
  scroller: HTMLElement,
  bar: HTMLElement | null,
): void {
  const box = scroller.getBoundingClientRect();
  const r = range.getBoundingClientRect();
  if (r.height === 0) return;
  // The bar floats over the top of the scroller: a match under it is not seen.
  const covered = bar
    ? Math.max(0, bar.getBoundingClientRect().bottom - box.top)
    : 0;
  if (r.top >= box.top + covered && r.bottom <= box.bottom) return;
  const host = range.startContainer.parentElement;
  revealElement(host, { block: "center", behavior: "smooth" });
}

/** Is the caret on the field's first (or last) line — so ↑ (↓) has nowhere to go? */
function caretOnEdgeLine(
  field: HTMLTextAreaElement,
  edge: "first" | "last",
): boolean {
  const { value, selectionStart, selectionEnd } = field;
  return edge === "first"
    ? !value.slice(0, selectionStart).includes("\n")
    : !value.slice(selectionEnd).includes("\n");
}

interface Tick {
  y: number;
  active: boolean;
}

export interface FindBarProps {
  /** What is searched, said in the field: `Find in page`. */
  label: string;
}

/**
 * Ctrl+F for the `<FindRoot>` of its `<FindScope>`: a bar pinned to the top
 * right of the nearest positioned ancestor (mount it in an overlay layer that
 * does not scroll), every match painted with the CSS Custom Highlight API —
 * the region's DOM is never touched — and a mark per match on the scroller's
 * edge.
 *
 * Enter / ↓ on the last line: next match. ↑ on the first line: previous.
 * Shift+Enter: a new line (a line break matches a line break). Esc: close.
 * ⌘G / ⇧⌘G step from anywhere in the region while the bar is open.
 */
export function FindBar({ label }: FindBarProps) {
  const region = findRootScope.useRoot();
  const root = region.attached ? region.root : null;
  const kept = useKept(findView, CLOSED);
  const [state, setState] = kept;
  const [found, setFound] = useTransient<Found>(
    "find matches: re-read from the region's DOM whenever it changes",
    NOTHING,
  );
  const [ticks, setTicks] = useTransient<{
    top: number;
    height: number;
    ticks: Tick[];
  } | null>("match marks: measured from the scroller's layout", null);
  const barRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  // Set by what the reader did (open, type, step); consumed by the next paint.
  const revealNext = useRef(false);
  const focusNext = useRef(false);
  const rootRef = useLatestRef(root);
  const paintKey = useMemo(() => Symbol("find-bar"), []);
  const claimant = useMemo<FindClaimant>(
    () => ({ root: () => rootRef.current, bar: () => barRef.current }),
    [rootRef],
  );

  useEffect(() => mountClaimant(claimant), [claimant]);
  useEffect(() => {
    if (!root) return;
    const onPress = () => pressedIn(claimant);
    root.addEventListener("pointerdown", onPress, true);
    return () => root.removeEventListener("pointerdown", onPress, true);
  }, [root, claimant]);

  const options = useMemo(
    () => ({ matchCase: state.matchCase, wholeWord: state.wholeWord }),
    [state.matchCase, state.wholeWord],
  );

  // Read the matches, and read them again whenever the region's DOM changes
  // (an edit, a line woken into its editor, a toggle opened).
  useEffect(() => {
    if (!root || !state.open) {
      setFound(NOTHING);
      return;
    }
    const scroller = findScrollParent(root);
    const read = () =>
      setFound((prev) => {
        const ranges = matchRanges(root, options, state.query);
        return {
          ranges,
          active: pickActive(
            ranges,
            prev.ranges[prev.active] ?? null,
            scroller,
          ),
        };
      });
    revealNext.current = true;
    read();
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(read);
    });
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [root, state.open, state.query, options, setFound]);

  // Paint, bring the current match into view when the reader moved to it, and
  // place the marks.
  useLayoutEffect(() => {
    const active = found.ranges[found.active] ?? null;
    paintMatches(paintKey, { matches: found.ranges, active });
    if (!root || found.ranges.length === 0) {
      setTicks(null);
      return;
    }
    const scroller = findScrollParent(root);
    if (active && revealNext.current) reveal(active, scroller, barRef.current);
    revealNext.current = false;
    const host = barRef.current?.offsetParent;
    if (!host || scroller.scrollHeight <= scroller.clientHeight) {
      setTicks(null);
      return;
    }
    const box = scroller.getBoundingClientRect();
    const scale = scroller.clientHeight / scroller.scrollHeight;
    setTicks({
      top: box.top - host.getBoundingClientRect().top,
      height: scroller.clientHeight,
      ticks: found.ranges.map((r, i) => ({
        y:
          (r.getBoundingClientRect().top - box.top + scroller.scrollTop) *
          scale,
        active: i === found.active,
      })),
    });
  }, [found, root, paintKey, setTicks]);
  useEffect(() => () => clearMatches(paintKey), [paintKey]);

  useEffect(() => {
    if (!state.open || !focusNext.current) return;
    focusNext.current = false;
    focusElement(fieldRef.current, { reveal: false });
    fieldRef.current?.select();
  });

  const open = () => {
    const selection = getSelection();
    const picked =
      selection &&
      !selection.isCollapsed &&
      root?.contains(selection.anchorNode)
        ? selection.toString().trim()
        : "";
    focusNext.current = true;
    setState((s) => ({
      ...s,
      open: true,
      query: picked !== "" && picked.length <= MAX_PREFILL ? picked : s.query,
    }));
  };
  const close = () => setState((s) => ({ ...s, open: false }));
  const step = (by: 1 | -1) => {
    revealNext.current = true;
    setFound((f) =>
      f.ranges.length === 0
        ? f
        : { ...f, active: (f.active + by + f.ranges.length) % f.ranges.length },
    );
  };
  const mine = (e: KeyboardEvent) => claimantOf(e.target) === claimant;

  useSurfaceShortcuts([
    {
      id: "find.open",
      keys: "mod+f",
      label: "Find",
      group: "Find",
      handler: open,
      when: mine,
    },
    {
      id: "find.next",
      keys: "mod+g",
      label: "Next match",
      group: "Find",
      handler: () => step(1),
      when: (e) => state.open && mine(e),
    },
    {
      id: "find.previous",
      keys: "mod+shift+g",
      label: "Previous match",
      group: "Find",
      handler: () => step(-1),
      when: (e) => state.open && mine(e),
    },
  ]);

  if (!state.open) return null;
  const n = found.ranges.length;
  const missed = state.query.trim() !== "" && n === 0;
  return (
    <>
      {ticks ? (
        <Placed
          x={{ end: 0, size: 8 }}
          y={{ start: ticks.top, size: ticks.height }}
          decorative
        >
          {ticks.ticks.map((t, i) => (
            <Placed
              // A tick is the i-th match's mark, re-measured on every read.
              key={i}
              x={{ end: 0, size: t.active ? 8 : 6 }}
              y={{ center: t.y, size: t.active ? 4 : 3 }}
              decorative
              className={t.active ? "find-tick find-tick-active" : "find-tick"}
            />
          ))}
        </Placed>
      ) : null}
      <Pin
        ref={barRef}
        to="top-right"
        offset="sm"
        layer="float"
        role="search"
        aria-label={label}
        className="find-bar"
      >
        <Surface level="overlay" className="find-bar-surface">
          <ControlSizeProvider size="sm">
            <Stack direction="row" gap="2xs" align="start">
              <Fill>
                <Stack direction="row" gap="sm" align="start">
                  <Icon
                    icon={searchIcon}
                    className={`${rigidClass()} find-bar-glyph`}
                  />
                  <Fill>
                    <Textarea
                      ref={fieldRef}
                      bare
                      fitContent
                      rows={1}
                      keep={keptField(kept, "query")}
                      placeholder={label}
                      aria-label={label}
                      spellCheck={false}
                      aria-invalid={missed}
                      className="find-query text-control"
                      onKeyDown={(e) => {
                        const field = e.currentTarget;
                        if (e.key === "Escape") {
                          e.preventDefault();
                          close();
                        } else if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          step(1);
                        } else if (
                          e.key === "ArrowUp" &&
                          !e.shiftKey &&
                          caretOnEdgeLine(field, "first")
                        ) {
                          e.preventDefault();
                          step(-1);
                        } else if (
                          e.key === "ArrowDown" &&
                          !e.shiftKey &&
                          caretOnEdgeLine(field, "last")
                        ) {
                          e.preventDefault();
                          step(1);
                        }
                      }}
                    />
                  </Fill>
                </Stack>
              </Fill>
              <Text
                variant="caption"
                tone={missed ? "destructive" : "muted"}
                className={`${rigidClass()} find-bar-count tabular-nums`}
                aria-live="polite"
              >
                {state.query.trim() === ""
                  ? ""
                  : n === 0
                    ? "No results"
                    : `${found.active + 1} of ${n}`}
              </Text>
              <Separator orientation="vertical" className="find-bar-sep" />
              <Button
                variant="ghost"
                aspect="icon"
                tooltip="Match case"
                aria-pressed={state.matchCase}
                className="find-bar-button find-bar-toggle text-caption"
                onClick={() =>
                  setState((s) => ({ ...s, matchCase: !s.matchCase }))
                }
              >
                Aa
              </Button>
              <Button
                variant="ghost"
                aspect="icon"
                tooltip="Whole word"
                aria-pressed={state.wholeWord}
                className="find-bar-button find-bar-toggle text-caption"
                onClick={() =>
                  setState((s) => ({ ...s, wholeWord: !s.wholeWord }))
                }
              >
                <span className="find-bar-whole-word">ab</span>
              </Button>
              <Separator orientation="vertical" className="find-bar-sep" />
              <IconButton
                glyph="small"
                className="find-bar-button"
                icon={previousIcon}
                label="Previous match"
                shortcut="mod+shift+g"
                disabled={n < 2}
                onClick={() => step(-1)}
              />
              <IconButton
                glyph="small"
                className="find-bar-button"
                icon={nextIcon}
                label="Next match"
                shortcut="mod+g"
                disabled={n < 2}
                onClick={() => step(1)}
              />
              <IconButton
                glyph="small"
                className="find-bar-button"
                icon={closeIcon}
                label="Close"
                shortcut="escape"
                onClick={close}
              />
            </Stack>
          </ControlSizeProvider>
        </Surface>
      </Pin>
    </>
  );
}
