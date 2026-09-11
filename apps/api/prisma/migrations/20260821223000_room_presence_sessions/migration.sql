CREATE TYPE "PresenceSessionState" AS ENUM ('OPEN', 'CLOSED', 'AMBIGUOUS');
CREATE TYPE "PresenceConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "PresenceSource" AS ENUM ('SENSOR', 'CAMERA', 'COMBINED');
CREATE TYPE "PresenceEndReason" AS ENUM ('TRANSITION', 'EXPLICIT_ABSENCE', 'MOTION_TIMEOUT', 'SENSOR_OFFLINE', 'CORRECTION');

ALTER TABLE "ObservationEvent"
  ADD COLUMN "roomId" TEXT,
  ADD COLUMN "roomSource" TEXT,
  ADD COLUMN "roomConfidence" "PresenceConfidence";

UPDATE "ObservationEvent" e
SET "roomId" = COALESCE(e.payload #>> '{context,roomId}', s."roomId"),
    "roomSource" = CASE
      WHEN e.payload #>> '{context,roomId}' IS NOT NULL THEN 'PLAN_PLACEMENT'
      WHEN s."roomId" IS NOT NULL THEN 'CURRENT_SENSOR_BACKFILL'
      ELSE NULL
    END,
    "roomConfidence" = CASE
      WHEN e.payload #>> '{context,roomId}' IS NOT NULL THEN 'HIGH'::"PresenceConfidence"
      WHEN s."roomId" IS NOT NULL THEN 'LOW'::"PresenceConfidence"
      ELSE NULL
    END
FROM "Sensor" s
WHERE e."sensorId" = s.id;

ALTER TABLE "ObservationEvent"
  ADD CONSTRAINT "ObservationEvent_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "Room"(id) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ObservationEvent_homeId_roomId_occurredAt_idx"
  ON "ObservationEvent"("homeId", "roomId", "occurredAt" DESC);

CREATE TABLE "RoomPresenceSession" (
  "id" TEXT NOT NULL,
  "homeId" TEXT NOT NULL,
  "residentId" TEXT,
  "roomId" TEXT NOT NULL,
  "sensorId" TEXT,
  "capability" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "lastConfirmedAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  "durationSeconds" INTEGER,
  "state" "PresenceSessionState" NOT NULL DEFAULT 'OPEN',
  "confidence" "PresenceConfidence" NOT NULL,
  "source" "PresenceSource" NOT NULL,
  "entryEventId" TEXT,
  "exitEventId" TEXT,
  "endReason" "PresenceEndReason",
  "previousRoomId" TEXT,
  "plausibleTransition" BOOLEAN,
  "excludedFromLearning" BOOLEAN NOT NULL DEFAULT false,
  "ambiguousReason" TEXT,
  "dwellAnomalySince" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RoomPresenceSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RoomDailyPresenceAggregate" (
  "id" TEXT NOT NULL,
  "homeId" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "localDate" TIMESTAMP(3) NOT NULL,
  "dayKind" TEXT NOT NULL,
  "passages" INTEGER NOT NULL,
  "totalSeconds" INTEGER NOT NULL,
  "averageSeconds" INTEGER NOT NULL,
  "medianSeconds" INTEGER NOT NULL,
  "madSeconds" INTEGER NOT NULL,
  "firstMinute" INTEGER,
  "lastMinute" INTEGER,
  "reliableSessions" INTEGER NOT NULL,
  "ambiguousSessions" INTEGER NOT NULL,
  "confidenceRate" DOUBLE PRECISION NOT NULL,
  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoomDailyPresenceAggregate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RoomPresenceSession_homeId_state_lastConfirmedAt_idx"
  ON "RoomPresenceSession"("homeId", "state", "lastConfirmedAt" DESC);
CREATE INDEX "RoomPresenceSession_homeId_roomId_startedAt_idx"
  ON "RoomPresenceSession"("homeId", "roomId", "startedAt" DESC);
CREATE INDEX "RoomPresenceSession_residentId_startedAt_idx"
  ON "RoomPresenceSession"("residentId", "startedAt" DESC);
CREATE UNIQUE INDEX "RoomDailyPresenceAggregate_homeId_roomId_localDate_key"
  ON "RoomDailyPresenceAggregate"("homeId", "roomId", "localDate");
CREATE INDEX "RoomDailyPresenceAggregate_homeId_localDate_idx"
  ON "RoomDailyPresenceAggregate"("homeId", "localDate" DESC);

ALTER TABLE "RoomPresenceSession"
  ADD CONSTRAINT "RoomPresenceSession_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "RoomPresenceSession_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "RoomPresenceSession_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RoomDailyPresenceAggregate"
  ADD CONSTRAINT "RoomDailyPresenceAggregate_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "RoomDailyPresenceAggregate_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Best-effort reconstruction of the retained history. Events whose room only
-- comes from the sensor's current assignment remain LOW confidence and are not
-- allowed into learned baselines.
WITH positive AS (
  SELECT e.*, LAG(e."roomId") OVER (PARTITION BY e."homeId" ORDER BY e."occurredAt", e.id) AS previous_room,
    LAG(e."occurredAt") OVER (PARTITION BY e."homeId" ORDER BY e."occurredAt", e.id) AS previous_at
  FROM "ObservationEvent" e JOIN "Sensor" s ON s.id = e."sensorId"
  WHERE e."occurredAt" >= NOW() - INTERVAL '90 days' AND e."roomId" IS NOT NULL
    AND e.capability IN ('motion', 'occupancy', 'person_presence')
    AND COALESCE((e.payload->>'active')::boolean, false) = true AND s."analysisEnabled" = true
), marked AS (
  SELECT *, CASE WHEN previous_room IS DISTINCT FROM "roomId"
    OR previous_at IS NULL OR "occurredAt" - previous_at > INTERVAL '10 minutes'
    THEN 1 ELSE 0 END AS starts_group
  FROM positive
), islands AS (
  SELECT *, SUM(starts_group) OVER (PARTITION BY "homeId" ORDER BY "occurredAt", id) AS group_id
  FROM marked
), grouped AS (
  SELECT i."homeId", i."roomId", MIN(i."occurredAt") AS started_at,
    MAX(i."occurredAt") AS confirmed_at,
    (ARRAY_AGG(i.id ORDER BY i."occurredAt", i.id))[1] AS entry_event,
    (ARRAY_AGG(i."sensorId" ORDER BY i."occurredAt" DESC, i.id DESC))[1] AS sensor_id,
    (ARRAY_AGG(i.capability ORDER BY i."occurredAt" DESC, i.id DESC))[1] AS capability,
    BOOL_OR(i."roomConfidence" = 'LOW') AS low_confidence,
    i.group_id
  FROM islands i GROUP BY i."homeId", i."roomId", i.group_id
), sequenced AS (
  SELECT g.*, LEAD(g.started_at) OVER (PARTITION BY g."homeId" ORDER BY g.started_at) AS next_started,
    LEAD(g."roomId") OVER (PARTITION BY g."homeId" ORDER BY g.started_at) AS next_room
  FROM grouped g
)
INSERT INTO "RoomPresenceSession"
  (id, "homeId", "residentId", "roomId", "sensorId", capability, "startedAt", "lastConfirmedAt",
   "endedAt", "durationSeconds", state, confidence, source, "entryEventId", "previousRoomId",
   "plausibleTransition", "excludedFromLearning", "ambiguousReason", "createdAt", "updatedAt")
SELECT concat('presence_backfill_', gen_random_uuid()), q."homeId", h."primaryResidentId", q."roomId",
  q.sensor_id, q.capability, q.started_at, q.confirmed_at,
  COALESCE(q.next_started, CASE WHEN q.capability = 'motion' THEN q.confirmed_at + INTERVAL '10 minutes' END),
  CASE WHEN q.next_started IS NOT NULL OR q.capability = 'motion'
    THEN GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(q.next_started, q.confirmed_at + INTERVAL '10 minutes') - q.started_at))::int)
    ELSE NULL END,
  CASE WHEN q.next_started IS NULL AND q.capability <> 'motion' THEN 'OPEN'::"PresenceSessionState" ELSE 'CLOSED'::"PresenceSessionState" END,
  CASE WHEN q.low_confidence THEN 'LOW'::"PresenceConfidence" ELSE 'MEDIUM'::"PresenceConfidence" END,
  'SENSOR'::"PresenceSource", q.entry_event, NULL, NULL,
  q.low_confidence OR EXISTS (SELECT 1 FROM "Visit" v WHERE v."homeId" = q."homeId"
    AND v."startsAt" <= q.started_at AND COALESCE(v."endsAt", v."startsAt" + INTERVAL '2 hours') >= q.started_at),
  CASE WHEN q.low_confidence THEN 'CURRENT_SENSOR_BACKFILL' ELSE NULL END, NOW(), NOW()
FROM sequenced q JOIN "Home" h ON h.id = q."homeId";
