-- Hand-derived DDL equivalent to prisma/schema.prisma, used ONLY by the
-- constraint-proof harness in this folder. It is NOT a migration: run
-- `npx prisma migrate dev --name init` to generate the real one. It exists
-- because the invariants in constraints.sql are claims about Postgres, and a
-- claim about a database should be proved against a database.

DROP TABLE IF EXISTS inn_code, property, market_claim CASCADE;
DROP TYPE IF EXISTS "PropertyStatus", market_source CASCADE;

CREATE TYPE "PropertyStatus" AS ENUM ('pipeline', 'active', 'retired');
CREATE TYPE market_source AS ENUM ('override', 'metro', 'airport', 'letters', 'submarket', 'registered');

CREATE TABLE property (
  id               TEXT PRIMARY KEY,
  code             TEXT NOT NULL,
  name             TEXT NOT NULL,
  brand_code       TEXT NOT NULL,
  brand_name       TEXT NOT NULL,
  chain_code       TEXT NOT NULL,
  market_code      TEXT NOT NULL,
  city             TEXT NOT NULL,
  state            TEXT NOT NULL,
  submarket        TEXT NOT NULL DEFAULT '',
  franchisor_code  TEXT NOT NULL DEFAULT '',
  status           "PropertyStatus" NOT NULL,
  predecessor_code TEXT NOT NULL DEFAULT '',
  effective_date   TEXT NOT NULL,
  prop_code        TEXT NOT NULL,
  created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX property_code_key ON property(code);
CREATE INDEX property_status_idx ON property(status);
CREATE INDEX property_market_code_idx ON property(market_code);

CREATE TABLE inn_code (
  code             TEXT PRIMARY KEY,
  property_id      TEXT NOT NULL,
  name             TEXT NOT NULL,
  brand_code       TEXT NOT NULL,
  brand_name       TEXT NOT NULL,
  chain_code       TEXT NOT NULL,
  market_code      TEXT NOT NULL,
  city             TEXT NOT NULL,
  state            TEXT NOT NULL,
  submarket        TEXT NOT NULL DEFAULT '',
  franchisor_code  TEXT NOT NULL DEFAULT '',
  status           "PropertyStatus" NOT NULL,
  predecessor_code TEXT NOT NULL DEFAULT '',
  effective_date   TEXT NOT NULL,
  prop_code        TEXT NOT NULL,
  issued_at        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT inn_code_property_id_fkey FOREIGN KEY (property_id) REFERENCES property(id)
);
CREATE INDEX inn_code_property_id_idx ON inn_code(property_id);
CREATE INDEX inn_code_market_code_idx ON inn_code(market_code);

CREATE TABLE market_claim (
  market_code   TEXT PRIMARY KEY,
  city          TEXT NOT NULL,
  state         TEXT NOT NULL,
  submarket     TEXT NOT NULL DEFAULT '',
  source        market_source NOT NULL,
  claimed_at    TEXT NOT NULL,
  submarket_key TEXT,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX market_claim_submarket_key_key ON market_claim(submarket_key);
