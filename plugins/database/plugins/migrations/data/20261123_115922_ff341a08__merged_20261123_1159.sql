-- singularity:snapshot id=f108b2c5-c416-49de-bb41-94cd069cc92f parents=373e6477-675d-435a-a183-93e770d88539
-- singularity:supersedes 744cac9f
-- singularity:phase expand
ALTER TABLE "deploy_deployments" ADD COLUMN "edge" text DEFAULT 'direct' NOT NULL;
-- singularity:phase contract
-- singularity:claims
