-- singularity:snapshot id=6924fb60-929c-40f7-bf51-180f9081887e parents=7c1ae086-83db-45dd-9be6-1c951ddf7cf9
-- singularity:supersedes eb17d0e6
-- singularity:phase expand
-- singularity:phase contract
ALTER TABLE "conversations_ext_sdk_agent" DROP COLUMN "last_assistant_uuid";
ALTER TABLE "conversations_ext_sdk_agent" DROP COLUMN "rewind_anchor_uuid";
-- singularity:claims
