-- CreateEnum
CREATE TYPE "DefaultDurationBehavior" AS ENUM ('THERAPY_TYPE_DEFAULT', 'PREVIOUS_SESSION', 'ASK_EACH_TIME');

-- CreateEnum
CREATE TYPE "PatientStatus" AS ENUM ('ACTIVE', 'WAITLIST', 'ON_HOLD', 'DISCHARGED');

-- CreateEnum
CREATE TYPE "DateDisplayFormat" AS ENUM ('D_MMM_YYYY', 'DD_MM_YYYY', 'MM_DD_YYYY', 'YYYY_MM_DD');

-- CreateEnum
CREATE TYPE "TimeDisplayFormat" AS ENUM ('H12', 'H24');

-- CreateTable
CREATE TABLE "TherapyType" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "defaultDurationMinutes" INTEGER NOT NULL,
    "color" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TherapyType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TherapyDurationOption" (
    "id" UUID NOT NULL,
    "therapyTypeId" UUID NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TherapyDurationOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CenterWorkingHour" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CenterWorkingHour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CenterClosure" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reason" TEXT,
    "allDay" BOOLEAN NOT NULL DEFAULT true,
    "startMinutes" INTEGER,
    "endMinutes" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CenterClosure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CenterSchedulingSettings" (
    "centerId" UUID NOT NULL,
    "slotIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "bookingBufferMinutes" INTEGER NOT NULL DEFAULT 0,
    "allowCustomDuration" BOOLEAN NOT NULL DEFAULT false,
    "allowBookingOnClosedDays" BOOLEAN NOT NULL DEFAULT false,
    "advanceBookingLimitDays" INTEGER NOT NULL DEFAULT 60,
    "minimumBookingNoticeMinutes" INTEGER NOT NULL DEFAULT 0,
    "allowDoubleBooking" BOOLEAN NOT NULL DEFAULT false,
    "allowPastDateBooking" BOOLEAN NOT NULL DEFAULT false,
    "cancellationCutoffMinutes" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CenterSchedulingSettings_pkey" PRIMARY KEY ("centerId")
);

-- CreateTable
CREATE TABLE "CenterGeneralSettings" (
    "centerId" UUID NOT NULL,
    "defaultDurationBehavior" "DefaultDurationBehavior" NOT NULL DEFAULT 'THERAPY_TYPE_DEFAULT',
    "autoGeneratePatientCode" BOOLEAN NOT NULL DEFAULT true,
    "patientCodePrefix" TEXT,
    "defaultPatientStatus" "PatientStatus" NOT NULL DEFAULT 'ACTIVE',
    "dateFormat" "DateDisplayFormat" NOT NULL DEFAULT 'D_MMM_YYYY',
    "timeFormat" "TimeDisplayFormat" NOT NULL DEFAULT 'H12',
    "weekStartsOn" INTEGER NOT NULL DEFAULT 6,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CenterGeneralSettings_pkey" PRIMARY KEY ("centerId")
);

-- CreateIndex
CREATE INDEX "TherapyType_centerId_isActive_displayOrder_idx" ON "TherapyType"("centerId", "isActive", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TherapyType_centerId_code_key" ON "TherapyType"("centerId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "TherapyType_centerId_name_key" ON "TherapyType"("centerId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TherapyDurationOption_therapyTypeId_durationMinutes_key" ON "TherapyDurationOption"("therapyTypeId", "durationMinutes");

-- CreateIndex
CREATE UNIQUE INDEX "CenterWorkingHour_centerId_dayOfWeek_startMinutes_key" ON "CenterWorkingHour"("centerId", "dayOfWeek", "startMinutes");

-- CreateIndex
CREATE INDEX "CenterClosure_centerId_endDate_idx" ON "CenterClosure"("centerId", "endDate");

-- AddForeignKey
ALTER TABLE "TherapyType" ADD CONSTRAINT "TherapyType_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyDurationOption" ADD CONSTRAINT "TherapyDurationOption_therapyTypeId_fkey" FOREIGN KEY ("therapyTypeId") REFERENCES "TherapyType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CenterWorkingHour" ADD CONSTRAINT "CenterWorkingHour_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CenterClosure" ADD CONSTRAINT "CenterClosure_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CenterSchedulingSettings" ADD CONSTRAINT "CenterSchedulingSettings_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CenterGeneralSettings" ADD CONSTRAINT "CenterGeneralSettings_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Sanity checks. The API enforces tighter, configurable limits (see
-- src/center-settings/limits.ts); these only stop impossible values.

-- AddCheckConstraint
ALTER TABLE "TherapyType" ADD CONSTRAINT "TherapyType_defaultDurationMinutes_check" CHECK ("defaultDurationMinutes" > 0 AND "defaultDurationMinutes" <= 1440);

-- AddCheckConstraint
ALTER TABLE "TherapyDurationOption" ADD CONSTRAINT "TherapyDurationOption_durationMinutes_check" CHECK ("durationMinutes" > 0 AND "durationMinutes" <= 1440);

-- AddCheckConstraint
ALTER TABLE "CenterWorkingHour" ADD CONSTRAINT "CenterWorkingHour_interval_check" CHECK ("dayOfWeek" BETWEEN 0 AND 6 AND "startMinutes" >= 0 AND "startMinutes" < "endMinutes" AND "endMinutes" <= 1440);

-- AddCheckConstraint
ALTER TABLE "CenterClosure" ADD CONSTRAINT "CenterClosure_dates_check" CHECK ("startDate" <= "endDate");

-- AddCheckConstraint
ALTER TABLE "CenterClosure" ADD CONSTRAINT "CenterClosure_times_check" CHECK (
  ("allDay" AND "startMinutes" IS NULL AND "endMinutes" IS NULL)
  OR (NOT "allDay" AND "startDate" = "endDate" AND "startMinutes" >= 0 AND "startMinutes" < "endMinutes" AND "endMinutes" <= 1440)
);

-- AddCheckConstraint
ALTER TABLE "CenterSchedulingSettings" ADD CONSTRAINT "CenterSchedulingSettings_values_check" CHECK (
  "slotIntervalMinutes" > 0 AND "bookingBufferMinutes" >= 0 AND "advanceBookingLimitDays" > 0
  AND "minimumBookingNoticeMinutes" >= 0 AND "cancellationCutoffMinutes" >= 0
);

-- AddCheckConstraint
ALTER TABLE "CenterGeneralSettings" ADD CONSTRAINT "CenterGeneralSettings_weekStartsOn_check" CHECK ("weekStartsOn" BETWEEN 0 AND 6);
