-- singularity:snapshot id=bf70ed91-5b32-423d-8671-2a5e5d2648e3 parents=1a4cef57-dcc0-4c98-9a52-82b78f982bc3
-- singularity:supersedes 227bb8fe
-- singularity:phase expand
CREATE TABLE "task_unowned_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"action" text NOT NULL,
	"grant_task_id" text NOT NULL,
	"conversation_id" text,
	"owner" text,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "tasks_ext_manage_grant" (
	"parent_id" text PRIMARY KEY NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "task_unowned_actions_task_idx" ON "task_unowned_actions" USING btree ("task_id","created_at");
-- singularity:phase contract
ALTER TABLE "tasks_ext_manage_grant" ADD CONSTRAINT "tasks_ext_manage_grant_parent_id_tasks_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE cascade;
-- singularity:claims
