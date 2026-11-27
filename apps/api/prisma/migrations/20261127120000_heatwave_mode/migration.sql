-- Heatwave mode ("mode canicule"): family settings and state per home, and the drink
-- reminders shown on the TV (shown only: the resident never has to answer them). See docs/mode-canicule.md.

-- CreateTable
CREATE TABLE "HeatwaveMode" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "manual" TEXT,
    "activatedAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "forecast" JSONB,
    "registryAcknowledgedYear" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HeatwaveMode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HydrationReminder" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HydrationReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HeatwaveMode_homeId_key" ON "HeatwaveMode"("homeId");

-- CreateIndex
CREATE UNIQUE INDEX "HydrationReminder_homeId_scheduledFor_key" ON "HydrationReminder"("homeId", "scheduledFor");

-- AddForeignKey
ALTER TABLE "HeatwaveMode" ADD CONSTRAINT "HeatwaveMode_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HydrationReminder" ADD CONSTRAINT "HydrationReminder_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The caregiver screens refresh the heatwave card as soon as its state changes or a reminder shows.
CREATE OR REPLACE FUNCTION elise_notify_heatwave() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'elise_updates',
    json_build_object('homeId', NEW."homeId", 'type', 'heatwave', 'entityId', NEW.id)::text
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER elise_heatwave_mode_notify
AFTER INSERT OR UPDATE OF active, manual, settings, "registryAcknowledgedYear" ON "HeatwaveMode"
FOR EACH ROW EXECUTE FUNCTION elise_notify_heatwave();

CREATE TRIGGER elise_hydration_reminder_notify
AFTER INSERT ON "HydrationReminder"
FOR EACH ROW EXECUTE FUNCTION elise_notify_heatwave();
