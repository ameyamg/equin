-- singularity:snapshot id=5ab9fe0f-d43a-42cf-b532-04966e6362cf parents=fe38bf34-d57c-4cfa-b6dd-44e84090b0f0
-- singularity:supersedes 8ef3d3d4
-- singularity:phase expand
ALTER TABLE "outcome_report_turn_addressees" ADD COLUMN "awaiting" text;
ALTER TABLE "outcome_report_turn_addressees" ADD COLUMN "used_at" timestamp with time zone;
-- singularity:phase contract
-- singularity:claims
