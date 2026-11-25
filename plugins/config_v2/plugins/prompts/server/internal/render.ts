import type { ConfigDescriptor } from "@plugins/config_v2/core";
import { getConfig } from "@plugins/config_v2/server";
import type { FieldsRecord } from "@plugins/fields/core";
import {
  fillPrompt,
  type PromptKey,
  type PromptText,
  type PromptVariablesOf,
} from "@plugins/config_v2/plugins/prompts/core";

/** A prompt field as the user saved it now, filled with its variables. */
export function renderConfigPrompt<
  F extends FieldsRecord,
  K extends PromptKey<F>,
>(
  descriptor: ConfigDescriptor<F>,
  key: K,
  variables: Readonly<Record<PromptVariablesOf<F[K]>, string>>,
): PromptText {
  return fillPrompt(descriptor, getConfig(descriptor), key, variables);
}
