import type { MouseEvent, ReactElement } from "react";
import { flushSync } from "react-dom";
import type { LiveRowResult } from "@plugins/network/plugins/live/web";
import { cn } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { ResourceErrorInline } from "@plugins/network/plugins/live/plugins/live-state/web";
import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Pin } from "@plugins/primitives/plugins/css/plugins/pin/web";
import { StatusDot } from "@plugins/primitives/plugins/css/plugins/status-dot/web";
import {
  findScrollParent,
  keepInPlace,
} from "@plugins/primitives/plugins/dom/plugins/auto-scroll/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { useSideNote, type SideNoteRow } from "../internal/use-side-note";

const stickyNote2Icon = symbol("sticky-note-2");

/**
 * The note's toggle: opens and hides an empty note. A note with text always
 * shows, and marks the button with a dot on the icon's corner — following the
 * editor's draft as it is typed, not the debounced save.
 */
export function SideNoteToggle({
  subject,
  read,
}: {
  /** The note's page-wide identity, shared with its SideNoteArea. */
  subject: string;
  read: LiveRowResult<SideNoteRow>;
}): ReactElement | null {
  const { isVisible, hasText, toggleVisible } = useSideNote({ subject, read });

  // Nothing to offer until the note is known: "Add note" over a note that
  // exists would be a lie. A failed read keeps the button's face and says so —
  // it is the one place the failure is reported (the area stays hidden).
  if (read.status === "loading") return null;
  if (read.status === "error")
    return (
      <ResourceErrorInline
        variant="icon"
        icon={stickyNote2Icon}
        subject="the note"
        error={read.error}
        refetch={read.refetch}
      />
    );

  return (
    // The positioning context the written-note dot pins to.
    <Stack as="span" direction="row" gap="none" className="relative">
      <IconButton
        icon={stickyNote2Icon}
        glyph="small"
        className={cn(!isVisible && "text-muted-foreground")}
        label={
          hasText
            ? "Clear the note to hide it"
            : isVisible
              ? "Hide note"
              : "Add a note for yourself — never sent"
        }
        active={isVisible}
        aria-pressed={isVisible}
        onClick={(e: MouseEvent<HTMLElement>) => {
          // The note opens (or closes) ABOVE its toggle, so the toggle would
          // be pushed down — out from under the pointer, off screen at the
          // bottom of a pane. Keep it where it is instead: the scroller takes
          // the note's height, in the same frame.
          const button = e.currentTarget;
          keepInPlace(findScrollParent(button), button, () =>
            flushSync(toggleVisible),
          );
        }}
      />
      {hasText && (
        <Pin to="top-right" offset="xs" decorative>
          <StatusDot colorClass="bg-warning" />
        </Pin>
      )}
    </Stack>
  );
}
