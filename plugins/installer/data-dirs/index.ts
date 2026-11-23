import { defineDataDir } from "@plugins/infra/plugins/paths/core";

/**
 * One directory per install run (`<run-id>/`), written by install.sh itself
 * (it names this path by hand: it runs before any of the repo exists):
 * `events.jsonl` (every event of the run, what the window and the terminal
 * drew), `events.fifo` (the hub every writer reaches), and `timing.json`
 * (how long each step took, when the install finished — the input of
 * `./equin installer estimates`), `install.log` (every log line of the run,
 * whole). `latest` links the newest run; each run prunes the dirs older than
 * the newest 10.
 */
export const installRunsDir = defineDataDir({
  kind: "logs",
  name: "install",
  owner: "installer",
  description:
    "Install runs (one dir per run of install.sh): the run's event stream, its hub FIFO and, once it finished, its per-step timing; `latest` links the newest",
  // The record of past installs; the medians already taken are in
  // installer/core's estimates.json. install.sh enforces the count itself:
  // each run removes the run dirs older than the newest 10 (`prune_runs`).
  reclaim: { kind: "keep", keep: 10 },
  logs: [
    {
      pattern: "*/events.jsonl",
      bound: {
        kind: "truncate-on-start",
        reason:
          "one file per install run, written by that run only; install.sh keeps the newest 10 run dirs and removes the rest",
      },
    },
    {
      pattern: "*/install.log",
      bound: {
        kind: "truncate-on-start",
        reason:
          "one file per install run (every log line of its steps, whole), written by that run only; install.sh keeps the newest 10 run dirs and removes the rest",
      },
    },
  ],
});

export default [installRunsDir];
