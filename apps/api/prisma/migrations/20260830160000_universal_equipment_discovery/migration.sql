CREATE TYPE "EquipmentDiscoveryStatus" AS ENUM (
  'DISCOVERED',
  'CONFIGURING',
  'COMPLETED',
  'IGNORED',
  'FAILED',
  'EXPIRED'
);

CREATE TABLE "DeviceEntity" (
  "id" TEXT NOT NULL,
  "homeId" TEXT NOT NULL,
  "deviceId" TEXT,
  "entityId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "deviceClass" TEXT,
  "integration" TEXT,
  "protocol" TEXT,
  "available" BOOLEAN NOT NULL DEFAULT true,
  "state" JSONB,
  "actions" JSONB NOT NULL,
  "lastSeenAt" TIMESTAMP(3),
  "removedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeviceEntity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EquipmentDiscovery" (
  "id" TEXT NOT NULL,
  "homeId" TEXT NOT NULL,
  "discoveryKey" TEXT NOT NULL,
  "flowId" TEXT,
  "handler" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" "EquipmentDiscoveryStatus" NOT NULL DEFAULT 'DISCOVERED',
  "step" JSONB,
  "lastError" TEXT,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EquipmentDiscovery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeviceEntity_homeId_entityId_key" ON "DeviceEntity"("homeId", "entityId");
CREATE INDEX "DeviceEntity_deviceId_idx" ON "DeviceEntity"("deviceId");
CREATE UNIQUE INDEX "EquipmentDiscovery_homeId_discoveryKey_key" ON "EquipmentDiscovery"("homeId", "discoveryKey");
CREATE INDEX "EquipmentDiscovery_homeId_status_idx" ON "EquipmentDiscovery"("homeId", "status");

ALTER TABLE "DeviceEntity" ADD CONSTRAINT "DeviceEntity_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeviceEntity" ADD CONSTRAINT "DeviceEntity_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EquipmentDiscovery" ADD CONSTRAINT "EquipmentDiscovery_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;
