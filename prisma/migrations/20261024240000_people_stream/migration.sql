-- The people stream (docs/01 §2.8): who may sign in to Inspire and InspiredREV,
-- with what password and what access, pushed down the same subscriptions as
-- the shell stream.
--
-- Additive only. Nobody enters the stream until `npm run people -- backfill`
-- or their next grant, status or password change.
--
-- Hand-written rather than generated: the schema engine cannot run in the
-- Linux workspace this was authored from. It is the DDL `prisma migrate dev`
-- produces for these models; `prisma migrate status` confirms no drift once
-- applied on the Mac.

-- AlterTable
ALTER TABLE "person" ADD COLUMN     "person_version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "shell_subscriber" ADD COLUMN     "people_cursor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "people_last_attempt_at" TIMESTAMP(3),
ADD COLUMN     "people_last_delivered_at" TIMESTAMP(3),
ADD COLUMN     "people_last_error" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "person_event" (
    "seq" SERIAL NOT NULL,
    "person_id" TEXT NOT NULL,
    "person_version" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_event_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE INDEX "person_event_person_id_seq_idx" ON "person_event"("person_id", "seq");

-- AddForeignKey
ALTER TABLE "person_event" ADD CONSTRAINT "person_event_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
