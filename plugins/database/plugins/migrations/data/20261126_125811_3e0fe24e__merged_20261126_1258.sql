-- singularity:snapshot id=4c2859b5-8da6-4f66-b0be-65ca4c4d03e1 parents=8d3b0d68-c3a0-423f-845d-f8cf4304457f
-- singularity:supersedes 066aa3a8
-- singularity:phase expand
ALTER TABLE "deploy_runs" ADD COLUMN "remedy" jsonb;
-- singularity:phase contract
-- singularity:claims
