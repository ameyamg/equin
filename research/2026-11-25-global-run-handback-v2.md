# A run's last message is its report (v2)

Supersedes the routing machinery of `2026-11-25-global-run-handback.md` (v1:
turn origins on every ledger row, quiet updates). The user found v1 too
complex; this is the model they approved.

## Context

`submit_outcome_report` and its stop gate forced agents whose mandate grants
`report.required` (supervisor workers, automations) to file a final report
before every stop. Incident `conv-1795638366-ye3yup`: the worker asked the
user with `AskUserQuestion`, got an answer, replied, and was then made to
file a "final" report mid-conversation, and again on every later turn.

Claude Code's subagents have no report tool: the end of a run is its result,
returned to whoever started it.

## The model

**An agent's last message is its report, sent to whoever started it.**

- **Nobody but its starter in the run:** each stop is handed back by
  default, with no call. The exception is a stop the agent will be woken
  from anyway (a stop-gate `StopWaiver`: background work, a busy watched
  subtree, a compaction), which is only a pause.
- **The user has talked to it** (a turn they sent, or an answer to its
  `AskUserQuestion`): before ending each turn the agent calls
  `turn_for({ to: "user" | "supervisor" })`, and a stop gate holds it to
  that. `user`: the reply is theirs, and nobody else is told. `supervisor`:
  the turn's last message is handed back. A hand-back resets the run: later
  stops are handed back by default until the user speaks again.
- **Blocked on the user:** `AskUserQuestion`. Watchers hear `asking` once and
  the bell rings. Decisions stay the supervisor root's.

## Implementation

- `outcome-report/machine/internal/run-state.ts`: `readRunState` and the pure
  `runEnd` / `userInRun`. It reads:
  - turn-ledger's new `latestPersonTurnAt`
  - question-relay's new `latestAnswerAt`
  - the task's report row (the last hand-back)
  - `outcome_report_turn_addressees` (the latest `turn_for`)
- `handback.ts`: the `outcome-report.hand-back` job on
  `conversation.turn-completed` (its payload has the last message).
  - It calls `runEnd` with stop-gate's new `wakeReasons`.
  - The standing comes from `getAttemptStanding`; if it can't be measured,
    the job fails.
  - It upserts the report, then emits `outcomeReport.submitted`, which
    becomes the watch event `reported`. The automations' slot watcher
    releases the slot, as before.
- `turn-for.ts` is the tool, and `stop-gate.ts` is the gate (it blocks only
  when the user is in the run and no `turn_for` came after the user's latest
  word).
- `question-bell.ts` rings the bell on a `waitingFor: "question"` change, and
  `watch-source.ts` emits `asking` on the same change.
- Deleted:
  - `submit_outcome_report`
  - `next-step.ts`
  - the old gate
  - the report's `question` / `answers` and the card's answer buttons
  - the tool-call renderer `jsonl-viewer/tool-call/outcome-report`
- Prompts:
  - the Mandate line (`{{turnForTool}}`)
  - the sidequest-autopilot prompt (ask only the person's own calls, with
    AskUserQuestion; the last message is the report)
  - `exitWhenDone` (no "report submitted" clause)

Known inaccuracy: the sdk runtime's auto-resume after an API error is a
`turn` (only a `turn` resumes a stopped conversation), so it reads as the
user's word. The agent is then asked for `turn_for` once, and answers
`supervisor`.

## Verification

- Unit: `run-state.test.ts` (`userInRun`, `runEnd`), and the
  prompts-unchanged pins.
- On the build: launch a supervisor worker.
  - It ends with no tool call, and its report reaches the supervisor.
  - It asks, and the bell rings.
  - After you answer, it is asked for `turn_for` at its stop, with no
    forced-report feedback.
