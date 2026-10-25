-- CreateEnum
CREATE TYPE "TherapyPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "PlanPeriodUnit" AS ENUM ('DAY', 'WEEK', 'MONTH');

-- CreateEnum
CREATE TYPE "TherapyGoalStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'ACHIEVED', 'ON_HOLD', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "GoalMeasurementType" AS ENUM ('NARRATIVE', 'PERCENTAGE', 'COUNT', 'DURATION', 'FREQUENCY', 'RATING_SCALE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ReviewOverallProgress" AS ENUM ('SIGNIFICANT', 'MODERATE', 'MINIMAL', 'NONE', 'REGRESSION', 'NOT_ENOUGH_INFORMATION');

-- CreateEnum
CREATE TYPE "ReviewRecommendation" AS ENUM ('CONTINUE', 'MODIFY', 'INCREASE_FREQUENCY', 'DECREASE_FREQUENCY', 'PAUSE', 'COMPLETE', 'REFER_FOR_ASSESSMENT');

-- CreateEnum
CREATE TYPE "TherapyPlanEvent" AS ENUM ('ACTIVATED', 'PAUSED', 'RESUMED', 'COMPLETED', 'DISCONTINUED', 'REVISED', 'THERAPIST_REASSIGNED', 'GOAL_ADDED', 'GOAL_UPDATED');

-- CreateTable
CREATE TABLE "TherapyGoalCategory" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "therapyTypeId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TherapyGoalCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TherapyPlan" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "patientId" UUID NOT NULL,
    "therapyTypeId" UUID NOT NULL,
    "therapistId" UUID NOT NULL,
    "sourceAssessmentId" UUID,
    "title" TEXT NOT NULL,
    "treatmentFocus" TEXT,
    "clinicalNotes" TEXT,
    "sessionsPerPeriod" INTEGER,
    "frequencyUnit" "PlanPeriodUnit",
    "durationMinutes" INTEGER,
    "reviewIntervalValue" INTEGER,
    "reviewIntervalUnit" "PlanPeriodUnit",
    "additionalInstructions" TEXT,
    "startDate" DATE NOT NULL,
    "targetEndDate" DATE,
    "nextReviewDate" DATE,
    "status" "TherapyPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "activatedAt" TIMESTAMP(3),
    "activatedById" UUID,
    "pausedAt" TIMESTAMP(3),
    "statusReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" UUID,
    "completionSummary" TEXT,
    "discontinuedAt" TIMESTAMP(3),
    "discontinuedById" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TherapyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TherapyPlanGoal" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "therapyPlanId" UUID NOT NULL,
    "sourceAssessmentGoalId" UUID,
    "categoryId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "GoalPriority",
    "measurementType" "GoalMeasurementType" NOT NULL DEFAULT 'NARRATIVE',
    "measurementConfig" JSONB,
    "baselineText" TEXT,
    "baselineValue" DOUBLE PRECISION,
    "targetText" TEXT,
    "targetValue" DOUBLE PRECISION,
    "targetDate" DATE,
    "status" "TherapyGoalStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "statusChangedAt" TIMESTAMP(3),
    "statusChangedById" UUID,
    "notes" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TherapyPlanGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TherapyGoalProgress" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "therapyPlanId" UUID NOT NULL,
    "goalId" UUID NOT NULL,
    "observationDate" DATE NOT NULL,
    "goalStatus" "TherapyGoalStatus",
    "measuredValue" DOUBLE PRECISION,
    "observation" TEXT,
    "correctsId" UUID,
    "correctionReason" TEXT,
    "recordedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TherapyGoalProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TherapyPlanReview" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "therapyPlanId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "reviewDate" DATE NOT NULL,
    "therapistId" UUID NOT NULL,
    "reviewedById" UUID NOT NULL,
    "overallProgress" "ReviewOverallProgress" NOT NULL,
    "recommendation" "ReviewRecommendation" NOT NULL,
    "observations" TEXT,
    "goalSummary" TEXT,
    "notes" TEXT,
    "nextReviewDate" DATE,
    "goalSnapshot" JSONB NOT NULL,
    "planSnapshot" JSONB NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TherapyPlanReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TherapyPlanReviewAmendment" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "reviewId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "changedFields" JSONB NOT NULL,
    "previousContent" JSONB NOT NULL,
    "amendedById" UUID NOT NULL,
    "amendedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TherapyPlanReviewAmendment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TherapyPlanRevision" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "therapyPlanId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "event" "TherapyPlanEvent" NOT NULL,
    "changedFields" JSONB NOT NULL DEFAULT '[]',
    "previousSnapshot" JSONB,
    "newSnapshot" JSONB,
    "reason" TEXT,
    "goalId" UUID,
    "reviewId" UUID,
    "revisedById" UUID NOT NULL,
    "revisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TherapyPlanRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TherapyGoalCategory_centerId_isActive_displayOrder_idx" ON "TherapyGoalCategory"("centerId", "isActive", "displayOrder");

