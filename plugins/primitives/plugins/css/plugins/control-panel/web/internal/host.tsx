import type React from "react";
import { createContext, useContext } from "react";

export interface ControlPanelHost {
  /**
   * `"push"` — a `Group` is a drill row that pushes a panel-stack entry.
   * `"inline"` — a `Group` is an indented labelled band, down to `inlineDepth`.
   */
  readonly nesting: "push" | "inline";
  /**
   * How many levels of `inline` this host has room for. Below it a `Group`
   * pushes anyway, so a list-of-objects-of-lists in a 500px pane does not
   * collapse into nothing.
   */
  readonly inlineDepth: number;
  /**
   * Where a field's description goes: on the band, behind a `hint`, or visibly
   * UNDER the field's own label (`"label"` — the form surface).
   */
  readonly descriptions: "band" | "hint" | "label";
  /**
   * How a `Section` names its band: `"label"` — the shared menu section label
   * (a popover, a pane), or `"heading"` — a settings card's heading over
   * body prose (`ControlPanelCard`). The surface's answer, never the call
   * site's, so one `<ControlPanel.Section>` reads right wherever it renders.
   */
  readonly sections: "label" | "heading";
  /**
   * The row construction the field members draw. `"rows"` — the menu row:
   * label on the text rail, control in a trailing value track, nesting an
   * indented region (the popover, the pane, the card). `"form"` — a form:
   * a label column (label over its description) beside a control column that
   * starts at ONE x at every depth, wide controls under the label, nesting a
   * tinted box (`ControlPanelForm`). The surface's answer, like every field
   * here: a member written once reads right in either.
   */
  readonly layout: "rows" | "form";
}

const ControlPanelHostContext = createContext<ControlPanelHost | null>(null);

/**
 * The host's presentation policy — the answers a member needs that belong to the
 * SURFACE rather than to the field.
 *
 * It THROWS when there is no host, the same policy as `usePanelStack()` and for
 * the same reason: a `Group` cannot render correctly in a host that has not said
 * whether to push or to inline, and a silent default shows up as a dead click at
 * depth 2 rather than as an error anyone can find. `ControlPanelPopover`,
 * `ControlPanelPane` and `ControlPanelCard` each publish one, so every panel opened through the
 * vocabulary already has it.
 */
export function useControlPanelHost(): ControlPanelHost {
  const host = useContext(ControlPanelHostContext);
  if (!host) {
    throw new Error(
      "useControlPanelHost() requires a ControlPanelPopover, ControlPanelPane, ControlPanelCard or ControlPanelForm " +
        "ancestor. The host decides how a Group presents (push vs inline) and " +
        "where a description goes; there is no correct default.",
    );
  }
  return host;
}

/**
 * How a `Section` names its band here. Unlike `useControlPanelHost()` this does
 * not throw without a host: a bare `<ControlPanel>` in a `DialogContent` (the
 * documented second home for one) has no host, and a section there keeps the
 * label it always drew — the one answer that existed before hosts had a say.
 */
export function useSectionStyle(): ControlPanelHost["sections"] {
  return useContext(ControlPanelHostContext)?.sections ?? "label";
}

/**
 * The row construction members draw here. Like `useSectionStyle` it does not
 * throw without a host: a bare `<ControlPanel>` in a `DialogContent` draws the
 * menu rows it always drew.
 */
export function useHostLayout(): ControlPanelHost["layout"] {
  return useContext(ControlPanelHostContext)?.layout ?? "rows";
}

/**
 * Publishes the policy. Not exported from the barrel: a host is one of the three
 * surfaces, and letting a caller invent a third policy at a call site is exactly
 * the `mode` prop this design removed from `Group`.
 */
export function ControlPanelHostProvider({
  host,
  children,
}: {
  host: ControlPanelHost;
  children: React.ReactNode;
}) {
  return (
    <ControlPanelHostContext value={host}>{children}</ControlPanelHostContext>
  );
}

/**
 * How many inline groups this subtree is already inside. Zero at the panel's
 * top level; each inline `Group` publishes one more for its children, which is
 * what makes `inlineDepth` a budget rather than a per-call-site guess.
 */
const GroupDepthContext = createContext(0);

export function useGroupDepth(): number {
  return useContext(GroupDepthContext);
}

/**
 * Whether a `Group` rendered HERE would inline (`true`) or push a panel
 * (`false`) — the host's nesting and the depth budget, read the way `Group`
 * reads them. For a caller that must pick what goes INTO a group by how it
 * presents: a list item's Remove is a header action on an inline item box,
 * but a member row inside a pushed page (a drill row is a `<button>`).
 */
export function useGroupInlines(): boolean {
  const host = useControlPanelHost();
  const depth = useGroupDepth();
  return host.nesting === "inline" && depth < host.inlineDepth;
}

export function GroupDepthProvider({
  depth,
  children,
}: {
  depth: number;
  children: React.ReactNode;
}) {
  return <GroupDepthContext value={depth}>{children}</GroupDepthContext>;
}
