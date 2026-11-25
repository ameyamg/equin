import type { ConfigDescriptor, ConfigValues } from "@plugins/config_v2/core";
import type { FieldsRecord } from "@plugins/fields/core";
import { renderPrompt } from "@plugins/packages/plugins/prompt-template/core";
import type { PromptFieldDef, PromptVariablesOf } from "./prompt-field";

declare const promptTextBrand: unique symbol;

/**
 * Text an agent is told that came from a prompt the user can edit: only
 * {@link fillPrompt} (and the joins below, over such text) makes one. A
 * system-prompt section and a mandate capability return this, never a
 * `string`, so prose written in code does not type-check — the words are a
 * prompt field's, the code supplies only whether it applies and the data it
 * is filled with.
 */
export type PromptText = string & { readonly [promptTextBrand]: true };

/** The keys of a config's fields that are prompt fields. */
export type PromptKey<F extends FieldsRecord> = {
  [K in keyof F & string]: F[K] extends PromptFieldDef ? K : never;
}[keyof F & string];

/**
 * One prompt field's saved template (`values[key]`, as read from `descriptor`)
 * filled with its variables — every declared one required by tsc. A template
 * naming a variable it was not given throws, naming the config: the field's
 * schema refuses that at save, so it means a broken assumption.
 */
export function fillPrompt<F extends FieldsRecord, K extends PromptKey<F>>(
  descriptor: ConfigDescriptor<F>,
  values: ConfigValues<F>,
  key: K,
  variables: Readonly<Record<PromptVariablesOf<F[K]>, string>>,
): PromptText {
  const template = (values as Record<string, unknown>)[key];
  if (typeof template !== "string")
    throw new Error(
      `Prompt "${key}" of config "${descriptor.name}" is not a string.`,
    );
  const rendered = renderPrompt(
    template,
    variables as Readonly<Record<string, string>>,
  );
  if (!rendered.ok)
    throw new Error(
      `Prompt "${key}" of config "${descriptor.name}" (Settings → Config) uses ${rendered.unknown.map((n) => `{{${n}}}`).join(", ")}, which it is not filled with.`,
    );
  return rendered.text as PromptText;
}

/**
 * Prompt texts joined by a line break or a blank line, blank ones left out;
 * `null` when none is left. The separator is structure, never words.
 */
export function joinPrompts(
  parts: readonly (PromptText | null)[],
  separator: "\n" | "\n\n" = "\n\n",
): PromptText | null {
  const kept = parts.filter(
    (p): p is PromptText => p !== null && p.trim() !== "",
  );
  return kept.length === 0 ? null : (kept.join(separator) as PromptText);
}

/** Prompt texts as a markdown bullet list (`- ` each, one per line); `null`
 * when none is left. */
export function promptList(
  items: readonly (PromptText | null)[],
): PromptText | null {
  const kept = items.filter(
    (p): p is PromptText => p !== null && p.trim() !== "",
  );
  return kept.length === 0
    ? null
    : (kept.map((p) => `- ${p}`).join("\n") as PromptText);
}
