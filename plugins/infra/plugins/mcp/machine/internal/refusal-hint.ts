import { HttpError } from "@plugins/infra/plugins/endpoints/core";
import { renderConfigPrompt } from "@plugins/config_v2/plugins/prompts/server";
import { mcpPromptsConfig } from "../../core";

/**
 * Whether a handler's throw is a deliberate refusal — what the tool decided
 * the agent asked for wrongly (a 4xx `HttpError`) — rather than a crash.
 */
function isRefusal(err: unknown): err is HttpError {
  return err instanceof HttpError && err.status >= 400 && err.status < 500;
}

/**
 * `err` with `hint` appended to its message (after a blank line) when it is a
 * refusal and the hint is not blank; any other throw, unchanged. Pure, so the
 * rule is tested without a config store.
 */
export function withRefusalHint(err: unknown, hint: string): unknown {
  if (!isRefusal(err) || hint.trim() === "") return err;
  const hinted = new HttpError(err.status, `${err.message}\n\n${hint}`);
  hinted.stack = err.stack;
  return hinted;
}

/**
 * A tool handler's throw as the agent should receive it: a refusal carries
 * the "When a tool refuses" prompt (Settings → Config, empty by default), so
 * the user can say where a wrong refusal is reported — the code knows no such
 * place. The config is read only for a refusal.
 */
export function hintedThrow(err: unknown): unknown {
  if (!isRefusal(err)) return err;
  return withRefusalHint(
    err,
    renderConfigPrompt(mcpPromptsConfig, "refusalHint", {}),
  );
}
