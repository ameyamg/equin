-- singularity:snapshot id=bd35ef04-0887-4cae-9dd5-96466fa0794e parents=c4b2ce34-6384-4200-99fe-98868fe315ce
-- singularity:supersedes 76d12d9c
-- singularity:phase expand
CREATE TABLE "queue_dead_jobs_reported" (
	"death_id" text PRIMARY KEY NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "report_fix_claims_unknown" (
	"report_id" text NOT NULL,
	"claim_commit" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_fix_claims_unknown_report_id_claim_commit_pk" PRIMARY KEY("report_id","claim_commit")
);
-- singularity:phase contract
-- singularity:claims
