-- singularity:snapshot id=9843b671-d083-449f-b52d-edf95c8294b5 parents=48b502df-ad3b-477e-b7f4-c3977f283cc7
-- singularity:supersedes 048e292b
-- singularity:supersedes 048e292b <- 9d40a98e
-- singularity:phase expand
CREATE TABLE "decisions_ext_notes" (
	"parent_id" text PRIMARY KEY NOT NULL,
	"notes" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- singularity:phase contract
ALTER TABLE "decisions_ext_notes" ADD CONSTRAINT "decisions_ext_notes_parent_id_decisions_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."decisions"("id") ON DELETE cascade ON UPDATE cascade;
-- singularity:claims
