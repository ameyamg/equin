-- singularity:snapshot id=4582ce89-3931-4c08-a4ba-edd778f17b84 parents=9f4ed54c-7348-4e55-a41f-90eaa7d557a5
-- singularity:supersedes b48fc1c3 87559d71 97c6b7c2 dd79021a 708cbd5a
-- singularity:supersedes b48fc1c3 <- c2a64488 79fe78a2
-- singularity:phase expand
CREATE TABLE "site_feed_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"feed_id" text NOT NULL,
	"values" jsonb NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "site_feed_items" (
	"id" text PRIMARY KEY NOT NULL,
	"deployment_id" text NOT NULL,
	"feed_id" text NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"publish_state" text DEFAULT 'idle' NOT NULL,
	"publish_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "site_feed_syndication_settings" (
	"deployment_id" text NOT NULL,
	"feed_id" text NOT NULL,
	"target_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_feed_syndication_settings_deployment_id_feed_id_target_id_pk" PRIMARY KEY("deployment_id","feed_id","target_id")
);
CREATE TABLE "site_feed_syndications" (
	"item_id" text NOT NULL,
	"target_id" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"remote_id" text,
	"error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_feed_syndications_item_id_target_id_pk" PRIMARY KEY("item_id","target_id")
);
CREATE TABLE "siteFeeds_itemPublished_triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" text NOT NULL,
	"job_with" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"one_shot" boolean DEFAULT true NOT NULL,
	"declared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"feed_id" text,
	"deployment_id" text
);
CREATE TABLE "siteFeeds_itemUnpublished_triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" text NOT NULL,
	"job_with" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"one_shot" boolean DEFAULT true NOT NULL,
	"declared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"feed_id" text,
	"deployment_id" text
);
CREATE TABLE "site_feed_entries_attachments" (
	"owner_id" text NOT NULL,
	"attachment_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_feed_entries_attachments_owner_id_attachment_id_pk" PRIMARY KEY("owner_id","attachment_id")
);
CREATE TABLE "site_feed_items_attachments" (
	"owner_id" text NOT NULL,
	"attachment_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_feed_items_attachments_owner_id_attachment_id_pk" PRIMARY KEY("owner_id","attachment_id")
);
CREATE INDEX "site_feed_entries_feed_published_idx" ON "site_feed_entries" USING btree ("feed_id","published_at");
CREATE INDEX "site_feed_items_deployment_feed_created_idx" ON "site_feed_items" USING btree ("deployment_id","feed_id","created_at" DESC NULLS LAST);
CREATE INDEX "siteFeeds_itemPublished_triggers_feedId_idx" ON "siteFeeds_itemPublished_triggers" USING btree ("feed_id") WHERE enabled;
CREATE INDEX "siteFeeds_itemPublished_triggers_deploymentId_idx" ON "siteFeeds_itemPublished_triggers" USING btree ("deployment_id") WHERE enabled;
CREATE INDEX "siteFeeds_itemUnpublished_triggers_feedId_idx" ON "siteFeeds_itemUnpublished_triggers" USING btree ("feed_id") WHERE enabled;
CREATE INDEX "siteFeeds_itemUnpublished_triggers_deploymentId_idx" ON "siteFeeds_itemUnpublished_triggers" USING btree ("deployment_id") WHERE enabled;
-- singularity:phase contract
ALTER TABLE "site_feed_items" ADD CONSTRAINT "site_feed_items_deployment_id_deploy_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deploy_deployments"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "site_feed_syndication_settings" ADD CONSTRAINT "site_feed_syndication_settings_deployment_id_deploy_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deploy_deployments"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "site_feed_syndications" ADD CONSTRAINT "site_feed_syndications_item_id_site_feed_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."site_feed_items"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "site_feed_entries_attachments" ADD CONSTRAINT "site_feed_entries_attachments_owner_id_site_feed_entries_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."site_feed_entries"("id") ON DELETE cascade ON UPDATE cascade;
ALTER TABLE "site_feed_entries_attachments" ADD CONSTRAINT "site_feed_entries_attachments_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE cascade;
ALTER TABLE "site_feed_items_attachments" ADD CONSTRAINT "site_feed_items_attachments_owner_id_site_feed_items_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."site_feed_items"("id") ON DELETE cascade ON UPDATE cascade;
ALTER TABLE "site_feed_items_attachments" ADD CONSTRAINT "site_feed_items_attachments_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE cascade;
-- singularity:claims
