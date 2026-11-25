-- singularity:snapshot id=736bab8f-0538-4108-9e7e-4dbd006f1ac6 parents=b377d3ba-1111-4a85-bdb2-9709a6cd8dc2
-- singularity:supersedes 82bfd4cd
-- singularity:phase expand
CREATE TABLE "supervisor_session_handoffs" (
	"from_task_id" text PRIMARY KEY NOT NULL,
	"role_id" text NOT NULL,
	"handoff" text NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone,
	"to_task_id" text
);
-- singularity:phase contract
ALTER TABLE "supervisor_session_handoffs" ADD CONSTRAINT "supervisor_session_handoffs_from_task_id_tasks_id_fk" FOREIGN KEY ("from_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "supervisor_session_handoffs" ADD CONSTRAINT "supervisor_session_handoffs_role_id_supervisor_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."supervisor_roles"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "supervisor_session_handoffs" ADD CONSTRAINT "supervisor_session_handoffs_to_task_id_tasks_id_fk" FOREIGN KEY ("to_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;
CREATE UNIQUE INDEX "supervisor_session_handoffs_pending_idx" ON "supervisor_session_handoffs" USING btree ("role_id") WHERE "supervisor_session_handoffs"."consumed_at" IS NULL;
-- singularity:claims
