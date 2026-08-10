CREATE TYPE "SensorCompatibility" AS ENUM ('VALIDATED', 'RECOGNIZED', 'PARTIAL', 'UNSUPPORTED');
CREATE TYPE "SensorMappingTransform" AS ENUM ('ON_OFF', 'OPEN_CLOSED', 'NUMERIC', 'EVENT_ACTION');
CREATE TYPE "PushPlatform" AS ENUM ('IOS', 'ANDROID');

ALTER TABLE "Sensor"
  ALTER COLUMN "compatibility" DROP DEFAULT,
  ALTER COLUMN "compatibility" TYPE "SensorCompatibility"
    USING (CASE
      WHEN "compatibility" IN ('VALIDATED', 'RECOGNIZED', 'PARTIAL', 'UNSUPPORTED')
        THEN "compatibility"::"SensorCompatibility"
      ELSE 'UNSUPPORTED'::"SensorCompatibility"
    END),
  ALTER COLUMN "compatibility" SET DEFAULT 'RECOGNIZED',
  ADD COLUMN "sourceName" TEXT,
  ADD COLUMN "domain" TEXT,
  ADD COLUMN "deviceClass" TEXT,
  ADD COLUMN "unit" TEXT,
  ADD COLUMN "available" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "removedAt" TIMESTAMP(3);

CREATE TABLE "SensorMapping" (
  "id" TEXT NOT NULL,
  "sensorId" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "transform" "SensorMappingTransform" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SensorMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SensorMapping_sensorId_key" ON "SensorMapping"("sensorId");
ALTER TABLE "SensorMapping" ADD CONSTRAINT "SensorMapping_sensorId_fkey"
  FOREIGN KEY ("sensorId") REFERENCES "Sensor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EquipmentSyncState" (
  "id" TEXT NOT NULL,
  "homeId" TEXT NOT NULL,
  "bridgeConnected" BOOLEAN NOT NULL DEFAULT false,
  "homeAssistantSeenAt" TIMESTAMP(3),
  "inventorySeenAt" TIMESTAMP(3),
  "lastSyncRequestedAt" TIMESTAMP(3),
  "entityCount" INTEGER NOT NULL DEFAULT 0,
  "deviceCount" INTEGER NOT NULL DEFAULT 0,
  "pairingActive" BOOLEAN NOT NULL DEFAULT false,
  "pairingExpiresAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EquipmentSyncState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EquipmentSyncState_homeId_key" ON "EquipmentSyncState"("homeId");
ALTER TABLE "EquipmentSyncState" ADD CONSTRAINT "EquipmentSyncState_homeId_fkey"
  FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PushSubscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expoPushToken" TEXT NOT NULL,
  "platform" "PushPlatform" NOT NULL,
  "deviceName" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushSubscription_expoPushToken_key" ON "PushSubscription"("expoPushToken");
CREATE INDEX "PushSubscription_userId_enabled_idx" ON "PushSubscription"("userId", "enabled");
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationDelivery"
  ALTER COLUMN "alertId" DROP NOT NULL,
  ADD COLUMN "pushSubscriptionId" TEXT,
  ADD COLUMN "providerTicketId" TEXT;
CREATE INDEX "NotificationDelivery_providerTicketId_idx" ON "NotificationDelivery"("providerTicketId");
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_pushSubscriptionId_fkey"
  FOREIGN KEY ("pushSubscriptionId") REFERENCES "PushSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
