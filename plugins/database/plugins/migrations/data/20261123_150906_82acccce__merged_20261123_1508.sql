-- singularity:snapshot id=1a4cef57-dcc0-4c98-9a52-82b78f982bc3 parents=f108b2c5-c416-49de-bb41-94cd069cc92f
-- singularity:supersedes cdd64682
-- singularity:supersedes cdd64682 <- 65700b4a
-- singularity:phase expand
CREATE TABLE "tests_runsIngested_triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" text NOT NULL,
	"job_with" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"one_shot" boolean DEFAULT true NOT NULL,
	"declared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "test_file_status" ADD COLUMN "own_passed" integer DEFAULT 0 NOT NULL;
ALTER TABLE "test_file_status" ADD COLUMN "own_failed" integer DEFAULT 0 NOT NULL;
-- singularity:phase contract
-- singularity:claims
