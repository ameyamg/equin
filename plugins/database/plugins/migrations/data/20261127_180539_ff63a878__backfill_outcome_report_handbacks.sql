-- Custom SQL migration file, put your code below! --
-- migration: 20261127_180539__backfill_outcome_report_handbacks --
-- Each conversation's latest hand-back, carried over from the per-task
-- reports (tasks_ext_outcome_report, dropped by this push's contract): the
-- marker userInRun and the hand-back dedupe read. A report whose conversation
-- is gone is skipped (the new table's FK). Idempotent — it runs again before
-- the deferred contract, and keeps the later of two hand-backs.
INSERT INTO "outcome_report_handbacks" ("conversation_id", "message_id", "handed_back_at")
SELECT r."conversation_id", r."message_id", r."submitted_at"
FROM "tasks_ext_outcome_report" r
JOIN "conversations" c ON c."id" = r."conversation_id"
ON CONFLICT ("conversation_id") DO UPDATE
SET "message_id" = EXCLUDED."message_id", "handed_back_at" = EXCLUDED."handed_back_at"
WHERE "outcome_report_handbacks"."handed_back_at" < EXCLUDED."handed_back_at";
