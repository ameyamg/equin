import { defineDbTriggers } from "@plugins/database/plugins/db-triggers/server";

// ── A finished run lasts until a new run begins on the task ──────────
//
// An agent that closes its run with `exit_clean` and nothing to land finished
// non-code work: `recordFinishedRun` writes an `attempt_deliveries` row of
// basis `nothing-to-land`, so the attempt reads `completed` and its task `done`.
// That claim is about THAT run. A conversation of the attempt that starts or
// resumes working (a Resume, a supervisor's reopen, a fork onto the attempt)
// is new work the claim says nothing about. Left standing, the delivery would
// read `completed` at every idle moment of the new run, so its uncommitted work
// would read `done` and unblock dependents, and the live attempt would read
// `pushed` with no push.
//
// So the database drops the claim the moment a NEW run begins on the task, in
// the writing statement, whatever path wrote it:
//
// - a conversation inserted on any attempt of the task (a fork, a relaunch on
//   a new attempt) — `system` ones excepted, they do no work on the task;
// - a closed (`done`) conversation reopened — resume and retry turn it
//   `starting` (a `waiting` row keeps its status, but a finished run is
//   always closed);
// - a conversation moved onto an attempt of the task.
//
// NOT on any write of a live status: the status reconciler rewrites `working`
// on a conversation that never stopped (`statusWrite` re-sets the same value,
// and an UPDATE OF trigger fires on it), which in exit_clean's own window
// between the delivery and the close would erase a run that did finish.
//
// A `scratch` delivery is a scratch workspace's landed fact, and it stays.
// The status writes run inside `withTaskStatusChange`, so the task's status
// change is emitted as usual.

const ON_WORK_FN = `CREATE OR REPLACE FUNCTION tasks_finished_run_on_work()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.kind = 'system' OR NEW.status = 'done' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.status <> 'done'
     AND OLD.attempt_id = NEW.attempt_id THEN
    RETURN NULL;
  END IF;
  DELETE FROM attempt_deliveries d
   USING attempts a, attempts mine
   WHERE mine.id = NEW.attempt_id
     AND a.task_id = mine.task_id
     AND d.attempt_id = a.id
     AND d.basis = 'nothing-to-land';
  RETURN NULL;
END;
$$`;

export const finishedRunTriggers = defineDbTriggers({
  id: "tasks.finished-run",
  functions: [
    { name: "tasks_finished_run_on_work", args: "", ddl: ON_WORK_FN },
  ],
  triggers: [
    {
      name: "tasks_finished_run_on_work",
      table: "conversations",
      ddl: `CREATE OR REPLACE TRIGGER tasks_finished_run_on_work
  AFTER INSERT OR UPDATE OF status, attempt_id ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION tasks_finished_run_on_work()`,
    },
  ],
});
