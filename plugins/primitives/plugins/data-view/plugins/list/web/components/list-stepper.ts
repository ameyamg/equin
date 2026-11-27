import {
  defineSurfaceSignal,
  useOwnSurfaceSignal,
  useSurfaceSignal,
  type SurfaceSignal,
} from "@plugins/primitives/plugins/shortcuts/web";
import type {
  ListStep,
  ListStepper,
} from "@plugins/primitives/plugins/data-view/plugins/list/core";

// Each stepper is a surface signal: the list publishes its step as its
// surface's entry, a part of the same surface reads it.
const signals = new WeakMap<ListStepper, SurfaceSignal<ListStep>>();

/**
 * A list stepper (`ListViewOptions.stepKeys`): make once at module scope and
 * share it between the list that steps and the part of its surface that
 * steps it.
 */
export function defineListStepper(name: string): ListStepper {
  const stepper = { name } as ListStepper;
  signals.set(stepper, defineSurfaceSignal<ListStep>(`list-stepper:${name}`));
  return stepper;
}

function signalOf(stepper: ListStepper): SurfaceSignal<ListStep> {
  const signal = signals.get(stepper);
  if (signal === undefined)
    throw new Error(
      `data-view list: stepper "${stepper.name}" was not made by defineListStepper`,
    );
  return signal;
}

/** The list's half: publish `step` through `stepper` while mounted. */
export function usePublishListStep(
  stepper: ListStepper | null,
  step: ListStep,
): void {
  useSurfaceSignal(
    stepper === null ? NO_SIGNAL : signalOf(stepper),
    stepper === null ? null : step,
  );
}

const NO_SIGNAL = defineSurfaceSignal<ListStep>("list-stepper:none");

/**
 * The step of the list in this surface stepping through `stepper`, or `null`
 * while none is mounted here. `step(delta)` runs that list's row activation
 * for the row `delta` away from its selected one, as `j` / `k` do, over the
 * rows it last drew — so a caller about to move the selected row out of the
 * list steps first, from where it still is.
 */
export function useListStepper(stepper: ListStepper): ListStep | null {
  return useOwnSurfaceSignal(signalOf(stepper));
}
