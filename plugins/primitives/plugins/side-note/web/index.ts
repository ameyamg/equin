import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";

export { SideNoteArea } from "./components/side-note-area";
export { SideNoteToggle } from "./components/side-note-toggle";
export { useSideNote } from "./internal/use-side-note";
export type { SideNoteRow, SideNoteState } from "./internal/use-side-note";

export default {
  description:
    "A private note beside a composer — text the user keeps for themselves, never sent: SideNoteToggle (the note icon: opens and hides an empty note, a dot while it has text, following the draft as typed) and SideNoteArea (the auto-saved editor, shown while it has text or is opened; deleting the last of the text closes it, Ctrl+Z brings it back), sharing one note's state by its subject. The owner stores the note and passes its live read and save.",
  contributions: [],
} satisfies PluginDefinition;
