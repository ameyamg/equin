-- singularity:snapshot id=490eacf5-660e-47b6-94e9-89beb8442578 parents=1ed7c052-6577-4bf6-abfe-0b462eadc4fb
-- singularity:supersedes 5c7b2e3d
-- singularity:phase expand
CREATE TABLE "mail_gmail_push" (
	"account_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"topic" text NOT NULL,
	"subscription" text NOT NULL,
	"set_up_at" timestamp with time zone DEFAULT now() NOT NULL,
	"watch_expires_at" timestamp with time zone
);
-- singularity:phase contract
-- singularity:claims
