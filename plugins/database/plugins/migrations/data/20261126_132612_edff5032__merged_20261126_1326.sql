-- singularity:snapshot id=1478afcc-b7b2-4ef4-9404-a8181695b9ed parents=9893f5a7-b468-41d6-8b37-238a6d0a44e6
-- singularity:supersedes 1b571862
-- singularity:supersedes 1b571862 <- 25f12353
-- singularity:supersedes 25f12353 <- 40e35d11
-- singularity:phase expand
CREATE TABLE "recorder_saves" (
	"id" text PRIMARY KEY NOT NULL,
	"outcome" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "recorder_saves_created_at_idx" ON "recorder_saves" USING btree ("created_at");
-- singularity:phase contract
-- singularity:claims
