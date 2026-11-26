import { useLayoutEffect, useState, type ReactElement } from "react";
import type { LiveRowResult } from "@plugins/network/plugins/live/web";
import { Pin } from "@plugins/primitives/plugins/css/plugins/pin/web";
import {
  cn,
  Textarea,
} from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { useEditableField } from "@plugins/primitives/plugins/editable-field/web";
import { setDraft, setOpen } from "../internal/side-note-store";
import { useSideNote, type SideNoteRow } from "../internal/use-side-note";

/**
 * The note's one editor. It owns the draft and publishes it, so the toggle's
 * dot follows the text as it is typed rather than the debounced save.
 */
export function SideNoteArea({
  subject,
  read,
  save,
  keepField,
  ariaLabel,
}: {
  /** The note's page-wide identity, shared with its SideNoteToggle. */
  subject: string;
  /** The owner's live read of the note row (`found: false`: no note). */
  read: LiveRowResult<SideNoteRow>;
  /** Saves the text; `""` deletes the note. */
  save: (next: string) => Promise<void>;
  /** The kept-state field unsaved text is kept under (with `subject`). */
  keepField: string;
  ariaLabel: string;
}): ReactElement | null {
  const { saved, isVisible: shown } = useSideNote({ subject, read });
  const [isFocused, setIsFocused] = useState(false);

  const { keep, value, onFocus, onBlur, isSaving } = useEditableField<string>({
    value: saved,
    onSave: save,
    debounceMs: 1000,
    keep: { field: keepField, subject },
  });

  // Before paint, so the toggle's dot never lags the text by a frame.
  useLayoutEffect(() => {
    setDraft(subject, value);
  }, [subject, value]);
  useLayoutEffect(() => () => setDraft(subject, undefined), [subject]);

  const hasText = value.trim().length > 0;

  // The editor mounts only over a known note: seeded from a not-yet-loaded ""
  // it would race the real value in. A failed read is reported by the toggle
  // (SideNoteToggle), not a second time here.
  if (read.status !== "ready") return null;
  const isVisible = hasText || shown;
  // Emptied while being typed in, the note hides — but the editor stays
  // mounted and focused (visually hidden) until it blurs, so the next
  // keystroke or Ctrl+Z (the browser's own undo history) brings it back.
  if (!isVisible && !isFocused) return null;

  return (
    <div className={cn("relative", !isVisible && "sr-only")}>
      <Textarea
        bare
        keep={keep}
        onChange={(e) => {
          // Deleting the last of the text closes the note.
          if (hasText && e.target.value.trim() === "") setOpen(subject, false);
        }}
        onFocus={() => {
          setIsFocused(true);
          onFocus();
        }}
        onBlur={() => {
          setIsFocused(false);
          onBlur();
        }}
        placeholder="Notes…"
        // Grows with the text (field-sizing) from ~2 to ~12 lines, then
        // scrolls — a long note is never hidden behind a 2-line scrollbox.
        className="field-sizing-content max-h-[12lh] min-h-[3lh] w-full resize-y rounded-md border border-warning/60 bg-warning/10 px-md py-sm text-caption placeholder:text-warning/70 focus:outline-none focus:ring-1 focus:ring-warning"
        aria-label={ariaLabel}
      />
      {isSaving && isVisible && (
        <Pin
          as="span"
          to="bottom-right"
          decorative
          // off-ramp insets: right-2 / bottom-1.5 aren't a single ramp step
          style={{ right: "0.5rem", bottom: "0.375rem" }}
          className="text-3xs text-muted-foreground select-none"
        >
          Saving…
        </Pin>
      )}
    </div>
  );
}
