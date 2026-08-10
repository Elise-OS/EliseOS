ALTER TYPE "AlertType" ADD VALUE IF NOT EXISTS 'TEMPERATURE';
ALTER TYPE "AlertType" ADD VALUE IF NOT EXISTS 'SENSOR_OFFLINE';
ALTER TYPE "AlertType" ADD VALUE IF NOT EXISTS 'LOW_BATTERY';
ALTER TYPE "AlertType" ADD VALUE IF NOT EXISTS 'MEDICATION_MISSED';

CREATE TYPE "MedicationDoseStatus" AS ENUM ('PENDING', 'TAKEN', 'MISSED', 'SKIPPED');

ALTER TABLE "Alert" ADD COLUMN "ruleKey" TEXT;
CREATE INDEX "Alert_homeId_ruleKey_status_idx" ON "Alert"("homeId", "ruleKey", "status");

CREATE TABLE "Medication" (
  "id" TEXT NOT NULL,
  "homeId" TEXT NOT NULL,
  "residentId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "dosage" TEXT NOT NULL,
  "instructions" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "startsOn" TIMESTAMP(3),
  "endsOn" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Medication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MedicationSchedule" (
  "id" TEXT NOT NULL,
  "medicationId" TEXT NOT NULL,
  "minuteOfDay" INTEGER NOT NULL,
  "daysOfWeek" INTEGER[],
  "graceMinutes" INTEGER NOT NULL DEFAULT 60,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MedicationSchedule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MedicationDose" (
  "id" TEXT NOT NULL,
  "scheduleId" TEXT NOT NULL,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "status" "MedicationDoseStatus" NOT NULL DEFAULT 'PENDING',
  "confirmedAt" TIMESTAMP(3),
  "confirmedById" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MedicationDose_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Medication_homeId_active_idx" ON "Medication"("homeId", "active");
CREATE INDEX "Medication_residentId_idx" ON "Medication"("residentId");
CREATE INDEX "MedicationSchedule_medicationId_active_idx" ON "MedicationSchedule"("medicationId", "active");
CREATE UNIQUE INDEX "MedicationDose_scheduleId_scheduledFor_key" ON "MedicationDose"("scheduleId", "scheduledFor");
CREATE INDEX "MedicationDose_scheduledFor_status_idx" ON "MedicationDose"("scheduledFor", "status");

ALTER TABLE "Medication" ADD CONSTRAINT "Medication_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Medication" ADD CONSTRAINT "Medication_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MedicationSchedule" ADD CONSTRAINT "MedicationSchedule_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "Medication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MedicationDose" ADD CONSTRAINT "MedicationDose_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "MedicationSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MedicationDose" ADD CONSTRAINT "MedicationDose_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
