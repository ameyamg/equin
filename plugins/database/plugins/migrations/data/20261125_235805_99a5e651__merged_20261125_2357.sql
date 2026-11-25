-- singularity:snapshot id=023d623c-9052-4d38-bf14-87efe7f46bc8 parents=9b3d7987-b1bc-4ab2-9a4a-b4b1f6102161
-- singularity:supersedes 63353406
-- singularity:phase expand
CREATE TABLE "mcp_listed_tools" (
	"conversation_id" text PRIMARY KEY NOT NULL,
	"tools" text[] NOT NULL,
	"listed_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- singularity:phase contract
-- singularity:claims
