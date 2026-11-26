-- singularity:snapshot id=1ed7c052-6577-4bf6-abfe-0b462eadc4fb parents=9843b671-d083-449f-b52d-edf95c8294b5
-- singularity:supersedes 04aaccb5
-- singularity:phase expand
CREATE TABLE "report_standing_conditions" (
	"fingerprint" text NOT NULL,
	"worktree" text NOT NULL,
	"kind" text NOT NULL,
	"report_id" text NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_standing_conditions_fingerprint_worktree_pk" PRIMARY KEY("fingerprint","worktree")
);
CREATE INDEX "report_standing_conditions_kind_idx" ON "report_standing_conditions" USING btree ("worktree","kind");
CREATE INDEX "report_standing_conditions_report_idx" ON "report_standing_conditions" USING btree ("report_id");
-- singularity:phase contract
ALTER TABLE "report_standing_conditions" ADD CONSTRAINT "report_standing_conditions_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE cascade;
-- singularity:claims
