-- Custom SQL migration file, put your code below! --
-- migration: 20261127_020947__site_report_imports_seed --
-- The site-reports import's delivery ledger starts from what is already
-- recorded: each website-visitor report's site facts (its deployment, the
-- site's hashed fingerprint, the site's last sighting and count, as the last
-- import wrote them into `data`). Without it, the first page after this
-- release — the reconcile the `split` column started on 2026-11-27, still
-- running — would re-file every old row once more as a recurrence.
-- Idempotent: a key already in the ledger keeps the greater facts.
INSERT INTO "site_report_imports" ("deployment_id", "site_fingerprint", "last_seen_at", "site_count")
SELECT "data"->>'deploymentId',
       "data"->>'siteFingerprint',
       max(("data"->>'lastSeenAt')::timestamptz),
       max(("data"->>'siteCount')::integer)
FROM "reports"
WHERE "kind" IN ('website-visitor-error', 'website-visitor-slowness')
  AND "data"->>'deploymentId' IS NOT NULL
  AND "data"->>'siteFingerprint' IS NOT NULL
  AND "data"->>'lastSeenAt' IS NOT NULL
  AND "data"->>'siteCount' IS NOT NULL
GROUP BY 1, 2
ON CONFLICT ("deployment_id", "site_fingerprint") DO UPDATE
SET "last_seen_at" = greatest("site_report_imports"."last_seen_at", excluded."last_seen_at"),
    "site_count" = greatest("site_report_imports"."site_count", excluded."site_count");
