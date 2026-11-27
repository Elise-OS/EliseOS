-- Night path lighting ("chemin lumineux de nuit").

-- What a light.* entity accepts (brightness, colour temperature, transition), from the bridge.
ALTER TABLE "DeviceEntity" ADD COLUMN "lightFeatures" JSONB;

CREATE TABLE "NightLightPath" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "triggerRoomIds" TEXT[],
    "includeBedExit" BOOLEAN NOT NULL DEFAULT true,
    "lightRoomIds" TEXT[],
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "brightnessPercent" INTEGER NOT NULL,
    "colorTemperatureKelvin" INTEGER NOT NULL,
    "offDelayMinutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NightLightPath_pkey" PRIMARY KEY ("id")
);

-- Lights turned on by Élise for a night path, persisted so a restart still turns them off.
CREATE TABLE "NightLightActivation" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "pathId" TEXT,
    "offAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NightLightActivation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NightLightPath_homeId_idx" ON "NightLightPath"("homeId");
CREATE INDEX "NightLightActivation_offAt_idx" ON "NightLightActivation"("offAt");
CREATE UNIQUE INDEX "NightLightActivation_homeId_entityId_key" ON "NightLightActivation"("homeId", "entityId");

ALTER TABLE "NightLightPath" ADD CONSTRAINT "NightLightPath_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NightLightActivation" ADD CONSTRAINT "NightLightActivation_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;
