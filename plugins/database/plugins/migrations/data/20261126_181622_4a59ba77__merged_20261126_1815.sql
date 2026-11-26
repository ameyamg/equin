-- singularity:snapshot id=c50f1db5-e803-4c6a-b48e-4cec136b7aad parents=18dd8cce-aa4c-441c-9eef-ef83d496c7c2
-- singularity:supersedes a2bc19c5
-- singularity:supersedes a2bc19c5 <- 56907c45
-- singularity:phase expand
CREATE TABLE "mail_thread_bodies" (
	"account_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"version" text NOT NULL,
	"message_ids" text[] NOT NULL,
	"content" jsonb NOT NULL,
	"bytes" integer NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"opened_at" timestamp with time zone,
	CONSTRAINT "mail_thread_bodies_account_id_thread_id_pk" PRIMARY KEY("account_id","thread_id")
);
CREATE INDEX "mail_thread_bodies_used_idx" ON "mail_thread_bodies" USING btree ("account_id","opened_at","fetched_at");
-- singularity:phase contract
ALTER TABLE "mail_thread_bodies" ADD CONSTRAINT "mail_thread_bodies_account_id_thread_id_mail_threads_account_id_thread_id_fk" FOREIGN KEY ("account_id","thread_id") REFERENCES "public"."mail_threads"("account_id","thread_id") ON DELETE cascade ON UPDATE no action;
-- singularity:claims
