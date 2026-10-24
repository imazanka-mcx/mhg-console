-- Ownership and control (docs/01 §1.7): organizations, their principals, the
-- temporal ownership and management assignments, and the console-only asset
-- and compliance fields on property.
--
-- Hand-written rather than generated: the schema engine cannot run in the
-- Linux workspace this was authored from. It is the DDL `prisma migrate dev`
-- produces for these models; `prisma migrate status` confirms no drift once
-- applied on the Mac.

-- CreateEnum
CREATE TYPE "org_kind" AS ENUM ('ownership', 'management');

-- AlterTable
ALTER TABLE "property" ADD COLUMN     "key_count" INTEGER,
ADD COLUMN     "pip_due_date" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "pip_status" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "postal_code" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "qa_last_date" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "qa_last_result" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "service_level" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "street_address" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "year_opened" INTEGER,
ADD COLUMN     "year_renovated" INTEGER;

-- CreateTable
CREATE TABLE "organization" (
    "id" TEXT NOT NULL,
    "kind" "org_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL DEFAULT '',
    "registered_state" TEXT NOT NULL DEFAULT '',
    "registration_number" TEXT NOT NULL DEFAULT '',
    "contact_name" TEXT NOT NULL DEFAULT '',
    "contact_email" TEXT NOT NULL DEFAULT '',
    "contact_phone" TEXT NOT NULL DEFAULT '',
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_principal" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "added_by_id" TEXT,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "organization_principal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_ownership" (
    "id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "title_entity" TEXT NOT NULL DEFAULT '',
    "title_entity_state" TEXT NOT NULL DEFAULT '',
    "license_effective_date" TEXT NOT NULL DEFAULT '',
    "license_expiry_date" TEXT NOT NULL DEFAULT '',
    "effective_from" TEXT NOT NULL,
    "effective_to" TEXT,
    "assigned_by_id" TEXT,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_ownership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_management" (
    "id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "agreement_expiry_date" TEXT NOT NULL DEFAULT '',
    "termination_notice_days" INTEGER,
    "effective_from" TEXT NOT NULL,
    "effective_to" TEXT,
    "assigned_by_id" TEXT,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_management_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "organization_kind_idx" ON "organization"("kind");

-- CreateIndex
CREATE INDEX "organization_principal_organization_id_removed_at_idx" ON "organization_principal"("organization_id", "removed_at");

-- CreateIndex
CREATE INDEX "organization_principal_email_idx" ON "organization_principal"("email");

-- CreateIndex
CREATE INDEX "property_ownership_property_id_effective_to_idx" ON "property_ownership"("property_id", "effective_to");

-- CreateIndex
CREATE INDEX "property_ownership_organization_id_idx" ON "property_ownership"("organization_id");

-- CreateIndex
CREATE INDEX "property_management_property_id_effective_to_idx" ON "property_management"("property_id", "effective_to");

-- CreateIndex
CREATE INDEX "property_management_organization_id_idx" ON "property_management"("organization_id");

-- AddForeignKey
ALTER TABLE "organization_principal" ADD CONSTRAINT "organization_principal_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_ownership" ADD CONSTRAINT "property_ownership_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_ownership" ADD CONSTRAINT "property_ownership_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_management" ADD CONSTRAINT "property_management_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_management" ADD CONSTRAINT "property_management_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
