-- singularity:snapshot id=9b3d7987-b1bc-4ab2-9a4a-b4b1f6102161 parents=4582ce89-3931-4c08-a4ba-edd778f17b84
-- singularity:supersedes 9b437465 e71452b2
-- singularity:phase expand
CREATE TABLE "outcome_report_turn_addressees" (
	"conversation_id" text PRIMARY KEY NOT NULL,
	"to" text NOT NULL,
	"declared_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "tasks_ext_outcome_report" ADD COLUMN "message_id" text;
-- singularity:phase contract
ALTER TABLE "outcome_report_turn_addressees" ADD CONSTRAINT "outcome_report_turn_addressees_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "tasks_ext_outcome_report" DROP COLUMN "question";
ALTER TABLE "tasks_ext_outcome_report" DROP COLUMN "answers";
-- singularity:claims
