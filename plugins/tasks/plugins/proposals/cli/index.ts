import { defineCliCommand } from "@plugins/framework/plugins/cli/core";

export interface ProposeOptions {
  message: string;
  only?: string[];
}

/**
 * `./equin propose -m "<why>"` — from an agent's worktree: hand the records
 * it edited through its own build (every registered record type: a site feed
 * item, …) to main as proposals the user reviews in the view that owns them.
 */
export default defineCliCommand<[], ProposeOptions>({
  name: "propose",
  description:
    "From an agent worktree: propose to main every record of a registered type (a website tip, …) this worktree's build changed since its database was forked — main's copy is never written until the user accepts it in the view that owns it. Its files are copied first. Run again after a change request: the new revision replaces the open one. Needs this worktree built (./equin build).",
  options: [
    {
      flags: "-m, --message <why>",
      description:
        "What changed and why — shown to the user with the proposal (required)",
    },
    {
      flags: "--only <type:id...>",
      description:
        "Propose only these records (e.g. site-feed-item:sfe-…); default: every record this worktree changed",
    },
  ],
  run: () => import("./run"),
});
