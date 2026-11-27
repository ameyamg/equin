-- singularity:snapshot id=e32744f6-1cc6-4e68-a75e-691430613c7f parents=b9b6b12a-092e-445c-a06a-2ca5808bcd96
-- singularity:supersedes 99bbfe97
-- singularity:phase expand
CREATE TABLE "site_report_imports" (
	"deployment_id" text NOT NULL,
	"site_fingerprint" text NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"site_count" integer NOT NULL,
	CONSTRAINT "site_report_imports_deployment_id_site_fingerprint_pk" PRIMARY KEY("deployment_id","site_fingerprint")
);
-- singularity:phase contract
-- singularity:claims
-- 20261127_020947__site_report_imports_seed
