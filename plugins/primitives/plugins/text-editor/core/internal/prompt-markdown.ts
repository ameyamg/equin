import { z } from "zod";

/**
 * Markdown a person wrote for an agent in the prompt field (`TextEditor`): it
 * may carry attachment refs (`![](/api/attachments/<id>)`, pasted images and
 * files) and chips (`<ui-context …/>`, tokens), which the server resolves
 * before the agent reads it.
 *
 * Why a brand: an endpoint whose body carries a person's text for an agent
 * declares it with {@link PromptMarkdownSchema}, branded on its input too
 * (`"inout"`), so the body's type is this, not `string`. A plain field's text
 * (a ui-kit `Textarea`'s `e.target.value`) is a `string` and does not compile
 * there: such a field drops pasted images and draws no chips, so the endpoint
 * has no spelling that takes it. The editor is the producer (its `onChange`,
 * its kept value, `useTakeMarkdownWith` / `useReadMarkdown`); text the code
 * itself writes for an agent says so with {@link writtenPrompt}.
 */
const branded = z.string().brand<"PromptMarkdown", "inout">();

/** See {@link PromptMarkdownSchema}. A subtype of `string`: any string API reads it. */
export type PromptMarkdown = z.output<typeof branded>;

// zod 4 puts a brand on `_zod.output` / `_zod.input` only; the classic
// `_output` / `_input` stay `string`, so a `z.ZodType<PromptMarkdown>` slot (a
// store's or a kept draft's `schema`) would refuse the branded schema. The
// one cast restates the brand there too — no runtime difference.
export const PromptMarkdownSchema = branded as typeof branded & {
  readonly _output: PromptMarkdown;
  readonly _input: PromptMarkdown;
};

/** This file's mint: the helpers below keep the prompt they were given. */
function mintPromptMarkdown(markdown: string): PromptMarkdown {
  return markdown as PromptMarkdown;
}

/** The empty prompt — a field's initial value. */
export const EMPTY_PROMPT: PromptMarkdown = mintPromptMarkdown("");

/** The prompt without its leading and trailing whitespace, still a prompt. */
export function trimPrompt(markdown: PromptMarkdown): PromptMarkdown {
  return mintPromptMarkdown(markdown.trim());
}

/** Whether the prompt holds nothing but whitespace. */
export function isBlankPrompt(markdown: PromptMarkdown): boolean {
  return markdown.trim() === "";
}

/**
 * Text the CODE writes for an agent — a fixed instruction, a template from
 * config, a choice the agent itself offered (`<go>`) — as a prompt. Never a
 * person's typed text: that comes from the editor, so its pasted images and
 * chips come with it.
 */
export function writtenPrompt(text: string): PromptMarkdown {
  return mintPromptMarkdown(text);
}

/**
 * A prompt read back from where one was kept — a turn's record, a stopped
 * turn's rewound text, a sent answer parsed back from the transcript: it was
 * the editor's markdown when it was written. Never a plain field's text.
 */
export function storedPrompt(text: string): PromptMarkdown {
  return mintPromptMarkdown(text);
}
