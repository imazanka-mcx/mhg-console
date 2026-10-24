-- Rename the Maz Hotels Group chain code from MAZ to MHG (@mcx/inn-code v1.2.0).
--
-- Data only, no DDL. The chain code is not encoded in the inn code (B1), so no
-- code is reissued, retired or reassigned — this is a relabel of the same
-- chain, not a rebrand.
--
-- inn_code is a snapshot of each record as issued, and is rewritten here on
-- purpose: left as MAZ, a retired code would name a chain that no longer
-- exists in the brand table, which is exactly the "stops explaining itself"
-- failure the snapshot is there to prevent.
--
-- chainCode is in the shell, so every relabelled property gets a shellVersion
-- bump and a shell_event, and the next delivery carries MHG to Inspire and
-- InspiredREV (§1.4). Reason `backfill`: an existing reason, so consumers on
-- the current contract accept it unchanged.

-- 1. Rule groups that slice by chain. Same membership before and after, since
--    every MAZ property moves to MHG in this same transaction.
UPDATE "property_group"
SET "rule_json" = jsonb_set(
      "rule_json"::jsonb,
      '{chainCode}',
      (SELECT jsonb_agg(CASE WHEN upper(trim(v)) = 'MAZ' THEN 'MHG' ELSE v END)
         FROM jsonb_array_elements_text("rule_json"::jsonb -> 'chainCode') AS v)
    )
WHERE "rule_json" IS NOT NULL
  AND jsonb_typeof("rule_json"::jsonb -> 'chainCode') = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements_text("rule_json"::jsonb -> 'chainCode') AS v
               WHERE upper(trim(v)) = 'MAZ');

-- 2. The issuance ledger.
UPDATE "inn_code" SET "chain_code" = 'MHG' WHERE "chain_code" = 'MAZ';

-- 3. Live properties: relabel, bump, and append to the stream.
WITH relabelled AS (
  UPDATE "property"
  SET "chain_code" = 'MHG',
      "shell_version" = "shell_version" + 1,
      "updated_at" = CURRENT_TIMESTAMP
  WHERE "chain_code" = 'MAZ'
  RETURNING "id", "shell_version"
)
INSERT INTO "shell_event" ("property_id", "shell_version", "reason")
SELECT "id", "shell_version", 'backfill' FROM relabelled ORDER BY "id";
