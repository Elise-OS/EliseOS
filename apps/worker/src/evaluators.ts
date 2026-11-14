import {
  alertRuleSettingsSchema,
  DEFAULT_ALERT_RULE_SETTINGS,
  type AlertRuleSettings,
} from '@elise/contracts';
import { isDosePastConfirmationWindow, missedDoseCopy } from './medication-rules.js';
import {
  countCurrentNightActivity,
  isDoorOpenTooLong,
  isUnavailableLongEnough,
  devicesWithBatteryPercentage,
  isBatteryLowFlag,
  numericPayload,
  offlineReporterByDevice,
  persistentTemperatureViolation,
  sensorCoverageState,
  shouldOpenInactivityAlert,
} from './rules.js';
import { enqueueWebhook, syncAlert } from './alerts.js';
import { pool, type AlertSeverity, type AlertType } from './db.js';
import { frenchDuration } from './presence.js';

export function parseRules(settings: unknown): AlertRuleSettings {
  const candidate = (settings as { alertRules?: unknown } | null)?.alertRules;
  const parsed = alertRuleSettingsSchema.safeParse(candidate);
  return parsed.success ? parsed.data : DEFAULT_ALERT_RULE_SETTINGS;
}

export async function evaluateSensorRules(): Promise<void> {
  const now = new Date();
  const homes = await pool.query<{ homeId: string; timezone: string; settings: unknown }>(
    `SELECT h.id AS "homeId", h.timezone,
      (SELECT c.settings FROM "ConfigurationRevision" c WHERE c."homeId" = h.id ORDER BY c.version DESC LIMIT 1) AS settings
     FROM "Home" h`,
  );
  for (const home of homes.rows) {
    const rules = parseRules(home.settings);
    const evaluatedSensorKeys = new Set<string>();
    const sensors = await pool.query<{
      id: string;
      deviceId: string | null;
      entityId: string;
      name: string;
      capability: string;
      status: string;
      available: boolean;
      unavailableSince: Date | null;
      lastSeenAt: Date | null;
      roomId: string | null;
      roomName: string | null;
      payload: unknown;
      occurredAt: Date | null;
    }>(
      `SELECT s.id, s."deviceId", s."entityId", COALESCE(d.name, s."entityId") AS name, s.capability,
        s.status, s.available, s."unavailableSince", s."lastSeenAt",
        r.id AS "roomId", r.name AS "roomName", latest.payload, latest."occurredAt"
       FROM "Sensor" s
       LEFT JOIN "Device" d ON d.id = s."deviceId"
       LEFT JOIN "Room" r ON r.id = s."roomId"
       LEFT JOIN LATERAL (
         SELECT e.payload, e."occurredAt" FROM "ObservationEvent" e
         WHERE e."sensorId" = s.id ORDER BY e."occurredAt" DESC LIMIT 1
       ) latest ON true
       WHERE s."homeId" = $1 AND s."analysisEnabled" = true AND s."removedAt" IS NULL
         AND (s."deviceId" IS NULL OR (
           d.enabled = true
           AND (
             d."installationStatus" = 'OPERATIONAL'
             OR (d."installationStatus" = 'ATTENTION' AND d."placementConfirmedAt" IS NOT NULL)
           )
         ))`,
      [home.homeId],
    );
    const offlineReporters = offlineReporterByDevice(sensors.rows);
    const devicesWithBatteryLevel = devicesWithBatteryPercentage(sensors.rows);
    for (const sensor of sensors.rows) {
      evaluatedSensorKeys.add(`sensor-offline:${sensor.id}`);
      // Motion sensors can legitimately remain silent for hours. Home Assistant's
      // availability is the connection signal; elapsed time since motion is not.
      await syncAlert({
        homeId: home.homeId,
        roomId: sensor.roomId,
        ruleKey: `sensor-offline:${sensor.id}`,
        type: 'SENSOR_OFFLINE',
        severity: 'ATTENTION',
        active:
          rules.sensorOffline.enabled &&
          // A Zigbee sensor going silent makes all its measurements unavailable at once:
          // the caregiver gets one alert for the device, not one per measurement.
          (!sensor.deviceId || offlineReporters.get(sensor.deviceId) === sensor.id) &&
          isUnavailableLongEnough(
            sensor.available,
            sensor.unavailableSince,
            now,
            rules.sensorOffline.minutes,
          ),
        title: `${sensor.name} ne répond plus`,
        explanation: `Le capteur ${sensor.name}${sensor.roomName ? ` de ${sensor.roomName}` : ''} ne transmet plus de données à Élise. Les conclusions qui en dépendent sont suspendues.`,
      });

      if (sensor.capability === 'contact') {
        evaluatedSensorKeys.add(`door-open:${sensor.id}`);
        await syncAlert({
          homeId: home.homeId,
          roomId: sensor.roomId,
          ruleKey: `door-open:${sensor.id}`,
          type: 'DOOR_OPEN',
          severity: 'ATTENTION',
          active:
            rules.doorOpen.enabled &&
            sensor.available &&
            sensor.status === 'ONLINE' &&
            isDoorOpenTooLong(sensor.payload, sensor.occurredAt, now, rules.doorOpen.minutes),
          title: `${sensor.roomName ?? 'Une porte'} est restée ouverte`,
          explanation: `L’ouverture dure depuis plus de ${rules.doorOpen.minutes} minutes. Une vérification simple peut être utile.`,
        });
      }

      if (sensor.capability === 'battery') {
        evaluatedSensorKeys.add(`low-battery:${sensor.id}`);
        const battery = numericPayload(sensor.payload);
        // Zigbee battery_low only says "low"; the percentage of the same device already alerts.
        const lowFlagOnly = isBatteryLowFlag(sensor.payload);
        await syncAlert({
          homeId: home.homeId,
          roomId: sensor.roomId,
          ruleKey: `low-battery:${sensor.id}`,
          type: 'LOW_BATTERY',
          severity: 'INFO',
          active:
            rules.lowBattery.enabled &&
            !(lowFlagOnly && sensor.deviceId && devicesWithBatteryLevel.has(sensor.deviceId)) &&
            sensor.available &&
            sensor.status === 'ONLINE' &&
            battery !== null &&
            battery >= 0 &&
            battery <= rules.lowBattery.percent,
          title: `Batterie faible pour ${sensor.name}`,
          explanation:
            battery === null
              ? 'Le niveau de batterie est momentanément indisponible.'
              : lowFlagOnly
                ? 'Le capteur signale une batterie faible. Son remplacement peut être planifié.'
                : `La batterie indique ${battery} %. Son remplacement peut être planifié.`,
        });
      }
    }

    const temperatures = await pool.query<{
      sensorId: string;
      entityId: string;
      roomName: string | null;
      roomId: string | null;
      occurredAt: Date;
      payload: unknown;
    }>(
      `SELECT e."sensorId", s."entityId", r.id AS "roomId", r.name AS "roomName", e."occurredAt", e.payload
       FROM "ObservationEvent" e
       JOIN "Sensor" s ON s.id = e."sensorId"
       LEFT JOIN "Room" r ON r.id = s."roomId"
       WHERE e."homeId" = $1 AND e.capability = 'temperature' AND e.quality = 'good'
         AND s."analysisEnabled" = true AND s.available = true AND s.status = 'ONLINE'
         AND s."removedAt" IS NULL
         AND (s."deviceId" IS NULL OR EXISTS (
           SELECT 1 FROM "Device" d WHERE d.id = s."deviceId" AND d.enabled = true
             AND (
               d."installationStatus" = 'OPERATIONAL'
               OR (d."installationStatus" = 'ATTENTION' AND d."placementConfirmedAt" IS NOT NULL)
             )
         ))
         AND e."occurredAt" >= NOW() - INTERVAL '24 hours' AND e."occurredAt" <= NOW()
       ORDER BY e."occurredAt" ASC`,
      [home.homeId],
    );
    const bySensor = new Map<string, (typeof temperatures.rows)[number][]>();
    for (const reading of temperatures.rows) {
      if (!reading.sensorId) continue;
      const list = bySensor.get(reading.sensorId) ?? [];
      list.push(reading);
      bySensor.set(reading.sensorId, list);
    }
    for (const sensor of sensors.rows.filter((item) => item.capability === 'temperature')) {
      evaluatedSensorKeys.add(`temperature-low:${sensor.id}`);
      evaluatedSensorKeys.add(`temperature-high:${sensor.id}`);
      const readings = bySensor.get(sensor.id) ?? [];
      const values = readings
        .map((reading) => ({
          occurredAt: reading.occurredAt,
          value: numericPayload(reading.payload),
        }))
        .filter(
          (reading): reading is { occurredAt: Date; value: number } =>
            reading.value !== null && reading.value >= -10 && reading.value <= 60,
        );
      const low = persistentTemperatureViolation(
        values,
        now,
        rules.lowTemperature.celsius,
        rules.lowTemperature.minutes,
        'low',
      );
      const high = persistentTemperatureViolation(
        values,
        now,
        rules.highTemperature.celsius,
        rules.highTemperature.minutes,
        'high',
      );
      await syncAlert({
        homeId: home.homeId,
        roomId: sensor.roomId,
        ruleKey: `temperature-low:${sensor.id}`,
        type: 'TEMPERATURE',
        severity: 'ATTENTION',
        active: rules.lowTemperature.enabled && low.active,
        title: `Température basse dans ${sensor.roomName ?? 'le logement'}`,
        explanation: `La température est à ${low.latest ?? '—'} °C, sous le seuil de ${rules.lowTemperature.celsius} °C depuis au moins ${rules.lowTemperature.minutes} minutes.`,
      });
      await syncAlert({
        homeId: home.homeId,
        roomId: sensor.roomId,
        ruleKey: `temperature-high:${sensor.id}`,
        type: 'TEMPERATURE',
        severity: 'ATTENTION',
        active: rules.highTemperature.enabled && high.active,
        title: `Température élevée dans ${sensor.roomName ?? 'le logement'}`,
        explanation: `La température est à ${high.latest ?? '—'} °C, au-dessus du seuil de ${rules.highTemperature.celsius} °C depuis au moins ${rules.highTemperature.minutes} minutes.`,
      });
    }

    const orphanedSensorAlerts = await pool.query<{
      ruleKey: string;
      type: AlertType;
      severity: AlertSeverity;
      roomId: string | null;
    }>(
      `SELECT "ruleKey", type, severity, "roomId" FROM "Alert"
       WHERE "homeId" = $1 AND status IN ('OPEN', 'ACKNOWLEDGED')
         AND ("ruleKey" LIKE 'sensor-offline:%' OR "ruleKey" LIKE 'door-open:%'
           OR "ruleKey" LIKE 'low-battery:%' OR "ruleKey" LIKE 'temperature-low:%'
           OR "ruleKey" LIKE 'temperature-high:%')`,
      [home.homeId],
    );
    for (const alert of orphanedSensorAlerts.rows) {
      if (evaluatedSensorKeys.has(alert.ruleKey)) continue;
      await syncAlert({
        homeId: home.homeId,
        roomId: alert.roomId,
        ruleKey: alert.ruleKey,
        type: alert.type,
        severity: alert.severity,
        active: false,
        title: '',
        explanation: '',
      });
    }

    const nightEvents = await pool.query<{ occurredAt: Date }>(
      `SELECT e."occurredAt" FROM "ObservationEvent" e
       JOIN "Sensor" s ON s.id = e."sensorId" AND s."analysisEnabled" = true
         AND s.available = true AND s.status = 'ONLINE'
         AND s."removedAt" IS NULL
         AND (s."deviceId" IS NULL OR EXISTS (
           SELECT 1 FROM "Device" d WHERE d.id = s."deviceId" AND d.enabled = true
             AND (
               d."installationStatus" = 'OPERATIONAL'
               OR (d."installationStatus" = 'ATTENTION' AND d."placementConfirmedAt" IS NOT NULL)
             )
         ))
       WHERE e."homeId" = $1 AND e.quality = 'good'
         AND e.capability IN ('motion', 'occupancy', 'person_presence')
         AND COALESCE((e.payload->>'active')::boolean, false) = true
         AND e."occurredAt" >= NOW() - INTERVAL '24 hours'`,
      [home.homeId],
    );
    const nightCount = countCurrentNightActivity(
      nightEvents.rows.map((event) => event.occurredAt),
      now,
      home.timezone,
      rules.nightActivity.startMinute,
      rules.nightActivity.endMinute,
    );
    await syncAlert({
      homeId: home.homeId,
      ruleKey: 'night-activity',
      type: 'UNUSUAL_ACTIVITY',
      severity: 'ATTENTION',
      active: rules.nightActivity.enabled && nightCount >= rules.nightActivity.minimumEvents,
      title: 'Activité nocturne inhabituelle',
      explanation: `${nightCount} mouvements ont été observés pendant la plage nocturne configurée.`,
    });
  }
}

