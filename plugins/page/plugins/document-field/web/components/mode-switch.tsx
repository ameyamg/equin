import { SegmentedControl } from "@plugins/primitives/plugins/css/plugins/toggle-chip/web";
import type { DocumentFieldMode } from "./document-field";

const OPTIONS = [
  { id: "markdown", label: "Markdown", tooltip: "Markdown  ⌘⇧M" },
  { id: "rich", label: "Rich", tooltip: "Rich  ⌘⇧M" },
] as const;

/**
 * The Markdown | Rich switch of a document field. A press does not take focus
 * from the field, so the caret is carried into the other face; reached by Tab,
 * it acts like any switch.
 */
export function DocumentFieldModeSwitch({
  mode,
  onModeChange,
}: {
  mode: DocumentFieldMode;
  onModeChange(mode: DocumentFieldMode): void;
}) {
  return (
    // Keeps the field focused through a press (the caret is carried over).
    <div className="contents" onMouseDownCapture={(e) => e.preventDefault()}>
      <SegmentedControl
        label="Editor view"
        variant="track"
        options={OPTIONS}
        value={mode}
        onChange={onModeChange}
      />
    </div>
  );
}
