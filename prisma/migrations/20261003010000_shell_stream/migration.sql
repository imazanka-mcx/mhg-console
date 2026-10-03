-- The shell stream (docs/01 §1.4) and the shell fields the engine does not own.
--
-- Hand-written rather than generated: the schema engine cannot run in the
-- Linux workspace this was authored from. It is the DDL `prisma migrate dev`
-- produces for these models; `prisma migrate status` confirms no drift once
-- applied on the Mac.

-- AlterTable
ALTER TABLE "property" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "expected_open_date" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "shell_version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'America/New_York';

-- CreateTable
CREATE TABLE "shell_event" (
    "seq" SERIAL NOT NULL,
    "property_id" TEXT NOT NULL,
    "shell_version" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shell_event_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "shell_subscriber" (
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "last_delivered_at" TIMESTAMP(3),
    "last_error" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shell_subscriber_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "shell_event_property_id_seq_idx" ON "shell_event"("property_id", "seq");

-- AddForeignKey
ALTER TABLE "shell_event" ADD CONSTRAINT "shell_event_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
