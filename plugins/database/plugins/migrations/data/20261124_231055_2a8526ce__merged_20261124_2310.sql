-- singularity:snapshot id=7c1ae086-83db-45dd-9be6-1c951ddf7cf9 parents=5546ba5a-181d-4fb6-ba98-aee172c42a22
-- singularity:supersedes 98cc2908
-- singularity:phase expand
CREATE TABLE "decision_exchanges" (
	"id" text PRIMARY KEY NOT NULL,
	"decision_id" text NOT NULL,
	"kind" text NOT NULL,
	"pick" text,
	"user_text" text,
	"agent_text" text,
	"agent_at" timestamp with time zone,
	"turn_id" text,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_exchanges_pick_kind" CHECK (CASE "decision_exchanges"."kind" WHEN 'answer' THEN "decision_exchanges"."pick" IS NOT NULL WHEN 'recorded' THEN true ELSE "decision_exchanges"."pick" IS NULL END),
	CONSTRAINT "decision_exchanges_agent_text_at" CHECK (("decision_exchanges"."agent_text" IS NULL) = ("decision_exchanges"."agent_at" IS NULL)),
	CONSTRAINT "decision_exchanges_update_has_text" CHECK ("decision_exchanges"."kind" <> 'update' OR "decision_exchanges"."agent_text" IS NOT NULL)
);
CREATE TABLE "decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"opened_by_conversation_id" text NOT NULL,
	"label" text NOT NULL,
	"state" text NOT NULL,
	"state_label" text,
	"question" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"from_decision_id" text,
	"outcome" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone,
	CONSTRAINT "decisions_state_label_iff_other" CHECK (("decisions"."state" = 'other') = ("decisions"."state_label" IS NOT NULL)),
	CONSTRAINT "decisions_outcome_iff_closed" CHECK (("decisions"."state" = 'closed') = ("decisions"."outcome" IS NOT NULL)),
	CONSTRAINT "decisions_closed_at_iff_closed" CHECK (("decisions"."state" = 'closed') = ("decisions"."closed_at" IS NOT NULL))
);
CREATE INDEX "decision_exchanges_decision_idx" ON "decision_exchanges" USING btree ("decision_id","created_at");
CREATE INDEX "decisions_opened_at_idx" ON "decisions" USING btree ("opened_at","id");
CREATE INDEX "decisions_from_idx" ON "decisions" USING btree ("from_decision_id");
-- singularity:phase contract
ALTER TABLE "decision_exchanges" ADD CONSTRAINT "decision_exchanges_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_from_decision_id_decisions_id_fk" FOREIGN KEY ("from_decision_id") REFERENCES "public"."decisions"("id") ON DELETE set null ON UPDATE no action;
CREATE UNIQUE INDEX "decisions_task_label_idx" ON "decisions" USING btree ("task_id","label");
-- singularity:claims
