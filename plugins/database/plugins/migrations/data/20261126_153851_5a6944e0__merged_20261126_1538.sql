-- singularity:snapshot id=2e7b53bf-e2ed-485a-9b63-a66f3a3ac350 parents=1478afcc-b7b2-4ef4-9404-a8181695b9ed
-- singularity:supersedes 2399f743
-- singularity:phase expand
CREATE TABLE "mail_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"address" text NOT NULL,
	"cursor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "mail_mailboxes" (
	"account_id" text NOT NULL,
	"mailbox_id" text NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"kind" text NOT NULL,
	"parent_id" text,
	"threads_total" integer,
	"threads_unread" integer,
	"color" jsonb,
	CONSTRAINT "mail_mailboxes_account_id_mailbox_id_pk" PRIMARY KEY("account_id","mailbox_id")
);
CREATE TABLE "mail_queries" (
	"query_id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mail_queries_query_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"account_id" text NOT NULL,
	"provider_query" text NOT NULL,
	"filter" text,
	"locally_maintained" boolean NOT NULL,
	"is_search" boolean NOT NULL,
	"floor_at" timestamp with time zone,
	"exhausted" boolean DEFAULT false NOT NULL,
	"verified_cursor" text,
	"last_read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mail_queries_account_query_uq" UNIQUE("account_id","provider_query")
);
CREATE TABLE "mail_query_members" (
	"query_id" integer NOT NULL,
	"account_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "mail_query_members_query_id_thread_id_pk" PRIMARY KEY("query_id","thread_id")
);
CREATE TABLE "mail_threads" (
	"account_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"version" text NOT NULL,
	"summary" jsonb NOT NULL,
	"last_message_at" timestamp with time zone NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mail_threads_account_id_thread_id_pk" PRIMARY KEY("account_id","thread_id")
);
CREATE INDEX "mail_queries_last_read_idx" ON "mail_queries" USING btree ("last_read_at");
CREATE INDEX "mail_query_members_order_idx" ON "mail_query_members" USING btree ("query_id","at" DESC NULLS LAST,"thread_id");
CREATE INDEX "mail_query_members_thread_idx" ON "mail_query_members" USING btree ("account_id","thread_id");
CREATE INDEX "mail_threads_last_used_idx" ON "mail_threads" USING btree ("last_used_at");
-- singularity:phase contract
ALTER TABLE "mail_mailboxes" ADD CONSTRAINT "mail_mailboxes_account_id_mail_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "mail_queries" ADD CONSTRAINT "mail_queries_account_id_mail_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "mail_query_members" ADD CONSTRAINT "mail_query_members_query_id_mail_queries_query_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."mail_queries"("query_id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "mail_query_members" ADD CONSTRAINT "mail_query_members_account_id_thread_id_mail_threads_account_id_thread_id_fk" FOREIGN KEY ("account_id","thread_id") REFERENCES "public"."mail_threads"("account_id","thread_id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "mail_threads" ADD CONSTRAINT "mail_threads_account_id_mail_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE cascade ON UPDATE no action;
-- singularity:claims
