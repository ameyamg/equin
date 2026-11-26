-- singularity:snapshot id=18dd8cce-aa4c-441c-9eef-ef83d496c7c2 parents=1d4997c7-ddcc-4dc1-8f1b-43f8f0f5b7de
-- singularity:supersedes 326e7b66
-- singularity:phase expand
ALTER TABLE "site_reports" ADD COLUMN "split" jsonb DEFAULT '{"clients":[],"paths":[],"otherPaths":0}'::jsonb NOT NULL;
-- singularity:phase contract
-- singularity:claims
