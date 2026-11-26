-- singularity:snapshot id=1d4997c7-ddcc-4dc1-8f1b-43f8f0f5b7de parents=490eacf5-660e-47b6-94e9-89beb8442578
-- singularity:supersedes b19e6549
-- singularity:supersedes b19e6549 <- f84ae568
-- singularity:phase expand
CREATE TABLE "site_feed_publications" (
	"item_id" text NOT NULL,
	"destination" text NOT NULL,
	"state" text DEFAULT 'publishing' NOT NULL,
	"error" text,
	"published_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_feed_publications_item_id_destination_pk" PRIMARY KEY("item_id","destination")
);
ALTER TABLE "site_feed_items" DROP CONSTRAINT "site_feed_items_deployment_id_deploy_deployments_id_fk";
ALTER TABLE "site_feed_syndication_settings" DROP CONSTRAINT "site_feed_syndication_settings_deployment_id_deploy_deployments_id_fk";
DROP INDEX "site_feed_items_deployment_feed_created_idx";
DROP INDEX "siteFeeds_itemPublished_triggers_deploymentId_idx";
DROP INDEX "siteFeeds_itemUnpublished_triggers_deploymentId_idx";
ALTER TABLE "site_feed_syndication_settings" DROP CONSTRAINT "site_feed_syndication_settings_deployment_id_feed_id_target_id_pk";
CREATE INDEX "site_feed_items_feed_created_idx" ON "site_feed_items" USING btree ("feed_id","created_at" DESC NULLS LAST);
-- singularity:phase contract
ALTER TABLE "site_feed_syndication_settings" ADD CONSTRAINT "site_feed_syndication_settings_feed_id_target_id_pk" PRIMARY KEY("feed_id","target_id");
ALTER TABLE "site_feed_publications" ADD CONSTRAINT "site_feed_publications_item_id_site_feed_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."site_feed_items"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "site_feed_items" DROP COLUMN "deployment_id";
ALTER TABLE "site_feed_items" DROP COLUMN "publish_state";
ALTER TABLE "site_feed_items" DROP COLUMN "publish_error";
ALTER TABLE "site_feed_syndication_settings" DROP COLUMN "deployment_id";
ALTER TABLE "siteFeeds_itemPublished_triggers" DROP COLUMN "deployment_id";
ALTER TABLE "siteFeeds_itemUnpublished_triggers" DROP COLUMN "deployment_id";
-- singularity:claims
