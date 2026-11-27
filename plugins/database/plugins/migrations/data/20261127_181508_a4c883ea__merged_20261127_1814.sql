-- singularity:snapshot id=84f597cf-f0ad-4976-bd90-ac31496cc636 parents=c59a159f-fbe5-4337-b818-3dea0d35fb68
-- singularity:supersedes 3e1e470c
-- singularity:supersedes 3e1e470c <- 6d5c3144
-- singularity:phase expand
CREATE TABLE "outcome_report_handbacks" (
	"conversation_id" text PRIMARY KEY NOT NULL,
	"message_id" text,
	"handed_back_at" timestamp with time zone NOT NULL
);
ALTER TABLE "tasks_ext_outcome_report" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "outcomeReport_submitted_triggers" RENAME TO "outcomeReport_handedBack_triggers";
DROP INDEX "outcomeReport_submitted_triggers_taskId_idx";
CREATE INDEX "outcomeReport_handedBack_triggers_taskId_idx" ON "outcomeReport_handedBack_triggers" USING btree ("task_id") WHERE enabled;
-- singularity:phase contract
DROP TABLE "tasks_ext_outcome_report" CASCADE;
ALTER TABLE "outcome_report_handbacks" ADD CONSTRAINT "outcome_report_handbacks_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
-- singularity:claims
-- 20261127_180539__backfill_outcome_report_handbacks
