-- singularity:snapshot id=b377d3ba-1111-4a85-bdb2-9709a6cd8dc2 parents=cfc82e23-6c1c-4940-99dd-a09c08b59bc4
-- singularity:supersedes d09f4cba
-- singularity:phase expand
CREATE TABLE "decisions_attachments" (
	"owner_id" text NOT NULL,
	"attachment_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decisions_attachments_owner_id_attachment_id_pk" PRIMARY KEY("owner_id","attachment_id")
);
-- singularity:phase contract
ALTER TABLE "decisions_attachments" ADD CONSTRAINT "decisions_attachments_owner_id_decisions_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."decisions"("id") ON DELETE cascade ON UPDATE cascade;
ALTER TABLE "decisions_attachments" ADD CONSTRAINT "decisions_attachments_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE cascade;
-- singularity:claims
