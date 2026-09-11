CREATE TYPE "SensorInstallationStatus" AS ENUM ('DETECTED', 'NEEDS_CONFIRMATION', 'NEEDS_PLACEMENT', 'NEEDS_TEST', 'OPERATIONAL', 'ATTENTION', 'DISABLED');
CREATE TYPE "SensorClassificationSource" AS ENUM ('METADATA', 'MODEL_PROFILE', 'USER');
CREATE TYPE "SensorSessionStatus" AS ENUM ('PENDING', 'WAITING_FOR_DEVICE', 'DEVICE_FOUND', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED');

ALTER TABLE "Device"
  ADD COLUMN "displayName" TEXT,
  ADD COLUMN "protocol" TEXT,
  ADD COLUMN "integration" TEXT,
  ADD COLUMN "installationStatus" "SensorInstallationStatus" NOT NULL DEFAULT 'DETECTED',
  ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "placementConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "placementNote" TEXT;

ALTER TABLE "Sensor"
  ADD COLUMN "analysisEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "classificationSource" "SensorClassificationSource" NOT NULL DEFAULT 'METADATA',
  ADD COLUMN "classificationConfidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
  ADD COLUMN "classificationReason" TEXT,
  ADD COLUMN "classificationConfirmedAt" TIMESTAMP(3);

UPDATE "Device" d
SET "roomId" = grouped."roomId",
    "installationStatus" = CASE
      WHEN grouped."roomId" IS NULL THEN 'NEEDS_PLACEMENT'::"SensorInstallationStatus"
      ELSE 'NEEDS_TEST'::"SensorInstallationStatus"
    END
FROM (
  SELECT "deviceId", MIN("roomId") AS "roomId"
  FROM "Sensor"
  WHERE "deviceId" IS NOT NULL
  GROUP BY "deviceId"
) grouped
WHERE d.id = grouped."deviceId";

UPDATE "Sensor"
SET "analysisEnabled" = false,
    "classificationConfidence" = 0,
    "classificationReason" = 'Métadonnées insuffisantes'
WHERE "compatibility" = 'UNSUPPORTED';

CREATE TABLE "SensorOnboardingSession" (
  "id" TEXT NOT NULL,
  "homeId" TEXT NOT NULL,
  "deviceId" TEXT,
  "requestedById" TEXT NOT NULL,
  "protocol" TEXT NOT NULL,
  "status" "SensorSessionStatus" NOT NULL DEFAULT 'PENDING',
  "step" TEXT NOT NULL DEFAULT 'PREPARE',
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SensorOnboardingSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SensorVerificationSession" (
  "id" TEXT NOT NULL,
  "homeId" TEXT NOT NULL,
  "deviceId" TEXT,
  "sensorId" TEXT,
  "requestedById" TEXT NOT NULL,
  "status" "SensorSessionStatus" NOT NULL DEFAULT 'PENDING',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "observedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SensorVerificationSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SensorOnboardingSession_homeId_status_idx" ON "SensorOnboardingSession"("homeId", "status");
CREATE INDEX "SensorOnboardingSession_expiresAt_idx" ON "SensorOnboardingSession"("expiresAt");
CREATE INDEX "SensorVerificationSession_homeId_status_idx" ON "SensorVerificationSession"("homeId", "status");
CREATE INDEX "SensorVerificationSession_expiresAt_idx" ON "SensorVerificationSession"("expiresAt");

ALTER TABLE "SensorOnboardingSession" ADD CONSTRAINT "SensorOnboardingSession_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SensorOnboardingSession" ADD CONSTRAINT "SensorOnboardingSession_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SensorVerificationSession" ADD CONSTRAINT "SensorVerificationSession_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SensorVerificationSession" ADD CONSTRAINT "SensorVerificationSession_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SensorVerificationSession" ADD CONSTRAINT "SensorVerificationSession_sensorId_fkey" FOREIGN KEY ("sensorId") REFERENCES "Sensor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TRIGGER device_realtime AFTER INSERT OR UPDATE OR DELETE ON "Device"
FOR EACH ROW EXECUTE FUNCTION michel_notify_update();
CREATE TRIGGER sensor_onboarding_realtime AFTER INSERT OR UPDATE OR DELETE ON "SensorOnboardingSession"
FOR EACH ROW EXECUTE FUNCTION michel_notify_update();
CREATE TRIGGER sensor_verification_realtime AFTER INSERT OR UPDATE OR DELETE ON "SensorVerificationSession"
FOR EACH ROW EXECUTE FUNCTION michel_notify_update();
