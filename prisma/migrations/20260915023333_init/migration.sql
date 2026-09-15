-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('pipeline', 'active', 'retired');

-- CreateEnum
CREATE TYPE "market_source" AS ENUM ('override', 'metro', 'airport', 'letters', 'submarket', 'registered');

-- CreateTable
CREATE TABLE "property" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand_code" TEXT NOT NULL,
    "brand_name" TEXT NOT NULL,
    "chain_code" TEXT NOT NULL,
    "market_code" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "submarket" TEXT NOT NULL DEFAULT '',
    "franchisor_code" TEXT NOT NULL DEFAULT '',
    "status" "PropertyStatus" NOT NULL,
    "predecessor_code" TEXT NOT NULL DEFAULT '',
    "effective_date" TEXT NOT NULL,
    "prop_code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inn_code" (
    "code" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand_code" TEXT NOT NULL,
    "brand_name" TEXT NOT NULL,
    "chain_code" TEXT NOT NULL,
    "market_code" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "submarket" TEXT NOT NULL DEFAULT '',
    "franchisor_code" TEXT NOT NULL DEFAULT '',
    "status" "PropertyStatus" NOT NULL,
    "predecessor_code" TEXT NOT NULL DEFAULT '',
    "effective_date" TEXT NOT NULL,
    "prop_code" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inn_code_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "market_claim" (
    "market_code" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "submarket" TEXT NOT NULL DEFAULT '',
    "source" "market_source" NOT NULL,
    "claimed_at" TEXT NOT NULL,
    "submarket_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_claim_pkey" PRIMARY KEY ("market_code")
);

-- CreateIndex
CREATE UNIQUE INDEX "property_code_key" ON "property"("code");

-- CreateIndex
CREATE INDEX "property_status_idx" ON "property"("status");

-- CreateIndex
CREATE INDEX "property_market_code_idx" ON "property"("market_code");

-- CreateIndex
CREATE INDEX "inn_code_property_id_idx" ON "inn_code"("property_id");

-- CreateIndex
CREATE INDEX "inn_code_market_code_idx" ON "inn_code"("market_code");

-- CreateIndex
CREATE UNIQUE INDEX "market_claim_submarket_key_key" ON "market_claim"("submarket_key");

-- AddForeignKey
ALTER TABLE "inn_code" ADD CONSTRAINT "inn_code_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
