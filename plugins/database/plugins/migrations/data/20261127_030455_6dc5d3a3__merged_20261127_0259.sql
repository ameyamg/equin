-- singularity:snapshot id=7c46b070-3117-44b4-9bd3-488900e93d77 parents=e32744f6-1cc6-4e68-a75e-691430613c7f
-- singularity:supersedes fda406ec b2fac164
-- singularity:phase expand
CREATE TABLE "mail_local_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"display_name" text,
	"signature" text
);
CREATE TABLE "mail_local_attachments" (
	"message_id" text NOT NULL,
	"part_id" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"content_id" text,
	"inline" boolean NOT NULL,
	CONSTRAINT "mail_local_attachments_message_id_part_id_pk" PRIMARY KEY("message_id","part_id")
);
CREATE TABLE "mail_local_changes" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mail_local_changes_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"thread_id" text,
	"mailboxes_changed" boolean NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "mail_local_mailboxes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"parent_id" text,
	"color" jsonb
);
CREATE TABLE "mail_local_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"from_name" text,
	"from_address" text NOT NULL,
	"to_participants" jsonb NOT NULL,
	"cc_participants" jsonb NOT NULL,
	"bcc_participants" jsonb NOT NULL,
	"reply_to_participants" jsonb NOT NULL,
	"subject" text NOT NULL,
	"text" text,
	"text_unknown_charset" text,
	"html" text,
	"html_unknown_charset" text,
	"mailboxes" jsonb NOT NULL,
	"unread" boolean NOT NULL,
	"starred" boolean NOT NULL,
	"is_draft" boolean NOT NULL,
	"draft_id" text,
	"rfc822_message_id" text NOT NULL,
	"in_reply_to" text,
	"references" jsonb NOT NULL
);
CREATE INDEX "mail_local_changes_thread_idx" ON "mail_local_changes" USING btree ("thread_id","seq");
CREATE INDEX "mail_local_messages_date_idx" ON "mail_local_messages" USING btree ("date","id");
CREATE INDEX "mail_local_messages_thread_idx" ON "mail_local_messages" USING btree ("thread_id");
CREATE INDEX "mail_local_messages_rfc_idx" ON "mail_local_messages" USING btree ("rfc822_message_id");
CREATE INDEX "mail_local_messages_draft_idx" ON "mail_local_messages" USING btree ("draft_id");
-- singularity:phase contract
ALTER TABLE "mail_local_attachments" ADD CONSTRAINT "mail_local_attachments_message_id_mail_local_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."mail_local_messages"("id") ON DELETE cascade ON UPDATE no action;
-- singularity:claims
