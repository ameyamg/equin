-- singularity:snapshot id=5546ba5a-181d-4fb6-ba98-aee172c42a22 parents=bf70ed91-5b32-423d-8671-2a5e5d2648e3
-- singularity:supersedes 8c9955f1
-- singularity:phase expand
CREATE TABLE "app_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"tag_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "app_category_tags" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"parent_id" text,
	"color" text,
	"child_colors" text,
	"icon" text,
	"rank" "rank_text" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "isle_plots" ADD COLUMN "group" text DEFAULT '_' NOT NULL;
ALTER TABLE "isle_plots" ADD COLUMN "region" text DEFAULT '_' NOT NULL;
CREATE INDEX "app_category_tags_parent_rank_idx" ON "app_category_tags" USING btree ("parent_id","rank");
-- singularity:phase contract
ALTER TABLE "app_categories" ADD CONSTRAINT "app_categories_tag_id_app_category_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."app_category_tags"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "isle_plots" DROP COLUMN "category";
-- singularity:claims
