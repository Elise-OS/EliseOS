ALTER TABLE "Sensor" ADD COLUMN "unavailableSince" TIMESTAMP(3);
UPDATE "Sensor"
SET "unavailableSince" = NOW()
WHERE available = false AND "removedAt" IS NULL;

ALTER TABLE "Alert" ADD COLUMN "conditionClearedAt" TIMESTAMP(3);
UPDATE "Alert"
SET "conditionClearedAt" = "resolvedAt"
WHERE status IN ('RESOLVED', 'DISMISSED');

ALTER TABLE "PushSubscription" ADD COLUMN "sessionId" TEXT;
-- Existing device tokens remain unbound and are not sent to until the app re-registers them.
ALTER TABLE "PushSubscription"
ADD CONSTRAINT "PushSubscription_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "PushSubscription_sessionId_idx" ON "PushSubscription"("sessionId");
