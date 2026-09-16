-- PropertyGroup / PropertyGroupMember (docs/01 §2.2).
--
-- Hand-written rather than generated: the schema engine cannot run in the
-- Linux workspace this was authored from. It is the exact DDL `prisma migrate
-- dev` produces for the models it accompanies, and `prisma migrate status`
-- confirms no drift once applied.

-- CreateEnum
CREATE TYPE "group_kind" AS ENUM ('region', 'brand', 'entity', 'ad_hoc', 'audit');

-- CreateEnum
CREATE TYPE "membership_mode" AS ENUM ('manual', 'rule');

-- CreateTable
CREATE TABLE "property_group" (
    "id" TEXT NOT NULL,
    "kind" "group_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "membership_mode" "membership_mode" NOT NULL DEFAULT 'manual',
    "rule_json" JSONB,
    "synced_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_group_member" (
    "group_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "added_by_id" TEXT,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_group_member_pkey" PRIMARY KEY ("group_id","property_id")
);

-- CreateIndex
CREATE INDEX "property_group_kind_idx" ON "property_group"("kind");

-- CreateIndex
CREATE INDEX "property_group_archived_at_idx" ON "property_group"("archived_at");

-- CreateIndex
CREATE INDEX "property_group_member_property_id_idx" ON "property_group_member"("property_id");

-- AddForeignKey
ALTER TABLE "property_group_member" ADD CONSTRAINT "property_group_member_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "property_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_group_member" ADD CONSTRAINT "property_group_member_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