export async function resolveClearedSecurityAlerts(): Promise<void> {
  const pending = await pool.query<{
    id: string;
    homeId: string;
    ruleKey: string;
  }>(
    `SELECT id, "homeId", "ruleKey" FROM "Alert"
     WHERE type IN ('WATER_LEAK', 'SMOKE', 'CARBON_MONOXIDE', 'FALL_DETECTION', 'SOS')
       AND status IN ('OPEN', 'ACKNOWLEDGED')
       AND "ruleKey" LIKE 'security:%'
       AND "conditionClearedAt" <= NOW() - INTERVAL '2 minutes'
     ORDER BY "conditionClearedAt" ASC
     LIMIT 100`,
  );

  for (const alert of pending.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Match the advisory lock used by ingestion so a new active sensor event
      // cannot race with this automatic resolution.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [alert.ruleKey]);
      const current = await client.query<{ status: string }>(
        `SELECT status FROM "Alert"
         WHERE id = $1 AND "homeId" = $2
           AND type IN ('WATER_LEAK', 'SMOKE', 'CARBON_MONOXIDE', 'FALL_DETECTION', 'SOS')
           AND status IN ('OPEN', 'ACKNOWLEDGED')
           AND "conditionClearedAt" <= NOW() - INTERVAL '2 minutes'
         FOR UPDATE`,
        [alert.id, alert.homeId],
      );
      const status = current.rows[0]?.status;
      if (status !== 'OPEN' && status !== 'ACKNOWLEDGED') {
        await client.query('COMMIT');
        continue;
      }
      const resolved = await client.query<{ id: string }>(
        `UPDATE "Alert"
         SET status = 'RESOLVED', "resolvedAt" = NOW(), "updatedAt" = NOW()
         WHERE id = $1 AND status IN ('OPEN', 'ACKNOWLEDGED')
           AND "conditionClearedAt" <= NOW() - INTERVAL '2 minutes'
         RETURNING id`,
        [alert.id],
      );
      if (resolved.rowCount === 1) {
        await client.query(
          `INSERT INTO "AlertTransition" (id, "alertId", "userId", "from", "to", note, "createdAt")
           VALUES (concat('transition_', gen_random_uuid()), $1, NULL, $2::"AlertStatus", 'RESOLVED', 'Retour automatique à la normale', NOW())`,
          [alert.id, status],
        );
        await enqueueWebhook(client, alert.homeId, alert.id, 'alert.resolved');
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function evaluateInactivity(): Promise<void> {
  const homes = await pool.query<{
    homeId: string;
    timezone: string;
    lastActivity: Date | null;
    lastActivityRoom: string | null;
    inactivityMinutes: number;
    inactivityEnabled: boolean;
    sensorOfflineMinutes: number;
    configuredSensors: number;
    activeSensors: number;
  }>(
    `SELECT h.id AS "homeId", h.timezone AS "timezone",
      activity."occurredAt" AS "lastActivity",
      activity."roomName" AS "lastActivityRoom",
      COALESCE((SELECT (c.settings#>>'{alertRules,inactivity,minutes}')::int FROM "ConfigurationRevision" c WHERE c."homeId" = h.id ORDER BY version DESC LIMIT 1),
        (SELECT (c.settings->>'inactivityMinutes')::int FROM "ConfigurationRevision" c WHERE c."homeId" = h.id ORDER BY version DESC LIMIT 1), 180) AS "inactivityMinutes",
      COALESCE((SELECT (c.settings#>>'{alertRules,inactivity,enabled}')::boolean FROM "ConfigurationRevision" c WHERE c."homeId" = h.id ORDER BY version DESC LIMIT 1), true) AS "inactivityEnabled",
      COALESCE((SELECT (c.settings#>>'{alertRules,sensorOffline,minutes}')::int FROM "ConfigurationRevision" c WHERE c."homeId" = h.id ORDER BY version DESC LIMIT 1), 120) AS "sensorOfflineMinutes",
      (SELECT COUNT(*)::int FROM "Sensor" s WHERE s."homeId" = h.id
        AND s."analysisEnabled" = true AND s."removedAt" IS NULL
        AND s.capability IN ('motion', 'occupancy', 'person_presence')
        AND (s."deviceId" IS NULL OR EXISTS (
          SELECT 1 FROM "Device" d WHERE d.id = s."deviceId" AND d.enabled = true
            AND (
              d."installationStatus" = 'OPERATIONAL'
              OR (d."installationStatus" = 'ATTENTION' AND d."placementConfirmedAt" IS NOT NULL)
            )
        ))) AS "configuredSensors",
      (SELECT COUNT(*)::int FROM "Sensor" s WHERE s."homeId" = h.id AND s.status = 'ONLINE'
        AND s.available = true
        AND s."analysisEnabled" = true AND s."removedAt" IS NULL
        AND s.capability IN ('motion', 'occupancy', 'person_presence')
        AND (s."deviceId" IS NULL OR EXISTS (
          SELECT 1 FROM "Device" d WHERE d.id = s."deviceId" AND d.enabled = true
            AND (
              d."installationStatus" = 'OPERATIONAL'
              OR (d."installationStatus" = 'ATTENTION' AND d."placementConfirmedAt" IS NOT NULL)
            )
        ))) AS "activeSensors"
     FROM "Home" h
     LEFT JOIN LATERAL (
       SELECT e."occurredAt", COALESCE(sensor_room.name, event_room.name) AS "roomName"
       FROM "ObservationEvent" e
       JOIN "Sensor" active_sensor ON active_sensor.id = e."sensorId"
       LEFT JOIN "Room" sensor_room ON sensor_room.id = active_sensor."roomId"
       LEFT JOIN "Room" event_room ON event_room.id = e."roomId"
       WHERE e."homeId" = h.id
         AND active_sensor."analysisEnabled" = true AND active_sensor."removedAt" IS NULL
         AND active_sensor.available = true AND active_sensor.status = 'ONLINE'
         AND (active_sensor."deviceId" IS NULL OR EXISTS (
           SELECT 1 FROM "Device" d WHERE d.id = active_sensor."deviceId" AND d.enabled = true
             AND (
               d."installationStatus" = 'OPERATIONAL'
               OR (d."installationStatus" = 'ATTENTION' AND d."placementConfirmedAt" IS NOT NULL)
             )
         ))
         AND e.quality = 'good'
         AND e."occurredAt" <= NOW()
         AND e.capability IN ('motion', 'occupancy', 'person_presence')
         AND COALESCE((e.payload->>'active')::boolean, false) = true
       ORDER BY e."occurredAt" DESC
       LIMIT 1
     ) activity ON TRUE`,
  );
  for (const home of homes.rows) {
    const coverage = sensorCoverageState(home.configuredSensors, home.activeSensors);
    const evaluatedAt = new Date();
    if (coverage === 'UNCONFIGURED') {
      await syncAlert({
        homeId: home.homeId,
        ruleKey: 'coverage',
        type: 'SYSTEM',
        severity: 'ATTENTION',
        active: false,
        title: 'Données capteurs suffisantes',
        explanation: '',
      });
      await syncAlert({
        homeId: home.homeId,
        ruleKey: 'inactivity',
        type: 'INACTIVITY',
        severity: 'ATTENTION',
        active: false,
        title: 'Aucune activité récente',
        explanation: '',
      });
      continue;
    }
    if (coverage === 'OUTAGE') {
      const sustained = await pool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM "Sensor" s
         WHERE s."homeId" = $1 AND s."analysisEnabled" = true AND s."removedAt" IS NULL
           AND s.capability IN ('motion', 'occupancy', 'person_presence')
           AND (s."deviceId" IS NULL OR EXISTS (
             SELECT 1 FROM "Device" d WHERE d.id = s."deviceId" AND d.enabled = true
               AND (
                 d."installationStatus" = 'OPERATIONAL'
                 OR (d."installationStatus" = 'ATTENTION' AND d."placementConfirmedAt" IS NOT NULL)
               )
           ))
           AND s.available = false AND s."unavailableSince" IS NOT NULL
           AND s."unavailableSince" <= NOW() - ($2::int * INTERVAL '1 minute')`,
        [home.homeId, home.sensorOfflineMinutes],
      );
      await syncAlert({
        homeId: home.homeId,
        ruleKey: 'coverage',
        type: 'SYSTEM',
        severity: 'ATTENTION',
        active: home.activeSensors === 0 && (sustained.rows[0]?.count ?? 0) > 0,
        title: 'Données capteurs insuffisantes',
        explanation: 'Élise ne reçoit plus assez de données fiables pour évaluer la situation.',
      });
      await syncAlert({
        homeId: home.homeId,
        ruleKey: 'inactivity',
        type: 'INACTIVITY',
        severity: 'ATTENTION',
        active: false,
        title: 'Aucune activité récente',
        explanation: '',
      });
      continue;
    }
    await syncAlert({
      homeId: home.homeId,
      ruleKey: 'coverage',
      type: 'SYSTEM',
      severity: 'ATTENTION',
      active: false,
      title: 'Données capteurs suffisantes',
      explanation: '',
    });
    const inactive = shouldOpenInactivityAlert(
      home.lastActivity,
      evaluatedAt,
      home.inactivityMinutes,
      coverage,
    );
    const lastMovementDuration = home.lastActivity
      ? frenchDuration((evaluatedAt.getTime() - home.lastActivity.getTime()) / 1000)
      : null;
    const lastMovementDate = home.lastActivity
      ? new Intl.DateTimeFormat('fr-FR', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: home.timezone,
        }).format(home.lastActivity)
      : null;
    const inactivityThreshold = frenchDuration(home.inactivityMinutes * 60);
    await syncAlert({
      homeId: home.homeId,
      ruleKey: 'inactivity',
      type: 'INACTIVITY',
      severity: 'ATTENTION',
      active: home.inactivityEnabled && inactive,
      title: lastMovementDuration
        ? `Aucun mouvement depuis ${lastMovementDuration}`
        : 'Aucune activité de mouvement récente',
      explanation: lastMovementDate
        ? `Dernier mouvement fiable : ${lastMovementDate}${home.lastActivityRoom ? `, dans ${home.lastActivityRoom}` : ''}. Seuil d’alerte configuré : ${inactivityThreshold} sans mouvement.`
        : `Aucun mouvement fiable reçu. Seuil d’alerte configuré : ${inactivityThreshold}.`,
    });
  }
}

export async function evaluateMedicationDoses(): Promise<void> {
  await pool.query(
    `INSERT INTO "MedicationDose" (id, "scheduleId", "scheduledFor", status, "createdAt", "updatedAt")
     SELECT concat('dose_', gen_random_uuid()), schedule.id,
       (calendar.local_date + make_interval(mins => schedule."minuteOfDay")) AT TIME ZONE home.timezone,
       'PENDING', NOW(), NOW()
     FROM "MedicationSchedule" schedule
     JOIN "Medication" medication ON medication.id = schedule."medicationId"
     JOIN "Home" home ON home.id = medication."homeId"
     CROSS JOIN generate_series(-1, 1) AS day_offset
     CROSS JOIN LATERAL (
       SELECT (NOW() AT TIME ZONE home.timezone)::date + day_offset AS local_date
     ) calendar
     WHERE medication.active = true AND schedule.active = true
       AND EXTRACT(DOW FROM calendar.local_date)::int = ANY(schedule."daysOfWeek")
       AND (medication."startsOn" IS NULL OR (medication."startsOn" AT TIME ZONE home.timezone)::date <= calendar.local_date)
       AND (medication."endsOn" IS NULL OR (medication."endsOn" AT TIME ZONE home.timezone)::date >= calendar.local_date)
     ON CONFLICT ("scheduleId", "scheduledFor") DO NOTHING`,
  );

  const pending = await pool.query<{
    id: string;
    scheduledFor: Date;
    graceMinutes: number;
  }>(
    `SELECT dose.id, dose."scheduledFor", schedule."graceMinutes"
     FROM "MedicationDose" dose
     JOIN "MedicationSchedule" schedule ON schedule.id = dose."scheduleId"
     JOIN "Medication" medication ON medication.id = schedule."medicationId"
     WHERE dose.status = 'PENDING' AND medication.active = true AND schedule.active = true
       AND dose."scheduledFor" <= NOW()`,
  );
  const now = new Date();
  for (const dose of pending.rows) {
    if (!isDosePastConfirmationWindow(dose.scheduledFor, dose.graceMinutes, now)) continue;
    await pool.query(
      `UPDATE "MedicationDose" SET status = 'MISSED', "updatedAt" = NOW()
       WHERE id = $1 AND status = 'PENDING'`,
      [dose.id],
    );
  }

  const missed = await pool.query<{
    id: string;
    homeId: string;
    name: string;
    dosage: string;
    scheduledFor: Date;
    timezone: string;
  }>(
    `SELECT dose.id, medication."homeId", medication.name, medication.dosage,
       dose."scheduledFor", home.timezone
     FROM "MedicationDose" dose
     JOIN "MedicationSchedule" schedule ON schedule.id = dose."scheduleId"
     JOIN "Medication" medication ON medication.id = schedule."medicationId"
     JOIN "Home" home ON home.id = medication."homeId"
     WHERE dose.status = 'MISSED' AND medication.active = true AND schedule.active = true
       AND dose."scheduledFor" >= NOW() - INTERVAL '48 hours'`,
  );
  const currentDoseKeys = new Set(missed.rows.map((dose) => `medication:${dose.id}`));
  for (const dose of missed.rows) {
    const time = new Intl.DateTimeFormat('fr-FR', {
      timeZone: dose.timezone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(dose.scheduledFor);
    const copy = missedDoseCopy(dose.name, dose.dosage, time);
    await syncAlert({
      homeId: dose.homeId,
      ruleKey: `medication:${dose.id}`,
      type: 'MEDICATION_MISSED',
      severity: 'ATTENTION',
      active: true,
      title: copy.title,
      explanation: copy.explanation,
    });
  }
  const orphanedMedicationAlerts = await pool.query<{ homeId: string; ruleKey: string }>(
    `SELECT "homeId", "ruleKey" FROM "Alert"
     WHERE "ruleKey" LIKE 'medication:%' AND status IN ('OPEN', 'ACKNOWLEDGED')`,
  );
  for (const alert of orphanedMedicationAlerts.rows) {
    if (currentDoseKeys.has(alert.ruleKey)) continue;
    await syncAlert({
      homeId: alert.homeId,
      ruleKey: alert.ruleKey,
      type: 'MEDICATION_MISSED',
      severity: 'ATTENTION',
      active: false,
      title: '',
      explanation: '',
    });
  }
}
