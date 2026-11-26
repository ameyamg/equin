-- singularity:snapshot id=b9b6b12a-092e-445c-a06a-2ca5808bcd96 parents=9c9dabe5-351d-482e-b513-46f75dd36fd0
-- singularity:supersedes 82693eac 8280bb9b
-- singularity:phase expand
CREATE TABLE "mail_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"kind" text NOT NULL,
	"thread_id" text,
	"replying_to" jsonb,
	"in_reply_to" text,
	"references" text[] DEFAULT '{}' NOT NULL,
	"quote" text,
	"content" jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"mirrored_revision" integer DEFAULT 0 NOT NULL,
	"provider_draft_id" text,
	"provider_thread_id" text,
	"provider_message_id" text,
	"draft_message_id" text NOT NULL,
	"state" text NOT NULL,
	"draft_create_attempt" text,
	"send_at" timestamp with time zone,
	"send_message_id" text,
	"send_attempt" text,
	"send_error" text,
	"sent_thread_id" text,
	"sent_message_id" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "mail_drafts_attachments" (
	"owner_id" text NOT NULL,
	"attachment_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_drafts_attachments_owner_id_attachment_id_pk" PRIMARY KEY("owner_id","attachment_id")
);
CREATE INDEX "mail_drafts_provider_draft_idx" ON "mail_drafts" USING btree ("provider_draft_id");
CREATE INDEX "mail_drafts_provider_message_idx" ON "mail_drafts" USING btree ("provider_message_id");
CREATE INDEX "mail_drafts_sent_at_idx" ON "mail_drafts" USING btree ("sent_at");
-- singularity:phase contract
ALTER TABLE "mail_drafts_attachments" ADD CONSTRAINT "mail_drafts_attachments_owner_id_mail_drafts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."mail_drafts"("id") ON DELETE cascade ON UPDATE cascade;
ALTER TABLE "mail_drafts_attachments" ADD CONSTRAINT "mail_drafts_attachments_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE cascade;
-- singularity:claims
