-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('NOT_MARKED', 'PRESENT', 'ABSENT', 'LATE');

-- CreateEnum
CREATE TYPE "TherapySessionStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'VOIDED');

-- CreateEnum
CREATE TYPE "SessionNoteStatus" AS ENUM ('DRAFT', 'COMPLETED', 'AMENDED');

-- CreateEnum
CREATE TYPE "SessionNoteTemplateStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AppointmentHistoryAction" ADD VALUE 'ATTENDANCE_RECORDED';
ALTER TYPE "AppointmentHistoryAction" ADD VALUE 'ATTENDANCE_CORRECTED';
ALTER TYPE "AppointmentHistoryAction" ADD VALUE 'SESSION_STARTED';
ALTER TYPE "AppointmentHistoryAction" ADD VALUE 'SESSION_CORRECTED';

-- AlterTable
ALTER TABLE "TherapyGoalProgress" ADD COLUMN     "sessionNoteId" UUID;

-- CreateTable
CREATE TABLE "SessionAttendance" (
    "appointmentId" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "checkInAt" TIMESTAMP(3),
    "actualStartAt" TIMESTAMP(3),
    "actualEndAt" TIMESTAMP(3),
    "note" TEXT,
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionAttendance_pkey" PRIMARY KEY ("appointmentId")
);

-- CreateTable
CREATE TABLE "TherapySession" (
    "appointmentId" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "status" "TherapySessionStatus" NOT NULL,
    "therapyPlanId" UUID,
    "startedAt" TIMESTAMP(3),
    "startedById" UUID,
    "completedAt" TIMESTAMP(3),
    "completedById" UUID,
    "voidedAt" TIMESTAMP(3),
    "voidedById" UUID,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TherapySession_pkey" PRIMARY KEY ("appointmentId")
);

-- CreateTable
CREATE TABLE "SessionNoteTemplate" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "therapyTypeId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "SessionNoteTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "latestVersion" INTEGER NOT NULL DEFAULT 1,
    "publishedVersionId" UUID,
    "createdById" UUID NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionNoteTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionNoteTemplateVersion" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "TemplateVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "definition" JSONB NOT NULL,
    "createdById" UUID NOT NULL,
    "publishedById" UUID,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionNoteTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionNote" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "appointmentId" UUID NOT NULL,
    "templateVersionId" UUID NOT NULL,
    "therapistId" UUID NOT NULL,
    "therapyPlanId" UUID,
    "status" "SessionNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "answers" JSONB NOT NULL DEFAULT '{}',
    "draftGoals" JSONB NOT NULL DEFAULT '[]',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "updatedById" UUID,
    "completedById" UUID,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionNoteAmendment" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "changedFields" JSONB NOT NULL,
    "previousContent" JSONB NOT NULL,
    "previousRevision" INTEGER NOT NULL,
    "amendedById" UUID NOT NULL,
    "amendedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionNoteAmendment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessionAttendance_centerId_status_idx" ON "SessionAttendance"("centerId", "status");

-- CreateIndex
CREATE INDEX "TherapySession_centerId_status_idx" ON "TherapySession"("centerId", "status");

