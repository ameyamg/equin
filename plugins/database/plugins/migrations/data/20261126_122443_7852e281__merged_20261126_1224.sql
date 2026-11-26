-- singularity:snapshot id=53faf749-fb2b-4e01-becd-758dee6b6de5 parents=5ab9fe0f-d43a-42cf-b532-04966e6362cf
-- singularity:supersedes 7e0a6e44
-- singularity:phase expand
ALTER TABLE "mcp_listed_tools" ADD COLUMN "fingerprint" text;
-- singularity:phase contract
-- singularity:claims
