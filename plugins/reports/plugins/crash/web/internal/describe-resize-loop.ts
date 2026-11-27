import type {
  ResizeLoopHeldBack,
  ResizeLoopObservation,
  ResizeLoopReport,
} from "@plugins/primitives/plugins/dom/plugins/element-size/plugins/resize-loop-trace/web";
import {
  nearestOwner,
  nearestSource,
} from "@plugins/primitives/plugins/ui-context/web";
import {
  RESIZE_LOOP_OBSERVATIONS_MAX,
  RESIZE_LOOP_TARGETS_MAX,
  type ResizeLoopTrace,
} from "../../core";

const CLASSES_MAX = 3;

// The traced elements, named for a report: what they are, who drew them (the
// build-stamped owner and source the element picker reads), how deep they sit.
export function describeResizeLoop(r: ResizeLoopReport): ResizeLoopTrace {
  return {
    pass: r.pass
      .slice(0, RESIZE_LOOP_OBSERVATIONS_MAX)
      .map(describeObservation),
    omittedPass:
      r.omittedPass + Math.max(0, r.pass.length - RESIZE_LOOP_OBSERVATIONS_MAX),
    deferred: r.deferred
      .slice(0, RESIZE_LOOP_OBSERVATIONS_MAX)
      .map(describeObservation),
    omittedDeferred:
      r.omittedDeferred +
      Math.max(0, r.deferred.length - RESIZE_LOOP_OBSERVATIONS_MAX),
    // Shallowest first: the browser holds back what sits at or above the
    // depth it just delivered, so the loop's element leads.
    heldBack: r.heldBack
      .map(describeHeldBack)
      .sort((a, b) => a.depth - b.depth)
      .slice(0, RESIZE_LOOP_OBSERVATIONS_MAX),
    omittedHeldBack:
      r.omittedHeldBack +
      Math.max(0, r.heldBack.length - RESIZE_LOOP_OBSERVATIONS_MAX),
    occurrences: r.occurrences,
    durationMs: r.durationMs,
  };
}

function describeHeldBack(h: ResizeLoopHeldBack) {
  return {
    ...describeTarget(h.target, h.width, h.height),
    // As it was when the error fired, not when the report is written.
    connected: h.connected,
    site: h.site,
    reported: h.reported,
  };
}

function describeTarget(target: Element, width: number, height: number) {
  return {
    element: elementLabel(target),
    owner: nearestOwner(target) ?? null,
    source: nearestSource(target) ?? null,
    depth: depthOf(target),
    width,
    height,
    connected: target.isConnected,
  };
}

function describeObservation(o: ResizeLoopObservation) {
  return {
    site: o.site,
    targets: o.entries
      .slice(0, RESIZE_LOOP_TARGETS_MAX)
      .map((e) => describeTarget(e.target, e.width, e.height)),
    omittedTargets: Math.max(0, o.entries.length - RESIZE_LOOP_TARGETS_MAX),
  };
}

function elementLabel(el: Element): string {
  const id = el.id ? `#${el.id}` : "";
  const classes = Array.from(el.classList)
    .slice(0, CLASSES_MAX)
    .map((c) => `.${c}`)
    .join("");
  return `${el.tagName.toLowerCase()}${id}${classes}`;
}

function depthOf(el: Element): number {
  let depth = 0;
  for (let cur = el.parentElement; cur; cur = cur.parentElement) depth++;
  return depth;
}
