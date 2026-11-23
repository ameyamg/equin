import type { Guard } from "@plugins/framework/plugins/tooling/plugins/guards/core";

/**
 * The 'may manage tasks it doesn't own' grant is a person's to switch, from
 * the task header. Its route refuses a request no browser sent (an agent's
 * `curl`, a script), but a client can forge a browser's headers; so an
 * agent's shell command calling the route — a task id, or a variable, where
 * the `:taskId` param sits — is refused before it runs. The route spelled
 * with its `:param` (a commit message, a doc) is not a call and passes.
 * Best-effort, like the route's own check: it reads the command's text.
 */
const ROUTE = /\/api\/tasks\/[^\s/'":][^\s/'"]*\/manage-grant\b/;

const guard: Guard<{ command?: string }> = {
  name: "manage-grant-person-only",
  matcher: "Bash",
  check: (input, ctx) =>
    ROUTE.test(input.command ?? "")
      ? ctx.deny(
          "Only a person switches a task's 'may manage tasks it doesn't own' grant, from the task header in the app. An agent never sets it, on any task (its own included) — ask the user to switch it.",
        )
      : ctx.allow(),
};

export default guard;
