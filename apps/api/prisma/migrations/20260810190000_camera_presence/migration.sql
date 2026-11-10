CREATE TYPE "CameraStatus" AS ENUM ('ONLINE', 'DEGRADED', 'OFFLINE', 'UNKNOWN');
CREATE TYPE "CameraCompatibility" AS ENUM ('VALIDATED', 'RECOGNIZED', 'PARTIAL', 'UNSUPPORTED');

ALTER TABLE "Alert" ADD COLUMN "roomId" TEXT;

CREATE TABLE "Camera" (
  "id" TEXT NOT NULL,
  "homeId" TEXT NOT NULL,
  "roomId" TEXT,
  "deviceId" TEXT,
  "name" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'onvif',
  "streamKey" TEXT NOT NULL,
  "streamEntityId" TEXT NOT NULL,
  "personEntityId" TEXT,
  "privacyEntityId" TEXT,
  "streamUrlEncrypted" TEXT NOT NULL,
  "status" "CameraStatus" NOT NULL DEFAULT 'UNKNOWN',
  "compatibility" "CameraCompatibility" NOT NULL DEFAULT 'RECOGNIZED',
  "liveEnabled" BOOLEAN NOT NULL DEFAULT true,
  "talkEnabled" BOOLEAN NOT NULL DEFAULT false,
  "ptzEnabled" BOOLEAN NOT NULL DEFAULT false,
  "privacySupported" BOOLEAN NOT NULL DEFAULT false,
  "snapshotEnabled" BOOLEAN NOT NULL DEFAULT true,
  "privacyMode" BOOLEAN NOT NULL DEFAULT false,
  "consentedAt" TIMESTAMP(3),
  "consentedById" TEXT,
  "lastSeenAt" TIMESTAMP(3),
  "lastPersonSeenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Camera_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CameraSnapshot" (
  "id" TEXT NOT NULL,
  "homeId" TEXT NOT NULL,
  "cameraId" TEXT NOT NULL,
  "alertId" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL DEFAULT 'image/jpeg',
  "sizeBytes" INTEGER NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CameraSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Camera_streamKey_key" ON "Camera"("streamKey");
CREATE UNIQUE INDEX "Camera_homeId_streamEntityId_key" ON "Camera"("homeId", "streamEntityId");
CREATE INDEX "Camera_homeId_roomId_idx" ON "Camera"("homeId", "roomId");
CREATE INDEX "Camera_homeId_personEntityId_idx" ON "Camera"("homeId", "personEntityId");
CREATE UNIQUE INDEX "CameraSnapshot_alertId_cameraId_key" ON "CameraSnapshot"("alertId", "cameraId");
CREATE INDEX "CameraSnapshot_expiresAt_idx" ON "CameraSnapshot"("expiresAt");

ALTER TABLE "Alert" ADD CONSTRAINT "Alert_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Camera" ADD CONSTRAINT "Camera_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Camera" ADD CONSTRAINT "Camera_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Camera" ADD CONSTRAINT "Camera_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CameraSnapshot" ADD CONSTRAINT "CameraSnapshot_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CameraSnapshot" ADD CONSTRAINT "CameraSnapshot_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CameraSnapshot" ADD CONSTRAINT "CameraSnapshot_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
