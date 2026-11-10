-- Remove the Home Assistant services that were previously mistaken for physical sensors.
-- Rows with observations or an explicit manual mapping are deliberately preserved.
DELETE FROM "Sensor" AS sensor
WHERE sensor."removedAt" IS NOT NULL
  AND (
    sensor."entityId" LIKE 'sensor.sun\_%' ESCAPE '\'
    OR sensor."entityId" LIKE 'binary\_sensor.sun\_%' ESCAPE '\'
    OR sensor."entityId" LIKE 'sensor.backup\_%' ESCAPE '\'
    OR sensor."entityId" LIKE 'event.backup\_%' ESCAPE '\'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "ObservationEvent" AS event WHERE event."sensorId" = sensor.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM "SensorMapping" AS mapping WHERE mapping."sensorId" = sensor.id
  );

DELETE FROM "Device" AS device
WHERE device.integration IN ('sun', 'backup')
  AND NOT EXISTS (SELECT 1 FROM "Sensor" AS sensor WHERE sensor."deviceId" = device.id)
  AND NOT EXISTS (SELECT 1 FROM "Camera" AS camera WHERE camera."deviceId" = device.id)
  AND NOT EXISTS (
    SELECT 1 FROM "SensorOnboardingSession" AS session WHERE session."deviceId" = device.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM "SensorVerificationSession" AS session WHERE session."deviceId" = device.id
  );
