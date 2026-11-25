import { defineDbTriggers } from "@plugins/database/plugins/db-triggers/server";

// A `ctx.waitFor`'s one-shot event trigger lives exactly as long as its wait.
//
// The wait can end many ways: its event fires (the dispatcher deletes a fired
// one-shot row itself), its timeout racer resumes it, the arm-time `settled`
// recheck resolves it, a replay ends it orphaned, `abortDurableRun` cancels it,
// `jobs.resume`'s `onDead` closes it, a finished or dead run's log is
// discarded. Every path but the first used to leave the trigger row behind —
// 502 on main by 2026-11-25 (465 `supervisedRun.ended`, 37
// `conversation.turn-completed`), the oldest from May — and a stale
// turn-completed row makes the turn-emitter's restart replay take its
// conversation for one a workflow still waits on.
//
// So the database ends it, not each path: the wait records the trigger row it
// armed (`trigger_table`, `trigger_id`, written in the arming transaction) and
// this trigger deletes that row the instant the wait leaves `pending` or is
// deleted while pending. A path added later cannot forget it. The table is
// looked up by name first: a trigger table dropped since (its event removed)
// has nothing left to delete, and must not fail the wait's write.
const DISARM_FN = `CREATE OR REPLACE FUNCTION jobs_wait_disarm_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF to_regclass(format('public.%I', OLD.trigger_table)) IS NOT NULL THEN
    EXECUTE format('DELETE FROM public.%I WHERE id = $1', OLD.trigger_table)
      USING OLD.trigger_id;
  END IF;
  RETURN NULL;
END;
$$`;

export const waitTriggerLifetime = defineDbTriggers({
  id: "jobs.wait-trigger",
  functions: [{ name: "jobs_wait_disarm_trigger", args: "", ddl: DISARM_FN }],
  triggers: [
    {
      name: "job_waits_disarm_on_end",
      table: "job_waits",
      ddl: `CREATE OR REPLACE TRIGGER job_waits_disarm_on_end
  AFTER UPDATE OF status ON job_waits
  FOR EACH ROW
  WHEN (OLD.status = 'pending' AND NEW.status <> 'pending' AND OLD.trigger_id IS NOT NULL)
  EXECUTE FUNCTION jobs_wait_disarm_trigger()`,
    },
    {
      name: "job_waits_disarm_on_delete",
      table: "job_waits",
      ddl: `CREATE OR REPLACE TRIGGER job_waits_disarm_on_delete
  AFTER DELETE ON job_waits
  FOR EACH ROW
  WHEN (OLD.status = 'pending' AND OLD.trigger_id IS NOT NULL)
  EXECUTE FUNCTION jobs_wait_disarm_trigger()`,
    },
  ],
});
