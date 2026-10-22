-- Overlap protection below needs btree_gist (a trusted extension: database owners can
-- create it without superuser rights).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
CREATE TYPE "AppointmentType" AS ENUM ('ASSESSMENT', 'THERAPY_SESSION');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "CancellationReason" AS ENUM ('PATIENT_REQUEST', 'THERAPIST_UNAVAILABLE', 'CENTER_CLOSURE', 'PERSONAL_REASON', 'OTHER');

-- CreateEnum
CREATE TYPE "AppointmentSeriesStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AppointmentHistoryAction" AS ENUM ('CREATED', 'UPDATED', 'RESCHEDULED', 'STATUS_CHANGED', 'CANCELLED');

-- CreateTable
CREATE TABLE "AppointmentSeries" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "therapistId" UUID NOT NULL,
    "therapyTypeId" UUID NOT NULL,
    "type" "AppointmentType" NOT NULL,
    "recurrenceRule" JSONB NOT NULL,
    "timezone" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "status" "AppointmentSeriesStatus" NOT NULL DEFAULT 'ACTIVE',
    "skippedOccurrences" JSONB,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppointmentSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "seriesId" UUID,
    "patientId" UUID NOT NULL,
    "therapistId" UUID NOT NULL,
    "therapyTypeId" UUID NOT NULL,
    "type" "AppointmentType" NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "bufferMinutes" INTEGER NOT NULL DEFAULT 0,
    "allowOverlap" BOOLEAN NOT NULL DEFAULT false,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "internalNotes" TEXT,
    "createdById" UUID NOT NULL,
    "updatedById" UUID,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancellationReason" "CancellationReason",
    "cancellationNote" TEXT,
    "lateCancellation" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentHistory" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "appointmentId" UUID NOT NULL,
    "action" "AppointmentHistoryAction" NOT NULL,
    "previousValues" JSONB,
    "newValues" JSONB,
    "reason" TEXT,
    "performedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppointmentSeries_centerId_patientId_idx" ON "AppointmentSeries"("centerId", "patientId");

-- CreateIndex
CREATE INDEX "AppointmentSeries_therapistId_idx" ON "AppointmentSeries"("therapistId");

-- CreateIndex
CREATE INDEX "Appointment_centerId_startAt_idx" ON "Appointment"("centerId", "startAt");

-- CreateIndex
CREATE INDEX "Appointment_centerId_status_startAt_idx" ON "Appointment"("centerId", "status", "startAt");

-- CreateIndex
CREATE INDEX "Appointment_therapistId_startAt_idx" ON "Appointment"("therapistId", "startAt");

-- CreateIndex
CREATE INDEX "Appointment_patientId_startAt_idx" ON "Appointment"("patientId", "startAt");

-- CreateIndex
CREATE INDEX "Appointment_seriesId_startAt_idx" ON "Appointment"("seriesId", "startAt");

-- CreateIndex
CREATE INDEX "AppointmentHistory_appointmentId_createdAt_idx" ON "AppointmentHistory"("appointmentId", "createdAt");

-- AddForeignKey
ALTER TABLE "AppointmentSeries" ADD CONSTRAINT "AppointmentSeries_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentSeries" ADD CONSTRAINT "AppointmentSeries_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentSeries" ADD CONSTRAINT "AppointmentSeries_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "Therapist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentSeries" ADD CONSTRAINT "AppointmentSeries_therapyTypeId_fkey" FOREIGN KEY ("therapyTypeId") REFERENCES "TherapyType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentSeries" ADD CONSTRAINT "AppointmentSeries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "AppointmentSeries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "Therapist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_therapyTypeId_fkey" FOREIGN KEY ("therapyTypeId") REFERENCES "TherapyType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentHistory" ADD CONSTRAINT "AppointmentHistory_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentHistory" ADD CONSTRAINT "AppointmentHistory_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentHistory" ADD CONSTRAINT "AppointmentHistory_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Integrity checks Prisma can't express.
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_period_check" CHECK (
  "durationMinutes" > 0 AND "durationMinutes" <= 1440
  AND "endAt" = "startAt" + "durationMinutes" * interval '1 minute'
  AND "bufferMinutes" >= 0
);
-- Cancellation details exist exactly when the appointment is cancelled.
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_cancellation_check" CHECK (
  ("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL AND "cancellationReason" IS NOT NULL)
);
ALTER TABLE "AppointmentSeries" ADD CONSTRAINT "AppointmentSeries_dates_check" CHECK ("startsOn" <= "endsOn" AND "durationMinutes" > 0);

-- Double-booking protection, enforced by the database so concurrent requests can't both
-- win. Timestamps are UTC "timestamp without time zone", which keeps the range
-- expressions immutable as index expressions require. A therapist's live bookings may
-- not overlap, each including the buffer kept free after it; a patient's may not overlap
-- either. Cancelled and no-show rows release their time. Rows booked over a clash on
-- purpose (allowOverlap, only when the center allows double booking) are exempt.
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_therapist_overlap"
  EXCLUDE USING gist (
    "therapistId" WITH =,
    tsrange("startAt", "endAt" + "bufferMinutes" * interval '1 minute') WITH &&
  ) WHERE ("status" IN ('SCHEDULED', 'CONFIRMED', 'COMPLETED') AND NOT "allowOverlap");

ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patient_overlap"
  EXCLUDE USING gist (
    "patientId" WITH =,
    tsrange("startAt", "endAt") WITH &&
  ) WHERE ("status" IN ('SCHEDULED', 'CONFIRMED', 'COMPLETED') AND NOT "allowOverlap");
