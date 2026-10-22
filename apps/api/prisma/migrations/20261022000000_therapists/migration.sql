-- CreateEnum
CREATE TYPE "TherapistStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'VISITING', 'CONTRACTUAL');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "TimeOffReason" AS ENUM ('PERSONAL', 'SICK', 'TRAINING', 'VACATION', 'EMERGENCY', 'SCHEDULE_CHANGE', 'OTHER');

-- CreateTable
CREATE TABLE "Therapist" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "email" TEXT,
    "gender" "Gender",
    "photoUrl" TEXT,
    "designation" TEXT,
    "qualifications" TEXT,
    "registrationNumber" TEXT,
    "yearsOfExperience" INTEGER,
    "joiningDate" DATE,
    "employmentType" "EmploymentType",
    "notes" TEXT,
    "status" "TherapistStatus" NOT NULL DEFAULT 'ACTIVE',
    "membershipId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Therapist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TherapistSpecialization" (
    "id" UUID NOT NULL,
    "therapistId" UUID NOT NULL,
    "therapyTypeId" UUID NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TherapistSpecialization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TherapistAvailability" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "therapistId" UUID NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TherapistAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TherapistTimeOff" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "therapistId" UUID NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "isAllDay" BOOLEAN NOT NULL DEFAULT false,
    "reason" "TimeOffReason",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TherapistTimeOff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Therapist_membershipId_key" ON "Therapist"("membershipId");

-- CreateIndex
CREATE INDEX "Therapist_centerId_deletedAt_status_idx" ON "Therapist"("centerId", "deletedAt", "status");

-- CreateIndex
CREATE INDEX "Therapist_centerId_fullName_idx" ON "Therapist"("centerId", "fullName");

-- CreateIndex
CREATE UNIQUE INDEX "Therapist_centerId_code_key" ON "Therapist"("centerId", "code");

-- CreateIndex
CREATE INDEX "TherapistSpecialization_therapyTypeId_idx" ON "TherapistSpecialization"("therapyTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "TherapistSpecialization_therapistId_therapyTypeId_key" ON "TherapistSpecialization"("therapistId", "therapyTypeId");

-- CreateIndex
CREATE INDEX "TherapistAvailability_centerId_dayOfWeek_idx" ON "TherapistAvailability"("centerId", "dayOfWeek");

-- CreateIndex
CREATE UNIQUE INDEX "TherapistAvailability_therapistId_dayOfWeek_startMinutes_key" ON "TherapistAvailability"("therapistId", "dayOfWeek", "startMinutes");

-- CreateIndex
CREATE INDEX "TherapistTimeOff_therapistId_endAt_idx" ON "TherapistTimeOff"("therapistId", "endAt");

-- CreateIndex
CREATE INDEX "TherapistTimeOff_centerId_startAt_idx" ON "TherapistTimeOff"("centerId", "startAt");

-- AddForeignKey
ALTER TABLE "Therapist" ADD CONSTRAINT "Therapist_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Therapist" ADD CONSTRAINT "Therapist_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "CenterMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapistSpecialization" ADD CONSTRAINT "TherapistSpecialization_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "Therapist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapistSpecialization" ADD CONSTRAINT "TherapistSpecialization_therapyTypeId_fkey" FOREIGN KEY ("therapyTypeId") REFERENCES "TherapyType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapistAvailability" ADD CONSTRAINT "TherapistAvailability_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapistAvailability" ADD CONSTRAINT "TherapistAvailability_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "Therapist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapistTimeOff" ADD CONSTRAINT "TherapistTimeOff_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapistTimeOff" ADD CONSTRAINT "TherapistTimeOff_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "Therapist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Sanity checks. The API enforces the real rules (see src/therapists); these only stop
-- impossible values.

-- AddCheckConstraint
ALTER TABLE "Therapist" ADD CONSTRAINT "Therapist_yearsOfExperience_check" CHECK ("yearsOfExperience" IS NULL OR "yearsOfExperience" BETWEEN 0 AND 80);

-- AddCheckConstraint
ALTER TABLE "TherapistAvailability" ADD CONSTRAINT "TherapistAvailability_interval_check" CHECK ("dayOfWeek" BETWEEN 0 AND 6 AND "startMinutes" >= 0 AND "startMinutes" < "endMinutes" AND "endMinutes" <= 1440);

-- AddCheckConstraint
ALTER TABLE "TherapistTimeOff" ADD CONSTRAINT "TherapistTimeOff_range_check" CHECK ("startAt" < "endAt");
