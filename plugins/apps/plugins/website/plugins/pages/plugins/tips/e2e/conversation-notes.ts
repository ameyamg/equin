// The tip "Conversation notes": the note button under a conversation's prompt
// opens a note for yourself (never sent to the agent) — what someone juggling
// many conversations keeps there: what this one is about, or a follow-up to
// ask before closing it — and deleting its text once it's done hides it again.
//
//   ./equin run plugins/apps/plugins/website/plugins/pages/plugins/tips/e2e/conversation-notes.ts --composition promo-film
//
// The take types a note and deletes it again, so it leaves no note behind; a
// take stopped half-way does — `./equin promo-film seed` resets it.
// See this plugin's CLAUDE.md (Tip videos) for the flags and the steps.

import type { E2eScript } from "@plugins/framework/plugins/tooling/plugins/e2e-harness/core";
import { tipVideo } from "./internal/tip-video";

export const e2e = {
  kind: "tool",
  target: { composition: "promo-film" },
  writes: true,
  run: {
    manual: ["heavy"],
    why: "Records and renders one tip's video (minutes of frame-by-frame capture).",
  },
} satisfies E2eScript;

/** The film's Grieg conversation, waiting on the user: its agent's last answer frames the note. */
const CONVERSATION = "/agents/c/conv-1792800000-film01";
/** The note toggle's label while the note is closed and empty. */
const ADD_NOTE = "Add a note for yourself — never sent";
/** The toggle under any of its labels (closed, open and empty, written). */
const NOTE_TOGGLE = /^(Add a note for yourself|Hide note|Clear the note)/;

await tipVideo({
  slug: "conversation-notes",
  path: CONVERSATION,
  cursor: { x: 760, y: 420 },
  async prepare(page) {
    await page
      .getByRole("button", { name: ADD_NOTE })
      .waitFor({ state: "visible", timeout: 30_000 });
    // The prompt's exit button, settled: the run's edited files make it
    // Push & Close (the in-frame button reads its decision, never a
    // still-loading or unknown one).
    await page
      .getByRole("button", { name: "Push & Close", exact: true })
      .waitFor({ state: "visible", timeout: 30_000 });
  },
  async script(r) {
    const page = r.page;
    // The toggle keeps its place while its label follows the note's state.
    const toggle = page.getByRole("button", { name: NOTE_TOGGLE });
    const note = page.getByRole("textbox", { name: "Conversation notes" });
    // The end of the agent's last answer (the MIDI it fetched, the question
    // it ends on), and the prompt under it.
    const question = page
      .getByText("Want me to add it to your Repertoire")
      .last();
    const prompt = page.locator('[contenteditable="true"]').last();

    // In on the end of the conversation and its prompt, the hand on its way.
    await r.focus([question, prompt, toggle], { margin: 36, maxZoom: 1.6 });
    await r.move(toggle);
    await r.hold(0.5);
    await r.click(toggle);
    await r.hold(0.35);

    // The note opens above the prompt: a follow-up not to forget before
    // closing — the kind of thing anyone working with agents writes there.
    // (Opening it does not focus it: the hand clicks in.)
    await r.focus([question, note, toggle], { margin: 32, maxZoom: 1.8 });
    await r.click(note);
    await r.hold(0.2);
    await r.type("Before closing: ask it to double-check the MIDI", {
      cps: 16,
    });
    await r.hold(1.6);

    // Done with it: deleting its text hides the note again.
    await r.press("ControlOrMeta+A");
    await r.hold(0.25);
    await r.press("Backspace");
    await r.hold(0.8);
    await r.unfocus();
    await r.hold(1.2);
  },
});
