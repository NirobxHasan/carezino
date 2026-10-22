
-- CreateEnum
CREATE TYPE "GuardianContactType" AS ENUM ('GUARDIAN', 'CAREGIVER');

-- CreateEnum
CREATE TYPE "GuardianRelationship" AS ENUM ('FATHER', 'MOTHER', 'LEGAL_GUARDIAN', 'GRANDPARENT', 'SIBLING', 'SPOUSE', 'OTHER');

-- CreateEnum
CREATE TYPE "ReferralSource" AS ENUM ('DOCTOR', 'SCHOOL', 'FRIEND_FAMILY', 'SOCIAL_MEDIA', 'EXISTING_PATIENT', 'WALK_IN', 'OTHER');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('TREATMENT', 'DATA_PROCESSING', 'MEDIA');

-- CreateEnum
CREATE TYPE "ConsentGivenBy" AS ENUM ('SELF', 'GUARDIAN');

-- AlterEnum
ALTER TYPE "Gender" ADD VALUE 'PREFER_NOT_TO_SAY';

-- AlterEnum
-- Patient statuses become NEW / ACTIVE / INACTIVE. Only the "new patients start as"
-- setting used the old values: centers that chose ACTIVE keep it, the rest start at NEW.
CREATE TYPE "PatientStatus_new" AS ENUM ('NEW', 'ACTIVE', 'INACTIVE');
ALTER TABLE "CenterGeneralSettings" ALTER COLUMN "defaultPatientStatus" DROP DEFAULT;
ALTER TABLE "CenterGeneralSettings" ALTER COLUMN "defaultPatientStatus" TYPE "PatientStatus_new"
  USING (CASE WHEN "defaultPatientStatus"::text = 'ACTIVE' THEN 'ACTIVE' ELSE 'NEW' END)::"PatientStatus_new";
DROP TYPE "PatientStatus";
ALTER TYPE "PatientStatus_new" RENAME TO "PatientStatus";
ALTER TABLE "CenterGeneralSettings" ALTER COLUMN "defaultPatientStatus" SET DEFAULT 'NEW';

-- CreateTable
CREATE TABLE "CenterSequence" (
    "centerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CenterSequence_pkey" PRIMARY KEY ("centerId","name")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "dateOfBirth" DATE,
    "approxAgeMonths" INTEGER,
    "approxAgeAsOf" DATE,
    "gender" "Gender",
    "photoUrl" TEXT,
    "primaryConcern" TEXT,
    "mobile" TEXT,
    "secondaryMobile" TEXT,
    "email" TEXT,
    "address" TEXT,
    "emergencyPhone" TEXT,
    "primaryContactIsSelf" BOOLEAN NOT NULL DEFAULT false,
    "status" "PatientStatus" NOT NULL DEFAULT 'NEW',
    "referralSource" "ReferralSource",
    "referralOther" TEXT,
    "internalNotes" TEXT,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registeredById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guardian" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "secondaryMobile" TEXT,
    "email" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guardian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientGuardian" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "guardianId" UUID NOT NULL,
    "contactType" "GuardianContactType" NOT NULL DEFAULT 'GUARDIAN',
    "relationship" "GuardianRelationship" NOT NULL,
    "customRelationship" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isEmergencyContact" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientGuardian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientTherapyInterest" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "therapyTypeId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientTherapyInterest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientConsent" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "version" TEXT,
    "granted" BOOLEAN NOT NULL,
    "givenBy" "ConsentGivenBy" NOT NULL,
    "guardianId" UUID,
    "givenByName" TEXT NOT NULL,
    "note" TEXT,
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Patient_centerId_deletedAt_status_idx" ON "Patient"("centerId", "deletedAt", "status");

-- CreateIndex
CREATE INDEX "Patient_centerId_registeredAt_idx" ON "Patient"("centerId", "registeredAt");

-- CreateIndex
CREATE INDEX "Patient_centerId_fullName_idx" ON "Patient"("centerId", "fullName");

-- CreateIndex
CREATE INDEX "Patient_centerId_mobile_idx" ON "Patient"("centerId", "mobile");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_centerId_code_key" ON "Patient"("centerId", "code");

-- CreateIndex
CREATE INDEX "Guardian_centerId_mobile_idx" ON "Guardian"("centerId", "mobile");

-- CreateIndex
CREATE INDEX "Guardian_centerId_secondaryMobile_idx" ON "Guardian"("centerId", "secondaryMobile");

-- CreateIndex
CREATE INDEX "Guardian_centerId_fullName_idx" ON "Guardian"("centerId", "fullName");

-- CreateIndex
CREATE INDEX "PatientGuardian_guardianId_idx" ON "PatientGuardian"("guardianId");

-- CreateIndex
CREATE UNIQUE INDEX "PatientGuardian_patientId_guardianId_key" ON "PatientGuardian"("patientId", "guardianId");

-- CreateIndex
CREATE INDEX "PatientTherapyInterest_therapyTypeId_idx" ON "PatientTherapyInterest"("therapyTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "PatientTherapyInterest_patientId_therapyTypeId_key" ON "PatientTherapyInterest"("patientId", "therapyTypeId");

-- CreateIndex
CREATE INDEX "PatientConsent_patientId_purpose_recordedAt_idx" ON "PatientConsent"("patientId", "purpose", "recordedAt");

-- AddForeignKey
ALTER TABLE "CenterSequence" ADD CONSTRAINT "CenterSequence_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guardian" ADD CONSTRAINT "Guardian_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientGuardian" ADD CONSTRAINT "PatientGuardian_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientGuardian" ADD CONSTRAINT "PatientGuardian_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientTherapyInterest" ADD CONSTRAINT "PatientTherapyInterest_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientTherapyInterest" ADD CONSTRAINT "PatientTherapyInterest_therapyTypeId_fkey" FOREIGN KEY ("therapyTypeId") REFERENCES "TherapyType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientConsent" ADD CONSTRAINT "PatientConsent_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientConsent" ADD CONSTRAINT "PatientConsent_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientConsent" ADD CONSTRAINT "PatientConsent_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientConsent" ADD CONSTRAINT "PatientConsent_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Sanity checks. The API enforces the real rules (see src/patients); these only stop
-- impossible values.

-- AddCheckConstraint
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_age_check" CHECK (
  ("approxAgeMonths" IS NULL AND "approxAgeAsOf" IS NULL)
  OR ("approxAgeMonths" BETWEEN 0 AND 1800 AND "approxAgeAsOf" IS NOT NULL AND "dateOfBirth" IS NULL)
);

-- AddCheckConstraint
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_self_contact_check" CHECK (NOT "primaryContactIsSelf" OR "mobile" IS NOT NULL);

-- AddCheckConstraint
ALTER TABLE "CenterSequence" ADD CONSTRAINT "CenterSequence_lastValue_check" CHECK ("lastValue" >= 0);

-- AddCheckConstraint
ALTER TABLE "PatientConsent" ADD CONSTRAINT "PatientConsent_given_by_check" CHECK (("givenBy" = 'GUARDIAN') = ("guardianId" IS NOT NULL));
