-- Role links allow a choice (docs/01 §2.7): one console role may become one of
-- several consumer roles, with one default, and each grant records which.
--
-- role_link moves from one row per (role, consumer) to one row per allowed
-- consumer role. Existing rows are the defaults they already were. The rows
-- themselves come from `npm run db:seed`.
--
-- Hand-written rather than generated: the schema engine cannot run in the
-- Linux workspace this was authored from. It is the DDL `prisma migrate dev`
-- produces for these models; `prisma migrate status` confirms no drift once
-- applied on the Mac.

-- AlterTable
ALTER TABLE "role_link" ADD COLUMN     "is_default" BOOLEAN NOT NULL DEFAULT false;
UPDATE "role_link" SET "is_default" = true;
ALTER TABLE "role_link" DROP CONSTRAINT "role_link_pkey",
ADD CONSTRAINT "role_link_pkey" PRIMARY KEY ("role_key", "consumer", "consumer_role");

-- CreateTable
CREATE TABLE "grant_downstream" (
    "grant_id" TEXT NOT NULL,
    "consumer" TEXT NOT NULL,
    "consumer_role" TEXT NOT NULL,

    CONSTRAINT "grant_downstream_pkey" PRIMARY KEY ("grant_id","consumer")
);

-- AddForeignKey
ALTER TABLE "grant_downstream" ADD CONSTRAINT "grant_downstream_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "grant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
