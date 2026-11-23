-- singularity:snapshot id=a1bab304-ee23-4c2f-b564-06863dd0f46f parents=f108b2c5-c416-49de-bb41-94cd069cc92f
-- singularity:supersedes 65700b4a
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
