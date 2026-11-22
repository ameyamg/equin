-- singularity:snapshot id=1ca08fdc-8cf4-424b-a0ff-c066f1ae1720 parents=e39c0591-50a9-407a-9ee2-a1f7b8668768
-- singularity:supersedes 30de403f
-- singularity:phase expand
ALTER TABLE "conversations_ext_sdk_agent" ADD COLUMN "turn_error" text;
-- singularity:phase contract
-- singularity:claims
