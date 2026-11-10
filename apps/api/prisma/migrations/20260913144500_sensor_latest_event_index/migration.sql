CREATE INDEX CONCURRENTLY IF NOT EXISTS "ObservationEvent_sensorId_occurredAt_idx"
ON "ObservationEvent" ("sensorId", "occurredAt" DESC);
