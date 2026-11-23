-- singularity:snapshot id=0a0faba0-895b-4848-977f-736176c3e30c parents=f108b2c5-c416-49de-bb41-94cd069cc92f
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
