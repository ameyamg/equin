-- singularity:snapshot id=c4b2ce34-6384-4200-99fe-98868fe315ce parents=1ca08fdc-8cf4-424b-a0ff-c066f1ae1720
-- singularity:supersedes eff11caf
-- singularity:phase expand
ALTER TABLE "job_runs" ADD COLUMN "slept_ms" double precision;
-- singularity:phase contract
-- singularity:claims
