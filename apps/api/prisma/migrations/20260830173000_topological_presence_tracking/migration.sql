CREATE TYPE "PresenceTrackingStatus" AS ENUM ('CONFIRMED', 'IN_TRANSIT', 'AMBIGUOUS', 'STALE', 'UNKNOWN');
CREATE TYPE "PresenceDecisionOutcome" AS ENUM ('CONFIRMED', 'PENDING', 'AMBIGUOUS', 'CANCELLED', 'STALE');

CREATE TABLE "PresenceTrackingState" (
  "id" TEXT NOT NULL,
  "homeId" TEXT NOT NULL,
  "residentId" TEXT,
  "status" "PresenceTrackingStatus" NOT NULL DEFAULT 'UNKNOWN',
  "confirmedRoomId" TEXT,
  "candidateRoomId" TEXT,
  "pathRoomIds" JSONB NOT NULL DEFAULT '[]',
  "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reasonCodes" JSONB NOT NULL DEFAULT '[]',
  "evidenceSummary" JSONB NOT NULL DEFAULT '[]',
  "lastEvidenceAt" TIMESTAMP(3),
  "transitionStartedAt" TIMESTAMP(3),
  "inconsistencyCount" INTEGER NOT NULL DEFAULT 0,
  "inconsistencyWindowAt" TIMESTAMP(3),
  "trackingDegraded" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PresenceTrackingState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PresenceTransitionDecision" (
  "id" TEXT NOT NULL,
  "homeId" TEXT NOT NULL,
  "residentId" TEXT,
  "fromRoomId" TEXT,
  "toRoomId" TEXT,
  "pathRoomIds" JSONB NOT NULL DEFAULT '[]',
  "outcome" "PresenceDecisionOutcome" NOT NULL,
  "confidenceScore" DOUBLE PRECISION NOT NULL,
  "reasonCodes" JSONB NOT NULL DEFAULT '[]',
  "evidenceSummary" JSONB NOT NULL DEFAULT '[]',
  "explanation" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PresenceTransitionDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PresenceTrackingState_homeId_key" ON "PresenceTrackingState"("homeId");
CREATE INDEX "PresenceTrackingState_residentId_idx" ON "PresenceTrackingState"("residentId");
CREATE INDEX "PresenceTrackingState_status_lastEvidenceAt_idx" ON "PresenceTrackingState"("status", "lastEvidenceAt" DESC);
CREATE INDEX "PresenceTransitionDecision_homeId_occurredAt_idx" ON "PresenceTransitionDecision"("homeId", "occurredAt" DESC);
CREATE INDEX "PresenceTransitionDecision_residentId_occurredAt_idx" ON "PresenceTransitionDecision"("residentId", "occurredAt" DESC);

ALTER TABLE "PresenceTrackingState"
  ADD CONSTRAINT "PresenceTrackingState_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PresenceTrackingState_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "PresenceTrackingState_confirmedRoomId_fkey" FOREIGN KEY ("confirmedRoomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "PresenceTrackingState_candidateRoomId_fkey" FOREIGN KEY ("candidateRoomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PresenceTransitionDecision"
  ADD CONSTRAINT "PresenceTransitionDecision_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PresenceTransitionDecision_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "PresenceTransitionDecision_fromRoomId_fkey" FOREIGN KEY ("fromRoomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "PresenceTransitionDecision_toRoomId_fkey" FOREIGN KEY ("toRoomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION michel_notify_presence_tracking() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('michel_updates', json_build_object(
    'homeId', NEW."homeId", 'type', 'presence', 'entityId', NEW.id
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER presence_tracking_realtime
AFTER INSERT OR UPDATE ON "PresenceTrackingState"
FOR EACH ROW EXECUTE FUNCTION michel_notify_presence_tracking();
