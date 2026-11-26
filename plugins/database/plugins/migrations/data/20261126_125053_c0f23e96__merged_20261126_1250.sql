-- singularity:snapshot id=8d3b0d68-c3a0-423f-845d-f8cf4304457f parents=53faf749-fb2b-4e01-becd-758dee6b6de5
-- singularity:supersedes 04aacf7b
-- singularity:phase expand
-- singularity:phase contract
DROP TABLE "mail_accounts" CASCADE;
DROP TABLE "mail_attachments" CASCADE;
DROP TABLE "mail_drafts" CASCADE;
DROP TABLE "mail_labels" CASCADE;
DROP TABLE "mail_message_labels" CASCADE;
DROP TABLE "mail_messages" CASCADE;
DROP TABLE "mail_outbox" CASCADE;
DROP TABLE "mail_sync_state" CASCADE;
DROP TABLE "mail_threads" CASCADE;
DROP TABLE "mail_drafts_attachments" CASCADE;
-- singularity:claims
