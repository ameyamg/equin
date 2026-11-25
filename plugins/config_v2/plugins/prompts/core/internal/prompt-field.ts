import { z } from "zod";
import type { DeclaredDefault, Labelled } from "@plugins/fields/core";
import {
  multilineTextField,
  type MultilineTextFieldDef,
} from "@plugins/fields/plugins/multiline-text/plugins/config/core";
import { unknownTemplateVariables } from "@plugins/packages/plugins/prompt-template/core";

/** A variable a prompt field is filled with on every render. */
export interface PromptFieldVariable<N extends string = string> {
  readonly name: N;
  /** What it holds, for the person editing the prompt. */
  readonly description: string;
}

/**
 * A prompt the user edits: a multiline config field (Settings → Config draws
 * it as one) whose template may use only the variables it declares.
 */
export interface PromptFieldDef<
  N extends string = string,
> extends MultilineTextFieldDef {
  readonly variables: readonly PromptFieldVariable<N>[];
}

/** The variable names a prompt field is filled with. */
export type PromptVariablesOf<D> =
  D extends PromptFieldDef<infer N> ? N : never;

function variablesHint(variables: readonly PromptFieldVariable[]): string {
  if (variables.length === 0) return "It is filled with no variable.";
  return `Filled at each use: ${variables.map((v) => `{{${v.name}}} (${v.description})`).join(", ")}.`;
}

/**
 * An agent prompt as config: what an agent is told, edited by the user in
 * Settings → Config, its default the wording the code ships. The template may
 * use `{{name}}` for each declared variable and nothing else: its schema
 * refuses any other, so `setConfig` refuses the save — wherever it comes from
 * (Settings → Config, a pane, the API) — and a hand-edited override naming one
 * resolves to the origin as an invalid document instead of rendering a hole.
 * The description lists the variables for the person editing it.
 */
export function promptField<const N extends string = never>(opts: {
  label: string;
  description: string;
  default: string;
  rows?: number;
  variables?: readonly PromptFieldVariable<N>[];
}): PromptFieldDef<N> & DeclaredDefault & Labelled {
  const variables = Object.freeze([...(opts.variables ?? [])]);
  const base = multilineTextField({
    label: opts.label,
    description: `${opts.description} ${variablesHint(variables)}`,
    default: opts.default,
    rows: opts.rows,
  });
  const schema = z.string().superRefine((template, ctx) => {
    const unknown = unknownTemplateVariables(template, variables);
    if (unknown.length === 0) return;
    const offered =
      variables.length === 0
        ? "it is filled with no variable"
        : `it is filled with ${variables.map((v) => `{{${v.name}}}`).join(", ")} only`;
    ctx.addIssue({
      code: "custom",
      message: `"${opts.label}" uses ${unknown.map((n) => `{{${n}}}`).join(", ")}: ${offered}.`,
    });
  });
  return Object.freeze({
    ...base,
    schema,
    variables,
  }) as PromptFieldDef<N> & DeclaredDefault & Labelled;
}
