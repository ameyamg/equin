-- singularity:snapshot id=48b502df-ad3b-477e-b7f4-c3977f283cc7 parents=2e7b53bf-e2ed-485a-9b63-a66f3a3ac350
-- singularity:supersedes 7490368a
-- singularity:phase expand
ALTER TABLE "mail_accounts" ADD COLUMN "synced_at" timestamp with time zone;
ALTER TABLE "mail_accounts" ADD COLUMN "sync_failure" jsonb;
-- singularity:phase contract
-- singularity:claims
