-- Drops every registry object so constraints.sh can rebuild from the real
-- migration. This file holds ONLY the drops: the schema itself is applied from
-- prisma/migrations/<latest>/migration.sql, so the proof always tests exactly
-- what Prisma creates rather than a hand-copy that can drift from it.
DROP TABLE IF EXISTS inn_code, property, market_claim CASCADE;
DROP TYPE IF EXISTS "PropertyStatus", market_source CASCADE;
