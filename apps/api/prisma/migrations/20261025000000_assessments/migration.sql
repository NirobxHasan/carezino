-- CreateEnum
CREATE TYPE "AssessmentType" AS ENUM ('INITIAL', 'FOLLOW_UP', 'REASSESSMENT');

-- CreateEnum
CREATE TYPE "AssessmentTemplateStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TemplateVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('DRAFT', 'COMPLETED', 'AMENDED');

-- CreateEnum
CREATE TYPE "GoalPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateTable
CREATE TABLE "AssessmentTemplate" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "therapyTypeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "purpose" "AssessmentType",
    "status" "AssessmentTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "latestVersion" INTEGER NOT NULL DEFAULT 1,
    "publishedVersionId" UUID,
    "createdById" UUID NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentTemplateVersion" (
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

    CONSTRAINT "AssessmentTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "therapistId" UUID NOT NULL,
    "therapyTypeId" UUID NOT NULL,
    "templateVersionId" UUID NOT NULL,
    "appointmentId" UUID,
    "type" "AssessmentType" NOT NULL,
    "assessmentDate" DATE NOT NULL,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "answers" JSONB NOT NULL DEFAULT '{}',
    "summary" TEXT,
    "keyFindings" TEXT,
    "strengths" TEXT,
    "areasOfDifficulty" TEXT,
    "clinicalImpression" TEXT,
    "followUpRecommendation" TEXT,
    "additionalRecommendations" TEXT,
    "suggestedReviewDate" DATE,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "updatedById" UUID,
    "completedById" UUID,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentRecommendation" (
    "id" UUID NOT NULL,
    "assessmentId" UUID NOT NULL,
    "therapyTypeId" UUID NOT NULL,
    "sessionsPerWeek" INTEGER,
    "durationMinutes" INTEGER,
    "reviewAfterWeeks" INTEGER,
    "note" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentGoal" (
    "id" UUID NOT NULL,
    "assessmentId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "GoalPriority",
    "targetReviewDate" DATE,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentAmendment" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "assessmentId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "changedFields" JSONB NOT NULL,
    "previousContent" JSONB NOT NULL,
    "previousRevision" INTEGER NOT NULL,
    "amendedById" UUID NOT NULL,
    "amendedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentAmendment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentTemplate_publishedVersionId_key" ON "AssessmentTemplate"("publishedVersionId");

