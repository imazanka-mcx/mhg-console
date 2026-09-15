-- CreateEnum
CREATE TYPE "Scope" AS ENUM ('portfolio', 'group', 'property');

-- CreateEnum
CREATE TYPE "PersonStatus" AS ENUM ('invited', 'active', 'suspended', 'offboarded');

-- CreateTable
CREATE TABLE "person" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT,
    "status" "PersonStatus" NOT NULL DEFAULT 'invited',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "assignable_at" "Scope"[],

    CONSTRAINT "role_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "permission" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope_max" "Scope" NOT NULL,
    "owned_by" TEXT NOT NULL DEFAULT 'console',

    CONSTRAINT "permission_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "role_key" TEXT NOT NULL,
    "permission_key" TEXT NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("role_key","permission_key")
);

-- CreateTable
CREATE TABLE "grant" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "scope" "Scope" NOT NULL,
    "scope_ref" TEXT,
    "role_key" TEXT NOT NULL,
    "role_version" INTEGER NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMP(3),
    "granted_by_id" TEXT,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "person_email_key" ON "person"("email");

-- CreateIndex
CREATE INDEX "person_status_idx" ON "person"("status");

-- CreateIndex
CREATE INDEX "grant_person_id_effective_to_idx" ON "grant"("person_id", "effective_to");

-- CreateIndex
CREATE INDEX "grant_scope_scope_ref_idx" ON "grant"("scope", "scope_ref");

-- CreateIndex
CREATE INDEX "audit_event_at_idx" ON "audit_event"("at");

-- CreateIndex
CREATE INDEX "audit_event_subject_idx" ON "audit_event"("subject");

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_key_fkey" FOREIGN KEY ("role_key") REFERENCES "role"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "permission"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grant" ADD CONSTRAINT "grant_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grant" ADD CONSTRAINT "grant_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grant" ADD CONSTRAINT "grant_role_key_fkey" FOREIGN KEY ("role_key") REFERENCES "role"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
