-- singularity:snapshot id=6f1f9f9a-eabe-484d-9a85-60ed6765fea7 parents=6d7d8b80-4752-4b58-9097-b466571d4fbb
-- singularity:supersedes 693766b5 a10bd035
-- singularity:phase expand
CREATE TABLE "proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"scope" text NOT NULL,
	"record_id" text NOT NULL,
	"is_new" boolean DEFAULT false NOT NULL,
	"base_version" text,
	"base_values" jsonb,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"changed" text[] DEFAULT '{}' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"author_task_id" text NOT NULL,
	"author_conversation_id" text NOT NULL,
	"worktree" text NOT NULL,
	"edited_on_main_since_fork" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"previous_id" text,
	"state" text DEFAULT 'open' NOT NULL,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "proposals_attachments" (
	"owner_id" text NOT NULL,
	"attachment_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposals_attachments_owner_id_attachment_id_pk" PRIMARY KEY("owner_id","attachment_id")
);
CREATE INDEX "proposals_type_scope_created_idx" ON "proposals" USING btree ("type","scope","created_at" DESC NULLS LAST);
-- singularity:phase contract
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_author_task_id_tasks_id_fk" FOREIGN KEY ("author_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_previous_id_proposals_id_fk" FOREIGN KEY ("previous_id") REFERENCES "public"."proposals"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "proposals_attachments" ADD CONSTRAINT "proposals_attachments_owner_id_proposals_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE cascade;
ALTER TABLE "proposals_attachments" ADD CONSTRAINT "proposals_attachments_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE cascade;
CREATE UNIQUE INDEX "proposals_task_record_revision_idx" ON "proposals" USING btree ("author_task_id","type","record_id","revision");
-- singularity:claims
