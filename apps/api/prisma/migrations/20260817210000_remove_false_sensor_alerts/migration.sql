-- Remove alerts created from Home Assistant's internal entities and coverage
-- warnings emitted before any real sensor was configured.
DELETE FROM "OutboxMessage"
WHERE payload->>'alertId' IN (
  SELECT alert.id
  FROM "Alert" AS alert
  WHERE (
    alert.type = 'SENSOR_OFFLINE'
    AND alert."ruleKey" LIKE 'sensor-offline:%'
    AND NOT EXISTS (
      SELECT 1
      FROM "Sensor" AS sensor
      WHERE 'sensor-offline:' || sensor.id = alert."ruleKey"
    )
  ) OR (
    alert.type = 'SYSTEM'
    AND alert."ruleKey" = 'coverage'
    AND NOT EXISTS (
      SELECT 1
      FROM "Sensor" AS sensor
      LEFT JOIN "Device" AS device ON device.id = sensor."deviceId"
      WHERE sensor."homeId" = alert."homeId"
        AND sensor."analysisEnabled" = true
        AND sensor."removedAt" IS NULL
        AND sensor.capability IN ('motion', 'occupancy', 'person_presence', 'contact')
        AND (
          sensor."deviceId" IS NULL
          OR (device.enabled = true AND device."installationStatus" = 'OPERATIONAL')
        )
    )
  )
);

DELETE FROM "Alert" AS alert
WHERE (
  alert.type = 'SENSOR_OFFLINE'
  AND alert."ruleKey" LIKE 'sensor-offline:%'
  AND NOT EXISTS (
    SELECT 1
    FROM "Sensor" AS sensor
    WHERE 'sensor-offline:' || sensor.id = alert."ruleKey"
  )
) OR (
  alert.type = 'SYSTEM'
  AND alert."ruleKey" = 'coverage'
  AND NOT EXISTS (
    SELECT 1
    FROM "Sensor" AS sensor
    LEFT JOIN "Device" AS device ON device.id = sensor."deviceId"
    WHERE sensor."homeId" = alert."homeId"
      AND sensor."analysisEnabled" = true
      AND sensor."removedAt" IS NULL
      AND sensor.capability IN ('motion', 'occupancy', 'person_presence', 'contact')
      AND (
        sensor."deviceId" IS NULL
        OR (device.enabled = true AND device."installationStatus" = 'OPERATIONAL')
      )
  )
);
