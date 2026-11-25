-- Custom SQL migration file, put your code below! --
-- migration: 20261125_131201__drop_stale_wait_triggers --
-- A ctx.waitFor's one-shot trigger row used to outlive its wait whenever the
-- wait ended any way but its event firing (timed out, resolved by the settled
-- recheck, cancelled, its run's log discarded): 502 such rows on main by
-- 2026-11-25. Waits now record the trigger row they armed, and the
-- jobs.wait-trigger DB trigger deletes it when the wait ends. Once, per event
-- table: a still-pending wait adopts its trigger row (so its end deletes it),
-- and every jobs.resume row whose wait is no longer pending is deleted.

UPDATE job_waits w SET trigger_table = 'conversation_created_triggers', trigger_id = tr.id
  FROM "conversation_created_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "conversation_created_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'conversation_flagRaised_triggers', trigger_id = tr.id
  FROM "conversation_flagRaised_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "conversation_flagRaised_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'conversation_runHandedOver_triggers', trigger_id = tr.id
  FROM "conversation_runHandedOver_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "conversation_runHandedOver_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'conversation_statusChanged_triggers', trigger_id = tr.id
  FROM "conversation_statusChanged_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "conversation_statusChanged_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'conversation_turn-completed_triggers', trigger_id = tr.id
  FROM "conversation_turn-completed_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "conversation_turn-completed_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'conversation_userTurnSent_triggers', trigger_id = tr.id
  FROM "conversation_userTurnSent_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "conversation_userTurnSent_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'events_test_pinged_triggers', trigger_id = tr.id
  FROM "events_test_pinged_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "events_test_pinged_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'git_refAdvanced_triggers', trigger_id = tr.id
  FROM "git_refAdvanced_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "git_refAdvanced_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'host_idleBegan_triggers', trigger_id = tr.id
  FROM "host_idleBegan_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "host_idleBegan_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'host_idleEnded_triggers', trigger_id = tr.id
  FROM "host_idleEnded_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "host_idleEnded_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'outcomeReport_submitted_triggers', trigger_id = tr.id
  FROM "outcomeReport_submitted_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "outcomeReport_submitted_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'page_blocksChanged_triggers', trigger_id = tr.id
  FROM "page_blocksChanged_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "page_blocksChanged_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'pushes_landed_triggers', trigger_id = tr.id
  FROM "pushes_landed_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "pushes_landed_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'sonata_ug_tabSaved_triggers', trigger_id = tr.id
  FROM "sonata_ug_tabSaved_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "sonata_ug_tabSaved_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'supervisedRun_ended_triggers', trigger_id = tr.id
  FROM "supervisedRun_ended_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "supervisedRun_ended_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'supervisorRoles_backlogArrived_triggers', trigger_id = tr.id
  FROM "supervisorRoles_backlogArrived_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "supervisorRoles_backlogArrived_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'supervisorRoles_iconStale_triggers', trigger_id = tr.id
  FROM "supervisorRoles_iconStale_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "supervisorRoles_iconStale_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'supervisorRoles_listingChanged_triggers', trigger_id = tr.id
  FROM "supervisorRoles_listingChanged_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "supervisorRoles_listingChanged_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'tasks_autoStartArmed_triggers', trigger_id = tr.id
  FROM "tasks_autoStartArmed_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "tasks_autoStartArmed_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'tasks_created_triggers', trigger_id = tr.id
  FROM "tasks_created_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "tasks_created_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'tasks_descriptionChanged_triggers', trigger_id = tr.id
  FROM "tasks_descriptionChanged_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "tasks_descriptionChanged_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'tasks_mandateChanged_triggers', trigger_id = tr.id
  FROM "tasks_mandateChanged_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "tasks_mandateChanged_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'tasks_refiled_triggers', trigger_id = tr.id
  FROM "tasks_refiled_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "tasks_refiled_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'tasks_statusChanged_triggers', trigger_id = tr.id
  FROM "tasks_statusChanged_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "tasks_statusChanged_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'tasks_titleChanged_triggers', trigger_id = tr.id
  FROM "tasks_titleChanged_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "tasks_titleChanged_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'tasks_trackChanged_triggers', trigger_id = tr.id
  FROM "tasks_trackChanged_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "tasks_trackChanged_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'tests_digestsSettled_triggers', trigger_id = tr.id
  FROM "tests_digestsSettled_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "tests_digestsSettled_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'tests_runsIngested_triggers', trigger_id = tr.id
  FROM "tests_runsIngested_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "tests_runsIngested_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');

UPDATE job_waits w SET trigger_table = 'worktree_checkoutProgress_triggers', trigger_id = tr.id
  FROM "worktree_checkoutProgress_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND w.status = 'pending' AND w.trigger_id IS NULL
   AND w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
   AND w.wait_name = tr.job_with->>'__resume_waitName';
DELETE FROM "worktree_checkoutProgress_triggers" tr
 WHERE tr.job_name = 'jobs.resume'
   AND NOT EXISTS (
         SELECT 1 FROM job_waits w
          WHERE w.workflow_run_id = tr.job_with->>'__resume_workflowRunId'
            AND w.wait_name = tr.job_with->>'__resume_waitName'
            AND w.status = 'pending');
