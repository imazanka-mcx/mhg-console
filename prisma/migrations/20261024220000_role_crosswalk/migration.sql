-- The role crosswalk (docs/01 §2.7): the roles Inspire and InspiredREV enforce,
-- and what each console role becomes in each of them.
--
-- Additive only. Rows come from `npm run db:seed`, not from this migration, the
-- same way the role and permission catalog does.
--
-- Hand-written rather than generated: the schema engine cannot run in the
-- Linux workspace this was authored from. It is the DDL `prisma migrate dev`
-- produces for these models; `prisma migrate status` confirms no drift once
-- applied on the Mac.

-- CreateEnum
CREATE TYPE "consumer_tier" AS ENUM ('org', 'property');

-- CreateTable
CREATE TABLE "consumer_role" (
    "consumer" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" "consumer_tier" NOT NULL,
    "rank" INTEGER NOT NULL,
    "carries" TEXT[],

    CONSTRAINT "consumer_role_pkey" PRIMARY KEY ("consumer","key")
);

-- CreateTable
CREATE TABLE "role_link" (
    "role_key" TEXT NOT NULL,
    "consumer" TEXT NOT NULL,
    "consumer_role" TEXT NOT NULL,
    "exception" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "role_link_pkey" PRIMARY KEY ("role_key","consumer")
);

-- CreateIndex
CREATE INDEX "role_link_consumer_consumer_role_idx" ON "role_link"("consumer", "consumer_role");

-- AddForeignKey
ALTER TABLE "role_link" ADD CONSTRAINT "role_link_role_key_fkey" FOREIGN KEY ("role_key") REFERENCES "role"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_link" ADD CONSTRAINT "role_link_consumer_consumer_role_fkey" FOREIGN KEY ("consumer", "consumer_role") REFERENCES "consumer_role"("consumer", "key") ON DELETE RESTRICT ON UPDATE CASCADE;
