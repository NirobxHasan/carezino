-- CreateEnum
CREATE TYPE "PackagePeriodUnit" AS ENUM ('DAY', 'WEEK', 'MONTH');

-- CreateEnum
CREATE TYPE "PackageActivationPolicy" AS ENUM ('ENROLLMENT_DATE', 'FIXED_DATE', 'FIRST_SESSION');

-- CreateEnum
CREATE TYPE "PackageDiscountType" AS ENUM ('NONE', 'FIXED', 'PERCENTAGE', 'PRICE_OVERRIDE');

-- CreateEnum
CREATE TYPE "PackageEnrollmentState" AS ENUM ('PENDING', 'ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PackageLedgerMovement" AS ENUM ('INITIAL_ALLOCATION', 'BONUS_CREDIT', 'MANUAL_CREDIT', 'MANUAL_DEBIT', 'SESSION_CONSUMPTION', 'CONSUMPTION_REVERSAL');

-- CreateEnum
CREATE TYPE "PackageChargeReason" AS ENUM ('COMPLETED', 'NO_SHOW', 'LATE_CANCELLATION');

-- CreateEnum
CREATE TYPE "PackageReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED');

-- CreateEnum
CREATE TYPE "PackageReleaseReason" AS ENUM ('APPOINTMENT_CANCELLED', 'NO_SHOW_NOT_CHARGED', 'REMOVED', 'ENROLLMENT_CANCELLED');

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "packageEnrollmentId" UUID;

-- CreateTable
CREATE TABLE "TherapyPackage" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sessionCount" INTEGER NOT NULL,
    "defaultDurationMinutes" INTEGER,
    "price" DECIMAL(12,2) NOT NULL,
    "validityValue" INTEGER NOT NULL,
    "validityUnit" "PackagePeriodUnit" NOT NULL,
    "activationPolicy" "PackageActivationPolicy" NOT NULL DEFAULT 'ENROLLMENT_DATE',
    "usageLimitCount" INTEGER,
    "usageLimitPeriod" "PackagePeriodUnit",
    "coversAssessments" BOOLEAN NOT NULL DEFAULT false,
    "chargeNoShow" BOOLEAN NOT NULL DEFAULT false,
    "chargeLateCancellation" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TherapyPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageEligibleTherapyType" (
    "packageId" UUID NOT NULL,
    "therapyTypeId" UUID NOT NULL,

    CONSTRAINT "PackageEligibleTherapyType_pkey" PRIMARY KEY ("packageId","therapyTypeId")
);

-- CreateTable
CREATE TABLE "PackageEnrollment" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "patientId" UUID NOT NULL,
    "packageId" UUID NOT NULL,
    "therapyPlanId" UUID,
    "renewedFromId" UUID,
    "requestId" UUID,
    "packageName" TEXT NOT NULL,
    "packageCode" TEXT NOT NULL,
    "packageSnapshot" JSONB NOT NULL,
    "sessionCount" INTEGER NOT NULL,
    "defaultDurationMinutes" INTEGER,
    "validityValue" INTEGER NOT NULL,
    "validityUnit" "PackagePeriodUnit" NOT NULL,
    "activationPolicy" "PackageActivationPolicy" NOT NULL,
    "usageLimitCount" INTEGER,
    "usageLimitPeriod" "PackagePeriodUnit",
    "coversAssessments" BOOLEAN NOT NULL,
    "chargeNoShow" BOOLEAN NOT NULL,
    "chargeLateCancellation" BOOLEAN NOT NULL,
    "currency" TEXT NOT NULL,
    "catalogPrice" DECIMAL(12,2) NOT NULL,
    "discountType" "PackageDiscountType" NOT NULL DEFAULT 'NONE',
    "discountValue" DECIMAL(12,2),
    "finalPrice" DECIMAL(12,2) NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "customEndDate" BOOLEAN NOT NULL DEFAULT false,
    "state" "PackageEnrollmentState" NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "notes" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancellationReason" TEXT,
    "totalSessions" INTEGER NOT NULL DEFAULT 0,
    "consumedSessions" INTEGER NOT NULL DEFAULT 0,
    "reservedSessions" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackageEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageEnrollmentTherapyType" (
    "enrollmentId" UUID NOT NULL,
    "therapyTypeId" UUID NOT NULL,

    CONSTRAINT "PackageEnrollmentTherapyType_pkey" PRIMARY KEY ("enrollmentId","therapyTypeId")
);

