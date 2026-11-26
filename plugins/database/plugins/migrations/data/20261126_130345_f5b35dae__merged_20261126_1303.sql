-- singularity:snapshot id=9893f5a7-b468-41d6-8b37-238a6d0a44e6 parents=4c2859b5-8da6-4f66-b0be-65ca4c4d03e1
-- singularity:supersedes b1f42dd4
-- singularity:supersedes b1f42dd4 <- 7e2f68dc
-- singularity:phase expand
CREATE TABLE "deploy_deployments_ext_public_path" (
	"parent_id" text PRIMARY KEY NOT NULL,
	"path" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- singularity:phase contract
ALTER TABLE "deploy_deployments_ext_public_path" ADD CONSTRAINT "deploy_deployments_ext_public_path_parent_id_deploy_deployments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."deploy_deployments"("id") ON DELETE cascade ON UPDATE cascade;
-- singularity:claims