-- CreateIndex
CREATE INDEX "TherapyPlan_centerId_status_nextReviewDate_idx" ON "TherapyPlan"("centerId", "status", "nextReviewDate");

-- CreateIndex
CREATE INDEX "TherapyPlan_centerId_createdAt_idx" ON "TherapyPlan"("centerId", "createdAt");

-- CreateIndex
CREATE INDEX "TherapyPlan_patientId_status_idx" ON "TherapyPlan"("patientId", "status");

-- CreateIndex
CREATE INDEX "TherapyPlan_therapistId_status_idx" ON "TherapyPlan"("therapistId", "status");

-- CreateIndex
CREATE INDEX "TherapyPlan_therapyTypeId_idx" ON "TherapyPlan"("therapyTypeId");

-- CreateIndex
CREATE INDEX "TherapyPlan_sourceAssessmentId_idx" ON "TherapyPlan"("sourceAssessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "TherapyPlan_centerId_code_key" ON "TherapyPlan"("centerId", "code");

-- CreateIndex
CREATE INDEX "TherapyPlanGoal_therapyPlanId_displayOrder_idx" ON "TherapyPlanGoal"("therapyPlanId", "displayOrder");

-- CreateIndex
CREATE INDEX "TherapyPlanGoal_categoryId_idx" ON "TherapyPlanGoal"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "TherapyGoalProgress_correctsId_key" ON "TherapyGoalProgress"("correctsId");

-- CreateIndex
CREATE INDEX "TherapyGoalProgress_goalId_observationDate_idx" ON "TherapyGoalProgress"("goalId", "observationDate");

-- CreateIndex
CREATE INDEX "TherapyGoalProgress_therapyPlanId_observationDate_idx" ON "TherapyGoalProgress"("therapyPlanId", "observationDate");

-- CreateIndex
CREATE UNIQUE INDEX "TherapyPlanReview_therapyPlanId_number_key" ON "TherapyPlanReview"("therapyPlanId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "TherapyPlanReviewAmendment_reviewId_number_key" ON "TherapyPlanReviewAmendment"("reviewId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "TherapyPlanRevision_therapyPlanId_number_key" ON "TherapyPlanRevision"("therapyPlanId", "number");

-- AddForeignKey
ALTER TABLE "TherapyGoalCategory" ADD CONSTRAINT "TherapyGoalCategory_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyGoalCategory" ADD CONSTRAINT "TherapyGoalCategory_therapyTypeId_fkey" FOREIGN KEY ("therapyTypeId") REFERENCES "TherapyType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPlan" ADD CONSTRAINT "TherapyPlan_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPlan" ADD CONSTRAINT "TherapyPlan_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPlan" ADD CONSTRAINT "TherapyPlan_therapyTypeId_fkey" FOREIGN KEY ("therapyTypeId") REFERENCES "TherapyType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPlan" ADD CONSTRAINT "TherapyPlan_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "Therapist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPlan" ADD CONSTRAINT "TherapyPlan_sourceAssessmentId_fkey" FOREIGN KEY ("sourceAssessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPlan" ADD CONSTRAINT "TherapyPlan_activatedById_fkey" FOREIGN KEY ("activatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPlan" ADD CONSTRAINT "TherapyPlan_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPlan" ADD CONSTRAINT "TherapyPlan_discontinuedById_fkey" FOREIGN KEY ("discontinuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPlan" ADD CONSTRAINT "TherapyPlan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPlan" ADD CONSTRAINT "TherapyPlan_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPlanGoal" ADD CONSTRAINT "TherapyPlanGoal_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPlanGoal" ADD CONSTRAINT "TherapyPlanGoal_therapyPlanId_fkey" FOREIGN KEY ("therapyPlanId") REFERENCES "TherapyPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPlanGoal" ADD CONSTRAINT "TherapyPlanGoal_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TherapyGoalCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPlanGoal" ADD CONSTRAINT "TherapyPlanGoal_statusChangedById_fkey" FOREIGN KEY ("statusChangedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPlanGoal" ADD CONSTRAINT "TherapyPlanGoal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyGoalProgress" ADD CONSTRAINT "TherapyGoalProgress_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyGoalProgress" ADD CONSTRAINT "TherapyGoalProgress_therapyPlanId_fkey" FOREIGN KEY ("therapyPlanId") REFERENCES "TherapyPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyGoalProgress" ADD CONSTRAINT "TherapyGoalProgress_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "TherapyPlanGoal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyGoalProgress" ADD CONSTRAINT "TherapyGoalProgress_correctsId_fkey" FOREIGN KEY ("correctsId") REFERENCES "TherapyGoalProgress"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyGoalProgress" ADD CONSTRAINT "TherapyGoalProgress_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPlanReview" ADD CONSTRAINT "TherapyPlanReview_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPlanReview" ADD CONSTRAINT "TherapyPlanReview_therapyPlanId_fkey" FOREIGN KEY ("therapyPlanId") REFERENCES "TherapyPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPlanReview" ADD CONSTRAINT "TherapyPlanReview_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "Therapist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPlanReview" ADD CONSTRAINT "TherapyPlanReview_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPlanReviewAmendment" ADD CONSTRAINT "TherapyPlanReviewAmendment_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPlanReviewAmendment" ADD CONSTRAINT "TherapyPlanReviewAmendment_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "TherapyPlanReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPlanReviewAmendment" ADD CONSTRAINT "TherapyPlanReviewAmendment_amendedById_fkey" FOREIGN KEY ("amendedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPlanRevision" ADD CONSTRAINT "TherapyPlanRevision_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPlanRevision" ADD CONSTRAINT "TherapyPlanRevision_therapyPlanId_fkey" FOREIGN KEY ("therapyPlanId") REFERENCES "TherapyPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPlanRevision" ADD CONSTRAINT "TherapyPlanRevision_revisedById_fkey" FOREIGN KEY ("revisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Rules Prisma can't express ──────────────────────────────────────────────

-- One plan in force (ACTIVE or PAUSED) per patient and therapy type, so a second
-- activation can't slip past the service's check. Drafts and closed plans don't count.
CREATE UNIQUE INDEX "TherapyPlan_one_open_per_therapy" ON "TherapyPlan"("patientId", "therapyTypeId") WHERE "status" IN ('ACTIVE', 'PAUSED');

-- Category names are unique per center and therapy type (or among general ones),
-- whatever their case.
CREATE UNIQUE INDEX "TherapyGoalCategory_name_key" ON "TherapyGoalCategory"("centerId", COALESCE("therapyTypeId", '00000000-0000-0000-0000-000000000000'::uuid), lower("name"));

ALTER TABLE "TherapyPlan" ADD CONSTRAINT "TherapyPlan_details_check" CHECK (
  "revision" >= 1
  AND length(btrim("title")) > 0
  AND (("sessionsPerPeriod" IS NULL) = ("frequencyUnit" IS NULL))
  AND ("sessionsPerPeriod" IS NULL OR "sessionsPerPeriod" BETWEEN 1 AND 60)
  AND (("reviewIntervalValue" IS NULL) = ("reviewIntervalUnit" IS NULL))
  AND ("reviewIntervalValue" IS NULL OR "reviewIntervalValue" BETWEEN 1 AND 365)
  AND ("durationMinutes" IS NULL OR "durationMinutes" BETWEEN 5 AND 480)
  AND ("targetEndDate" IS NULL OR "targetEndDate" >= "startDate")
);
-- Lifecycle details exist exactly when the plan has reached that status.
ALTER TABLE "TherapyPlan" ADD CONSTRAINT "TherapyPlan_lifecycle_check" CHECK (
  (("status" = 'DRAFT') = ("activatedAt" IS NULL))
  AND (("activatedAt" IS NULL) = ("activatedById" IS NULL))
  AND ("status" <> 'PAUSED' OR ("pausedAt" IS NOT NULL AND "statusReason" IS NOT NULL))
  AND (("status" = 'COMPLETED') = ("completedAt" IS NOT NULL))
  AND ("completedAt" IS NULL OR ("completedById" IS NOT NULL AND "completionSummary" IS NOT NULL))
  AND (("status" = 'DISCONTINUED') = ("discontinuedAt" IS NOT NULL))
  AND ("discontinuedAt" IS NULL OR ("discontinuedById" IS NOT NULL AND "statusReason" IS NOT NULL))
);
-- Narrative goals carry no numbers.
ALTER TABLE "TherapyPlanGoal" ADD CONSTRAINT "TherapyPlanGoal_measurement_check" CHECK (
  length(btrim("title")) > 0
  AND ("measurementType" <> 'NARRATIVE' OR ("baselineValue" IS NULL AND "targetValue" IS NULL))
  AND ("measurementConfig" IS NULL OR jsonb_typeof("measurementConfig") = 'object')
  AND (("statusChangedAt" IS NULL) = ("statusChangedById" IS NULL))
);
-- A progress entry records something, and corrections say why.
ALTER TABLE "TherapyGoalProgress" ADD CONSTRAINT "TherapyGoalProgress_content_check" CHECK (
  ("goalStatus" IS NOT NULL OR "measuredValue" IS NOT NULL OR "observation" IS NOT NULL)
  AND (("correctsId" IS NULL) = ("correctionReason" IS NULL))
  AND ("correctsId" IS NULL OR "correctsId" <> "id")
);
ALTER TABLE "TherapyPlanReview" ADD CONSTRAINT "TherapyPlanReview_check" CHECK (
  "number" >= 1
  AND jsonb_typeof("goalSnapshot") = 'array'
  AND jsonb_typeof("planSnapshot") = 'object'
);
ALTER TABLE "TherapyPlanReviewAmendment" ADD CONSTRAINT "TherapyPlanReviewAmendment_check" CHECK (
  "number" >= 1 AND length(btrim("reason")) > 0 AND jsonb_typeof("previousContent") = 'object'
);
ALTER TABLE "TherapyPlanRevision" ADD CONSTRAINT "TherapyPlanRevision_check" CHECK (
  "number" >= 1 AND jsonb_typeof("changedFields") = 'array'
);

-- Plans: only drafts can be deleted, closed plans never change, a plan never goes back
-- to being a draft, and who and what it's for are fixed (the therapy only while a draft).
CREATE FUNCTION "therapy_plan_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'Only draft therapy plans can be deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" IN ('COMPLETED', 'DISCONTINUED') THEN
    RAISE EXCEPTION 'Closed therapy plans cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" <> 'DRAFT' AND NEW."status" = 'DRAFT' THEN
    RAISE EXCEPTION 'A therapy plan cannot return to draft' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."centerId" <> OLD."centerId" OR NEW."patientId" <> OLD."patientId" OR NEW."code" <> OLD."code"
     OR (OLD."status" <> 'DRAFT' AND NEW."therapyTypeId" <> OLD."therapyTypeId") THEN
    RAISE EXCEPTION 'A therapy plan''s patient, code and (once active) therapy cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TherapyPlan_guard"
  BEFORE UPDATE OR DELETE ON "TherapyPlan"
  FOR EACH ROW EXECUTE FUNCTION "therapy_plan_guard"();

-- Goals: removed only while their plan is a draft, never changed once it's closed,
-- and never moved to another plan.
CREATE FUNCTION "therapy_plan_goal_guard"() RETURNS trigger AS $$
DECLARE
  plan_status "TherapyPlanStatus";
BEGIN
  SELECT "status" INTO plan_status FROM "TherapyPlan" WHERE "id" = OLD."therapyPlanId";
  IF TG_OP = 'DELETE' THEN
    IF plan_status IS DISTINCT FROM 'DRAFT' THEN
      RAISE EXCEPTION 'Goals of an active or closed plan cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF plan_status IN ('COMPLETED', 'DISCONTINUED') THEN
    RAISE EXCEPTION 'Goals of a closed plan cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."therapyPlanId" <> OLD."therapyPlanId" OR NEW."centerId" <> OLD."centerId" THEN
    RAISE EXCEPTION 'A goal cannot move to another plan' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TherapyPlanGoal_guard"
  BEFORE UPDATE OR DELETE ON "TherapyPlanGoal"
  FOR EACH ROW EXECUTE FUNCTION "therapy_plan_goal_guard"();

-- Progress entries, plan history and review corrections are append-only, and reviews
-- are never deleted (corrections go through amendments).
CREATE FUNCTION "therapy_plan_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows cannot be changed or deleted', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TherapyGoalProgress_append_only"
  BEFORE UPDATE OR DELETE ON "TherapyGoalProgress"
  FOR EACH ROW EXECUTE FUNCTION "therapy_plan_append_only"();

CREATE TRIGGER "TherapyPlanRevision_append_only"
  BEFORE UPDATE OR DELETE ON "TherapyPlanRevision"
  FOR EACH ROW EXECUTE FUNCTION "therapy_plan_append_only"();

CREATE TRIGGER "TherapyPlanReviewAmendment_append_only"
  BEFORE UPDATE OR DELETE ON "TherapyPlanReviewAmendment"
  FOR EACH ROW EXECUTE FUNCTION "therapy_plan_append_only"();

CREATE TRIGGER "TherapyPlanReview_no_delete"
  BEFORE DELETE ON "TherapyPlanReview"
  FOR EACH ROW EXECUTE FUNCTION "therapy_plan_append_only"();