-- CreateTable
CREATE TABLE "PackageSessionLedger" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "enrollmentId" UUID NOT NULL,
    "movement" "PackageLedgerMovement" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "appointmentId" UUID,
    "reservationId" UUID,
    "reversesId" UUID,
    "chargeReason" "PackageChargeReason",
    "reason" TEXT,
    "requestId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackageSessionLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageSessionReservation" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "enrollmentId" UUID NOT NULL,
    "appointmentId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" "PackageReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "sessionDate" DATE NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releasedById" UUID,
    "releaseReason" "PackageReleaseReason",
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "PackageSessionReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TherapyPackage_centerId_isActive_displayOrder_idx" ON "TherapyPackage"("centerId", "isActive", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TherapyPackage_centerId_code_key" ON "TherapyPackage"("centerId", "code");

-- CreateIndex
CREATE INDEX "PackageEligibleTherapyType_therapyTypeId_idx" ON "PackageEligibleTherapyType"("therapyTypeId");

-- CreateIndex
CREATE INDEX "PackageEnrollment_centerId_createdAt_idx" ON "PackageEnrollment"("centerId", "createdAt");

-- CreateIndex
CREATE INDEX "PackageEnrollment_centerId_state_endDate_idx" ON "PackageEnrollment"("centerId", "state", "endDate");

-- CreateIndex
CREATE INDEX "PackageEnrollment_patientId_createdAt_idx" ON "PackageEnrollment"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "PackageEnrollment_packageId_idx" ON "PackageEnrollment"("packageId");

-- CreateIndex
CREATE INDEX "PackageEnrollment_therapyPlanId_idx" ON "PackageEnrollment"("therapyPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "PackageEnrollment_centerId_code_key" ON "PackageEnrollment"("centerId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PackageEnrollment_centerId_requestId_key" ON "PackageEnrollment"("centerId", "requestId");

-- CreateIndex
CREATE INDEX "PackageEnrollmentTherapyType_therapyTypeId_idx" ON "PackageEnrollmentTherapyType"("therapyTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "PackageSessionLedger_reversesId_key" ON "PackageSessionLedger"("reversesId");

-- CreateIndex
CREATE INDEX "PackageSessionLedger_enrollmentId_createdAt_idx" ON "PackageSessionLedger"("enrollmentId", "createdAt");

-- CreateIndex
CREATE INDEX "PackageSessionLedger_appointmentId_idx" ON "PackageSessionLedger"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "PackageSessionLedger_enrollmentId_requestId_key" ON "PackageSessionLedger"("enrollmentId", "requestId");

-- CreateIndex
CREATE INDEX "PackageSessionReservation_enrollmentId_status_sessionDate_idx" ON "PackageSessionReservation"("enrollmentId", "status", "sessionDate");

-- CreateIndex
CREATE INDEX "PackageSessionReservation_appointmentId_idx" ON "PackageSessionReservation"("appointmentId");

-- CreateIndex
CREATE INDEX "Appointment_packageEnrollmentId_idx" ON "Appointment"("packageEnrollmentId");

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_packageEnrollmentId_fkey" FOREIGN KEY ("packageEnrollmentId") REFERENCES "PackageEnrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPackage" ADD CONSTRAINT "TherapyPackage_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPackage" ADD CONSTRAINT "TherapyPackage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPackage" ADD CONSTRAINT "TherapyPackage_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageEligibleTherapyType" ADD CONSTRAINT "PackageEligibleTherapyType_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "TherapyPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageEligibleTherapyType" ADD CONSTRAINT "PackageEligibleTherapyType_therapyTypeId_fkey" FOREIGN KEY ("therapyTypeId") REFERENCES "TherapyType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageEnrollment" ADD CONSTRAINT "PackageEnrollment_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageEnrollment" ADD CONSTRAINT "PackageEnrollment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageEnrollment" ADD CONSTRAINT "PackageEnrollment_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "TherapyPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageEnrollment" ADD CONSTRAINT "PackageEnrollment_therapyPlanId_fkey" FOREIGN KEY ("therapyPlanId") REFERENCES "TherapyPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageEnrollment" ADD CONSTRAINT "PackageEnrollment_renewedFromId_fkey" FOREIGN KEY ("renewedFromId") REFERENCES "PackageEnrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageEnrollment" ADD CONSTRAINT "PackageEnrollment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageEnrollment" ADD CONSTRAINT "PackageEnrollment_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageEnrollmentTherapyType" ADD CONSTRAINT "PackageEnrollmentTherapyType_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "PackageEnrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageEnrollmentTherapyType" ADD CONSTRAINT "PackageEnrollmentTherapyType_therapyTypeId_fkey" FOREIGN KEY ("therapyTypeId") REFERENCES "TherapyType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageSessionLedger" ADD CONSTRAINT "PackageSessionLedger_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageSessionLedger" ADD CONSTRAINT "PackageSessionLedger_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "PackageEnrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageSessionLedger" ADD CONSTRAINT "PackageSessionLedger_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageSessionLedger" ADD CONSTRAINT "PackageSessionLedger_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "PackageSessionReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageSessionLedger" ADD CONSTRAINT "PackageSessionLedger_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "PackageSessionLedger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageSessionLedger" ADD CONSTRAINT "PackageSessionLedger_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageSessionReservation" ADD CONSTRAINT "PackageSessionReservation_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageSessionReservation" ADD CONSTRAINT "PackageSessionReservation_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "PackageEnrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageSessionReservation" ADD CONSTRAINT "PackageSessionReservation_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageSessionReservation" ADD CONSTRAINT "PackageSessionReservation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageSessionReservation" ADD CONSTRAINT "PackageSessionReservation_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Rules Prisma can't express ──────────────────────────────────────────────

-- A session is consumed at most once per appointment, and an appointment holds at most
-- one active reservation, so retries and races can't charge or hold twice.
CREATE UNIQUE INDEX "PackageSessionLedger_one_consumption_per_appointment" ON "PackageSessionLedger"("appointmentId") WHERE "movement" = 'SESSION_CONSUMPTION';
CREATE UNIQUE INDEX "PackageSessionReservation_one_active_per_appointment" ON "PackageSessionReservation"("appointmentId") WHERE "status" = 'ACTIVE';

ALTER TABLE "TherapyPackage" ADD CONSTRAINT "TherapyPackage_terms_check" CHECK (
  length(btrim("name")) > 0
  AND length(btrim("code")) > 0
  AND "code" = upper("code")
  AND "sessionCount" BETWEEN 1 AND 1000
  AND "price" >= 0
  AND "validityValue" BETWEEN 1 AND 3660
  AND ("defaultDurationMinutes" IS NULL OR "defaultDurationMinutes" BETWEEN 5 AND 480)
  AND (("usageLimitCount" IS NULL) = ("usageLimitPeriod" IS NULL))
  AND ("usageLimitCount" IS NULL OR "usageLimitCount" BETWEEN 1 AND 1000)
);

ALTER TABLE "PackageEnrollment" ADD CONSTRAINT "PackageEnrollment_terms_check" CHECK (
  "sessionCount" BETWEEN 1 AND 1000
  AND "validityValue" BETWEEN 1 AND 3660
  AND (("usageLimitCount" IS NULL) = ("usageLimitPeriod" IS NULL))
  AND jsonb_typeof("packageSnapshot") = 'object'
);
-- Prices are never negative; the discount value fits its type.
ALTER TABLE "PackageEnrollment" ADD CONSTRAINT "PackageEnrollment_price_check" CHECK (
  "catalogPrice" >= 0
  AND "finalPrice" >= 0
  AND (("discountType" IN ('NONE', 'PRICE_OVERRIDE')) = ("discountValue" IS NULL))
  AND ("discountType" <> 'FIXED' OR ("discountValue" > 0 AND "discountValue" <= "catalogPrice"))
  AND ("discountType" <> 'PERCENTAGE' OR ("discountValue" > 0 AND "discountValue" <= 100))
  AND ("discountType" <> 'NONE' OR "finalPrice" = "catalogPrice")
);
-- Validity has both ends or neither; only a pending first-session enrollment has none.
ALTER TABLE "PackageEnrollment" ADD CONSTRAINT "PackageEnrollment_validity_check" CHECK (
  (("startDate" IS NULL) = ("endDate" IS NULL))
  AND ("endDate" IS NULL OR "endDate" >= "startDate")
  AND ("startDate" IS NOT NULL OR ("activationPolicy" = 'FIRST_SESSION' AND "state" <> 'ACTIVE'))
  AND (("state" = 'CANCELLED') = ("cancelledAt" IS NOT NULL))
  AND (("cancelledAt" IS NULL) = ("cancelledById" IS NULL))
);
-- The balance can never go below zero, and booked sessions never exceed what's left.
-- Checked on every counter change, so of two concurrent bookings for the last session
-- the second fails even if it slipped past the service's own check.
ALTER TABLE "PackageEnrollment" ADD CONSTRAINT "PackageEnrollment_balance_check" CHECK (
  "totalSessions" >= 0
  AND "consumedSessions" >= 0
  AND "reservedSessions" >= 0
  AND "consumedSessions" + "reservedSessions" <= "totalSessions"
);

-- Each movement type has its sign, and what it refers to.
ALTER TABLE "PackageSessionLedger" ADD CONSTRAINT "PackageSessionLedger_movement_check" CHECK (
  CASE "movement"
    WHEN 'INITIAL_ALLOCATION' THEN "quantity" > 0
    WHEN 'BONUS_CREDIT' THEN "quantity" > 0 AND "reason" IS NOT NULL
    WHEN 'MANUAL_CREDIT' THEN "quantity" > 0 AND "reason" IS NOT NULL
    WHEN 'MANUAL_DEBIT' THEN "quantity" < 0 AND "reason" IS NOT NULL
    WHEN 'SESSION_CONSUMPTION' THEN "quantity" = -1 AND "appointmentId" IS NOT NULL AND "chargeReason" IS NOT NULL
    WHEN 'CONSUMPTION_REVERSAL' THEN "quantity" = 1 AND "reversesId" IS NOT NULL AND "reason" IS NOT NULL
  END
  AND ("reversesId" IS NULL OR "movement" = 'CONSUMPTION_REVERSAL')
  AND ("chargeReason" IS NULL OR "movement" = 'SESSION_CONSUMPTION')
);

ALTER TABLE "PackageSessionReservation" ADD CONSTRAINT "PackageSessionReservation_check" CHECK (
  "quantity" = 1
  AND (("status" = 'RELEASED') = ("releasedAt" IS NOT NULL))
  AND (("releasedAt" IS NULL) = ("releaseReason" IS NULL))
  AND (("status" = 'CONSUMED') = ("consumedAt" IS NOT NULL))
);

-- The enrollment's counters follow the ledger: credits and manual debits change the
-- total, consumptions and reversals the consumed count.
CREATE FUNCTION "package_ledger_apply"() RETURNS trigger AS $$
BEGIN
  IF NEW."movement" IN ('SESSION_CONSUMPTION', 'CONSUMPTION_REVERSAL') THEN
    UPDATE "PackageEnrollment" SET "consumedSessions" = "consumedSessions" - NEW."quantity"
    WHERE "id" = NEW."enrollmentId";
  ELSE
    UPDATE "PackageEnrollment" SET "totalSessions" = "totalSessions" + NEW."quantity"
    WHERE "id" = NEW."enrollmentId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PackageSessionLedger_apply"
  AFTER INSERT ON "PackageSessionLedger"
  FOR EACH ROW EXECUTE FUNCTION "package_ledger_apply"();

CREATE FUNCTION "package_ledger_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Package ledger entries cannot be changed or deleted' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PackageSessionLedger_append_only"
  BEFORE UPDATE OR DELETE ON "PackageSessionLedger"
  FOR EACH ROW EXECUTE FUNCTION "package_ledger_append_only"();

-- Reservations start active and end once (released or consumed); only an active one's
-- session date may change (rescheduling). The reserved count follows them.
CREATE FUNCTION "package_reservation_apply"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Package reservations cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'ACTIVE' THEN
      RAISE EXCEPTION 'A package reservation starts active' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE "PackageEnrollment" SET "reservedSessions" = "reservedSessions" + NEW."quantity"
    WHERE "id" = NEW."enrollmentId";
    RETURN NEW;
  END IF;
  IF OLD."status" <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Released or consumed reservations cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."enrollmentId" <> OLD."enrollmentId" OR NEW."appointmentId" <> OLD."appointmentId"
     OR NEW."centerId" <> OLD."centerId" OR NEW."quantity" <> OLD."quantity" THEN
    RAISE EXCEPTION 'A reservation cannot move to another enrollment or appointment' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" <> 'ACTIVE' THEN
    UPDATE "PackageEnrollment" SET "reservedSessions" = "reservedSessions" - OLD."quantity"
    WHERE "id" = OLD."enrollmentId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PackageSessionReservation_insert"
  AFTER INSERT ON "PackageSessionReservation"
  FOR EACH ROW EXECUTE FUNCTION "package_reservation_apply"();

CREATE TRIGGER "PackageSessionReservation_guard"
  BEFORE UPDATE OR DELETE ON "PackageSessionReservation"
  FOR EACH ROW EXECUTE FUNCTION "package_reservation_apply"();

-- Enrollments are never deleted, their commercial terms never change, a cancelled one
-- stays cancelled, and validity is fixed once it has started.
CREATE FUNCTION "package_enrollment_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Package enrollments cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."centerId" <> OLD."centerId" OR NEW."patientId" <> OLD."patientId"
     OR NEW."packageId" <> OLD."packageId" OR NEW."code" <> OLD."code"
     OR NEW."packageName" <> OLD."packageName" OR NEW."packageCode" <> OLD."packageCode"
     OR NEW."packageSnapshot" IS DISTINCT FROM OLD."packageSnapshot"
     OR NEW."sessionCount" <> OLD."sessionCount"
     OR NEW."defaultDurationMinutes" IS DISTINCT FROM OLD."defaultDurationMinutes"
     OR NEW."validityValue" <> OLD."validityValue" OR NEW."validityUnit" <> OLD."validityUnit"
     OR NEW."activationPolicy" <> OLD."activationPolicy"
     OR NEW."usageLimitCount" IS DISTINCT FROM OLD."usageLimitCount"
     OR NEW."usageLimitPeriod" IS DISTINCT FROM OLD."usageLimitPeriod"
     OR NEW."coversAssessments" <> OLD."coversAssessments"
     OR NEW."chargeNoShow" <> OLD."chargeNoShow"
     OR NEW."chargeLateCancellation" <> OLD."chargeLateCancellation"
     OR NEW."currency" <> OLD."currency" OR NEW."catalogPrice" <> OLD."catalogPrice"
     OR NEW."discountType" <> OLD."discountType"
     OR NEW."discountValue" IS DISTINCT FROM OLD."discountValue"
     OR NEW."finalPrice" <> OLD."finalPrice"
     OR NEW."renewedFromId" IS DISTINCT FROM OLD."renewedFromId"
     OR NEW."createdById" <> OLD."createdById" OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'An enrollment''s patient, package and agreed terms cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."state" = 'CANCELLED' AND NEW."state" <> 'CANCELLED' THEN
    RAISE EXCEPTION 'A cancelled enrollment cannot be reopened' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."startDate" IS NOT NULL AND (NEW."startDate" IS DISTINCT FROM OLD."startDate"
     OR NEW."endDate" IS DISTINCT FROM OLD."endDate") THEN
    RAISE EXCEPTION 'An enrollment''s validity cannot change once set' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PackageEnrollment_guard"
  BEFORE UPDATE OR DELETE ON "PackageEnrollment"
  FOR EACH ROW EXECUTE FUNCTION "package_enrollment_guard"();