-- CreateIndex
CREATE INDEX "AssessmentTemplate_centerId_therapyTypeId_status_idx" ON "AssessmentTemplate"("centerId", "therapyTypeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentTemplate_centerId_name_key" ON "AssessmentTemplate"("centerId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentTemplateVersion_templateId_version_key" ON "AssessmentTemplateVersion"("templateId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Assessment_appointmentId_key" ON "Assessment"("appointmentId");

-- CreateIndex
CREATE INDEX "Assessment_centerId_assessmentDate_idx" ON "Assessment"("centerId", "assessmentDate");

-- CreateIndex
CREATE INDEX "Assessment_centerId_status_assessmentDate_idx" ON "Assessment"("centerId", "status", "assessmentDate");

-- CreateIndex
CREATE INDEX "Assessment_patientId_assessmentDate_idx" ON "Assessment"("patientId", "assessmentDate");

-- CreateIndex
CREATE INDEX "Assessment_therapistId_assessmentDate_idx" ON "Assessment"("therapistId", "assessmentDate");

-- CreateIndex
CREATE INDEX "AssessmentRecommendation_assessmentId_displayOrder_idx" ON "AssessmentRecommendation"("assessmentId", "displayOrder");

-- CreateIndex
CREATE INDEX "AssessmentRecommendation_therapyTypeId_idx" ON "AssessmentRecommendation"("therapyTypeId");

-- CreateIndex
CREATE INDEX "AssessmentGoal_assessmentId_displayOrder_idx" ON "AssessmentGoal"("assessmentId", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentAmendment_assessmentId_number_key" ON "AssessmentAmendment"("assessmentId", "number");

-- AddForeignKey
ALTER TABLE "AssessmentTemplate" ADD CONSTRAINT "AssessmentTemplate_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTemplate" ADD CONSTRAINT "AssessmentTemplate_therapyTypeId_fkey" FOREIGN KEY ("therapyTypeId") REFERENCES "TherapyType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTemplate" ADD CONSTRAINT "AssessmentTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTemplate" ADD CONSTRAINT "AssessmentTemplate_publishedVersionId_fkey" FOREIGN KEY ("publishedVersionId") REFERENCES "AssessmentTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTemplateVersion" ADD CONSTRAINT "AssessmentTemplateVersion_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTemplateVersion" ADD CONSTRAINT "AssessmentTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AssessmentTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTemplateVersion" ADD CONSTRAINT "AssessmentTemplateVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTemplateVersion" ADD CONSTRAINT "AssessmentTemplateVersion_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "Therapist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_therapyTypeId_fkey" FOREIGN KEY ("therapyTypeId") REFERENCES "TherapyType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "AssessmentTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentRecommendation" ADD CONSTRAINT "AssessmentRecommendation_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentRecommendation" ADD CONSTRAINT "AssessmentRecommendation_therapyTypeId_fkey" FOREIGN KEY ("therapyTypeId") REFERENCES "TherapyType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentGoal" ADD CONSTRAINT "AssessmentGoal_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAmendment" ADD CONSTRAINT "AssessmentAmendment_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAmendment" ADD CONSTRAINT "AssessmentAmendment_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAmendment" ADD CONSTRAINT "AssessmentAmendment_amendedById_fkey" FOREIGN KEY ("amendedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Integrity checks Prisma can't express.
ALTER TABLE "AssessmentTemplate" ADD CONSTRAINT "AssessmentTemplate_status_check" CHECK (
  ("status" <> 'PUBLISHED' OR "publishedVersionId" IS NOT NULL)
  AND (("status" = 'ARCHIVED') = ("archivedAt" IS NOT NULL))
  AND "latestVersion" >= 1
);
ALTER TABLE "AssessmentTemplateVersion" ADD CONSTRAINT "AssessmentTemplateVersion_check" CHECK (
  "version" >= 1
  AND jsonb_typeof("definition") = 'object'
  AND (("status" = 'DRAFT') = ("publishedAt" IS NULL))
);
-- A template has at most one version being edited and one in use.
CREATE UNIQUE INDEX "AssessmentTemplateVersion_one_draft" ON "AssessmentTemplateVersion"("templateId") WHERE "status" = 'DRAFT';
CREATE UNIQUE INDEX "AssessmentTemplateVersion_one_published" ON "AssessmentTemplateVersion"("templateId") WHERE "status" = 'PUBLISHED';

-- Completion details exist exactly when the assessment has been completed.
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_completion_check" CHECK (
  (("status" = 'DRAFT') = ("completedAt" IS NULL))
  AND (("completedAt" IS NULL) = ("completedById" IS NULL))
  AND jsonb_typeof("answers") = 'object'
  AND "revision" >= 1
);
ALTER TABLE "AssessmentRecommendation" ADD CONSTRAINT "AssessmentRecommendation_ranges_check" CHECK (
  ("sessionsPerWeek" IS NULL OR "sessionsPerWeek" BETWEEN 1 AND 21)
  AND ("durationMinutes" IS NULL OR "durationMinutes" BETWEEN 5 AND 480)
  AND ("reviewAfterWeeks" IS NULL OR "reviewAfterWeeks" BETWEEN 1 AND 104)
);
ALTER TABLE "AssessmentAmendment" ADD CONSTRAINT "AssessmentAmendment_check" CHECK (
  "number" >= 1 AND length(btrim("reason")) > 0 AND jsonb_typeof("previousContent") = 'object'
);

-- Published template versions are frozen: their form, number and template never
-- change and they're never deleted, so every assessment keeps the form it was filled
-- in with. Only their status may move on (PUBLISHED → SUPERSEDED).
CREATE FUNCTION "assessment_template_version_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'Published template versions cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'DRAFT' AND (
    NEW."definition" IS DISTINCT FROM OLD."definition"
    OR NEW."version" <> OLD."version"
    OR NEW."templateId" <> OLD."templateId"
    OR NEW."status" = 'DRAFT'
  ) THEN
    RAISE EXCEPTION 'Published template versions cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AssessmentTemplateVersion_guard"
  BEFORE UPDATE OR DELETE ON "AssessmentTemplateVersion"
  FOR EACH ROW EXECUTE FUNCTION "assessment_template_version_guard"();

-- Completed assessments are never deleted (only drafts can be discarded), and
-- amendments are an append-only history.
CREATE FUNCTION "assessment_delete_guard"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'Completed assessments cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Assessment_delete_guard"
  BEFORE DELETE ON "Assessment"
  FOR EACH ROW EXECUTE FUNCTION "assessment_delete_guard"();

CREATE FUNCTION "assessment_amendment_guard"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Assessment amendments cannot be changed or deleted' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AssessmentAmendment_guard"
  BEFORE UPDATE OR DELETE ON "AssessmentAmendment"
  FOR EACH ROW EXECUTE FUNCTION "assessment_amendment_guard"();
