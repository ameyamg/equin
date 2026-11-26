-- singularity:snapshot id=fe38bf34-d57c-4cfa-b6dd-44e84090b0f0 parents=023d623c-9052-4d38-bf14-87efe7f46bc8
-- singularity:supersedes eec60ac1
-- singularity:phase expand
ALTER TABLE "attempt_deliveries" ADD COLUMN "basis" text DEFAULT 'scratch' NOT NULL;
-- singularity:phase contract
-- singularity:claims
