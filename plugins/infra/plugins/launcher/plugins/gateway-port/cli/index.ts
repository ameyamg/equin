import { defineCliCommand } from "@plugins/framework/plugins/cli/core";

/**
 * `./equin url` — this checkout's address on this account's port (main's from
 * the main checkout, for install.sh or a person; a worktree's own build from an
 * agent worktree): the one place a shell learns the port without spelling it.
 */
export default defineCliCommand<[], object>({
  name: "url",
  description:
    "Print the address this checkout's own app is served at on this account once built (http://equin.localhost:<port> from the main checkout, http://<worktree>.localhost:<port> from a worktree; a `--composition` build is at <composition>.<checkout> — the port is chosen once from 8700–8709 by `./equin start`). Reads only.",
  run: () => import("./url"),
});
