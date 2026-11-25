-- singularity:snapshot id=9f4ed54c-7348-4e55-a41f-90eaa7d557a5 parents=736bab8f-0538-4108-9e7e-4dbd006f1ac6
-- singularity:supersedes 069c348c
-- singularity:phase expand
ALTER TABLE "supervisor_session_handoffs" ADD COLUMN "move_open_tasks" boolean DEFAULT false NOT NULL;
-- singularity:phase contract
-- singularity:claims