-- CreateIndex
CREATE INDEX "TherapySession_therapyPlanId_idx" ON "TherapySession"("therapyPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionNoteTemplate_publishedVersionId_key" ON "SessionNoteTemplate"("publishedVersionId");

-- CreateIndex
CREATE INDEX "SessionNoteTemplate_centerId_therapyTypeId_status_idx" ON "SessionNoteTemplate"("centerId", "therapyTypeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SessionNoteTemplate_centerId_name_key" ON "SessionNoteTemplate"("centerId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SessionNoteTemplateVersion_templateId_version_key" ON "SessionNoteTemplateVersion"("templateId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SessionNote_appointmentId_key" ON "SessionNote"("appointmentId");

-- CreateIndex
CREATE INDEX "SessionNote_centerId_status_updatedAt_idx" ON "SessionNote"("centerId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "SessionNote_therapistId_status_idx" ON "SessionNote"("therapistId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SessionNoteAmendment_noteId_number_key" ON "SessionNoteAmendment"("noteId", "number");

-- CreateIndex
CREATE INDEX "TherapyGoalProgress_sessionNoteId_idx" ON "TherapyGoalProgress"("sessionNoteId");

-- AddForeignKey
ALTER TABLE "TherapyGoalProgress" ADD CONSTRAINT "TherapyGoalProgress_sessionNoteId_fkey" FOREIGN KEY ("sessionNoteId") REFERENCES "SessionNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionAttendance" ADD CONSTRAINT "SessionAttendance_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionAttendance" ADD CONSTRAINT "SessionAttendance_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionAttendance" ADD CONSTRAINT "SessionAttendance_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapySession" ADD CONSTRAINT "TherapySession_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapySession" ADD CONSTRAINT "TherapySession_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapySession" ADD CONSTRAINT "TherapySession_therapyPlanId_fkey" FOREIGN KEY ("therapyPlanId") REFERENCES "TherapyPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapySession" ADD CONSTRAINT "TherapySession_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapySession" ADD CONSTRAINT "TherapySession_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapySession" ADD CONSTRAINT "TherapySession_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionNoteTemplate" ADD CONSTRAINT "SessionNoteTemplate_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionNoteTemplate" ADD CONSTRAINT "SessionNoteTemplate_therapyTypeId_fkey" FOREIGN KEY ("therapyTypeId") REFERENCES "TherapyType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionNoteTemplate" ADD CONSTRAINT "SessionNoteTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionNoteTemplate" ADD CONSTRAINT "SessionNoteTemplate_publishedVersionId_fkey" FOREIGN KEY ("publishedVersionId") REFERENCES "SessionNoteTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionNoteTemplateVersion" ADD CONSTRAINT "SessionNoteTemplateVersion_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionNoteTemplateVersion" ADD CONSTRAINT "SessionNoteTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "SessionNoteTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionNoteTemplateVersion" ADD CONSTRAINT "SessionNoteTemplateVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionNoteTemplateVersion" ADD CONSTRAINT "SessionNoteTemplateVersion_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionNote" ADD CONSTRAINT "SessionNote_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionNote" ADD CONSTRAINT "SessionNote_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "TherapySession"("appointmentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionNote" ADD CONSTRAINT "SessionNote_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "SessionNoteTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionNote" ADD CONSTRAINT "SessionNote_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "Therapist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionNote" ADD CONSTRAINT "SessionNote_therapyPlanId_fkey" FOREIGN KEY ("therapyPlanId") REFERENCES "TherapyPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionNote" ADD CONSTRAINT "SessionNote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionNote" ADD CONSTRAINT "SessionNote_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionNote" ADD CONSTRAINT "SessionNote_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionNoteAmendment" ADD CONSTRAINT "SessionNoteAmendment_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionNoteAmendment" ADD CONSTRAINT "SessionNoteAmendment_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "SessionNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionNoteAmendment" ADD CONSTRAINT "SessionNoteAmendment_amendedById_fkey" FOREIGN KEY ("amendedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Rules Prisma can't express ──────────────────────────────────────────────

-- A session note records progress for a goal at most once; later changes are
-- corrections (correctsId), which keep the note's ID, so retries and amendments can't
-- duplicate it.
CREATE UNIQUE INDEX "TherapyGoalProgress_one_per_note_goal" ON "TherapyGoalProgress"("sessionNoteId", "goalId") WHERE "sessionNoteId" IS NOT NULL AND "correctsId" IS NULL;

-- Attendance: arrival and session times only for attended sessions, in order.
ALTER TABLE "SessionAttendance" ADD CONSTRAINT "SessionAttendance_check" CHECK (
  ("status" IN ('PRESENT', 'LATE')
    OR ("checkInAt" IS NULL AND "actualStartAt" IS NULL AND "actualEndAt" IS NULL))
  AND ("actualStartAt" IS NULL OR "actualEndAt" IS NULL OR "actualEndAt" > "actualStartAt")
  AND "revision" >= 1
);

-- Sessions: who and when for each step, present exactly when the step happened.
-- NOT_STARTED is never stored (no row means not started).
ALTER TABLE "TherapySession" ADD CONSTRAINT "TherapySession_check" CHECK (
  "status" <> 'NOT_STARTED'
  AND (("startedAt" IS NULL) = ("startedById" IS NULL))
  AND (("completedAt" IS NULL) = ("completedById" IS NULL))
  AND (("voidedAt" IS NULL) = ("voidedById" IS NULL))
  AND ("status" <> 'IN_PROGRESS' OR ("startedAt" IS NOT NULL AND "completedAt" IS NULL))
  AND ("status" <> 'COMPLETED' OR ("completedAt" IS NOT NULL AND "voidedAt" IS NULL))
  AND (("status" = 'VOIDED') = ("voidedAt" IS NOT NULL))
  AND ("status" <> 'VOIDED' OR length(btrim(coalesce("voidReason", ''))) > 0)
);

-- Sessions are never deleted, a completed one only ever becomes voided (keeping who
-- completed it and when), and a voided one never changes again.
CREATE FUNCTION "therapy_session_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Therapy sessions cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'VOIDED' THEN
    RAISE EXCEPTION 'Voided therapy sessions cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'COMPLETED' AND (
    NEW."status" NOT IN ('COMPLETED', 'VOIDED')
    OR NEW."completedAt" IS DISTINCT FROM OLD."completedAt"
    OR NEW."completedById" IS DISTINCT FROM OLD."completedById"
  ) THEN
    RAISE EXCEPTION 'A completed therapy session can only be voided' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."appointmentId" <> OLD."appointmentId" OR NEW."centerId" <> OLD."centerId" THEN
    RAISE EXCEPTION 'A therapy session cannot move to another appointment' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TherapySession_guard"
  BEFORE UPDATE OR DELETE ON "TherapySession"
  FOR EACH ROW EXECUTE FUNCTION "therapy_session_guard"();

-- Note templates: the same version rules as assessment templates (one version being
-- edited, one in use, published forms frozen), and at most one default per center and
-- therapy type, the general templates (no therapy type) counting as one type.
ALTER TABLE "SessionNoteTemplate" ADD CONSTRAINT "SessionNoteTemplate_status_check" CHECK (
  ("status" <> 'PUBLISHED' OR "publishedVersionId" IS NOT NULL)
  AND (("status" = 'ARCHIVED') = ("archivedAt" IS NOT NULL))
  AND (NOT "isDefault" OR "status" = 'PUBLISHED')
  AND "latestVersion" >= 1
);
CREATE UNIQUE INDEX "SessionNoteTemplate_one_default" ON "SessionNoteTemplate"("centerId", COALESCE("therapyTypeId", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "isDefault";

ALTER TABLE "SessionNoteTemplateVersion" ADD CONSTRAINT "SessionNoteTemplateVersion_check" CHECK (
  "version" >= 1
  AND jsonb_typeof("definition") = 'object'
  AND (("status" = 'DRAFT') = ("publishedAt" IS NULL))
);
CREATE UNIQUE INDEX "SessionNoteTemplateVersion_one_draft" ON "SessionNoteTemplateVersion"("templateId") WHERE "status" = 'DRAFT';
CREATE UNIQUE INDEX "SessionNoteTemplateVersion_one_published" ON "SessionNoteTemplateVersion"("templateId") WHERE "status" = 'PUBLISHED';

-- The assessments migration's guard is generic over OLD/NEW: published forms never
-- change and are never deleted.
CREATE TRIGGER "SessionNoteTemplateVersion_guard"
  BEFORE UPDATE OR DELETE ON "SessionNoteTemplateVersion"
  FOR EACH ROW EXECUTE FUNCTION "assessment_template_version_guard"();

-- Notes: completion details exist exactly when the note was completed, and draft goal
-- progress only lives on drafts (completing writes it to TherapyGoalProgress).
ALTER TABLE "SessionNote" ADD CONSTRAINT "SessionNote_check" CHECK (
  (("status" = 'DRAFT') = ("completedAt" IS NULL))
  AND (("completedAt" IS NULL) = ("completedById" IS NULL))
  AND jsonb_typeof("answers") = 'object'
  AND jsonb_typeof("draftGoals") = 'array'
  AND ("status" = 'DRAFT' OR "draftGoals" = '[]'::jsonb)
  AND "revision" >= 1
);

-- Only drafts can be discarded; a note never changes its session, form or therapist,
-- and never goes back to being a draft.
CREATE FUNCTION "session_note_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'Completed session notes cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'DRAFT' AND NEW."status" = 'DRAFT' THEN
    RAISE EXCEPTION 'A completed session note cannot return to draft' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."appointmentId" <> OLD."appointmentId" OR NEW."centerId" <> OLD."centerId"
     OR NEW."templateVersionId" <> OLD."templateVersionId" OR NEW."therapistId" <> OLD."therapistId"
     OR (OLD."status" <> 'DRAFT' AND (
       NEW."completedAt" IS DISTINCT FROM OLD."completedAt"
       OR NEW."completedById" IS DISTINCT FROM OLD."completedById")) THEN
    RAISE EXCEPTION 'A session note''s session, form, therapist and sign-off cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SessionNote_guard"
  BEFORE UPDATE OR DELETE ON "SessionNote"
  FOR EACH ROW EXECUTE FUNCTION "session_note_guard"();

-- Amendments are append-only (the therapy plans migration's generic guard).
ALTER TABLE "SessionNoteAmendment" ADD CONSTRAINT "SessionNoteAmendment_check" CHECK (
  "number" >= 1 AND length(btrim("reason")) > 0
  AND jsonb_typeof("previousContent") = 'object'
  AND jsonb_typeof("changedFields") = 'array'
);

CREATE TRIGGER "SessionNoteAmendment_append_only"
  BEFORE UPDATE OR DELETE ON "SessionNoteAmendment"
  FOR EACH ROW EXECUTE FUNCTION "therapy_plan_append_only"();
