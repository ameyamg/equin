-- singularity:snapshot id=c59a159f-fbe5-4337-b818-3dea0d35fb68 parents=6f1f9f9a-eabe-484d-9a85-60ed6765fea7
-- singularity:supersedes a38a3ddb
-- singularity:phase expand
ALTER TABLE "mail_drafts" ADD COLUMN "quote_document" text;
-- singularity:phase contract
-- singularity:claims
