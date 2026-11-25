-- singularity:snapshot id=cfc82e23-6c1c-4940-99dd-a09c08b59bc4 parents=6924fb60-929c-40f7-bf51-180f9081887e
-- singularity:supersedes c0680051
-- singularity:phase expand
ALTER TABLE "job_waits" ADD COLUMN "trigger_table" text;
ALTER TABLE "job_waits" ADD COLUMN "trigger_id" uuid;
-- singularity:phase contract
-- singularity:claims
-- 20261125_131201__drop_stale_wait_triggers
