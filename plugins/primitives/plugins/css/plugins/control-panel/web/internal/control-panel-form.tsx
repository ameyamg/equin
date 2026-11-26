import type React from "react";

import { ControlPanel } from "./control-panel";
import { ControlPanelHostProvider, type ControlPanelHost } from "./host";
import { ControlPanelStack } from "./panel-stack";

export interface ControlPanelFormProps {
  /** Names the form for assistive tech, exactly as `ControlPanel` does. */
  label?: string;
  children: React.ReactNode;
}

/**
 * A RECORD'S FIELDS AS A FORM — the fourth surface, beside the popover (a menu
 * of choices), the pane (a settings pane of rows) and the card (an app's
 * settings under a gear).
 *
 * A form is a different thing from a pane of rows: every member is one field
 * of one record (a config, a feed item, a source's settings), most carry a
 * sentence of description, and nesting (an object, a variant, a list of
 * records) is common. So the members draw the FORM construction
 * (`layout: "form"`):
 *
 *  - a label column (the label, its description visibly under it) beside a
 *    control column whose start is ONE x at every nesting depth — 40% of the
 *    form (`cp-form-row`'s label track, a container-query length minus
 *    `--cp-form-nest`, what the boxes around the row inset);
 *  - a wide control (`Block`) full width under its label;
 *  - nesting as one cue, a tinted box (`cp-form-box`): a `Group` is its label
 *    over one box of its members, a list item (`Group item`) is a box with its
 *    header inside it;
 *  - a hairline only between top-level fields — each one is its own band.
 *
 * Like the pane it owns neither the scroll nor the width, and it wraps its
 * children in a `ControlPanel.Stack` so a group past the inline budget still
 * has somewhere to push.
 */
export function ControlPanelForm({ label, children }: ControlPanelFormProps) {
  return (
    <ControlPanel aria-label={label} className="cp-pane cp-form">
      <ControlPanelHostProvider host={FORM_HOST}>
        <ControlPanelStack root={children} />
      </ControlPanelHostProvider>
    </ControlPanel>
  );
}

const FORM_HOST: ControlPanelHost = {
  nesting: "inline",
  // A box costs one box inset, not a rail step, so a form inlines three group
  // levels — e.g. an object holding a list of records whose items hold an
  // object (three boxes; a list's items are boxes, the list itself is not) —
  // before a deeper group falls back to a push.
  inlineDepth: 3,
  descriptions: "label",
  sections: "label",
  layout: "form",
};
