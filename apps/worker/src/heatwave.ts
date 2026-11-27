import {
  dueHydrationReminder,
  evaluateHeatwave,
  parseHeatwaveSettings,
  sustainedAtOrAbove,
  type HeatwaveEvaluation,
  type HeatwaveForecast,
  type HeatwaveManual,
  type HeatwaveSettings,
  type HeatwaveSource,
  type TimedReading,
} from '@elise/contracts';
import type { PoolClient } from 'pg';
import { syncAlert } from './alerts.js';
import { pool } from './db.js';
import { numericPayload } from './rules.js';

export interface HeatwaveSensor {
  id: string;
  roomId: string | null;
  roomName: string | null;
  readings: TimedReading[];
}

export const HEATWAVE_ALERT_RULE_KEY = 'heatwave-indoor';

/** The family alert: one room at or above the alert threshold for the configured time. */
export function heatwaveAlertCandidate(
  settings: HeatwaveSettings,
  sensors: HeatwaveSensor[],
  now: Date,
): { active: boolean; roomId: string | null; roomName: string | null; latest: number | null } {
  let warmest: { sensor: HeatwaveSensor; latest: number } | null = null;
  for (const sensor of sensors) {
    const state = sustainedAtOrAbove(
      sensor.readings,
      settings.alert.celsius,
      settings.alert.minutes,
      now,
    );
    if (state.active && state.latest !== null && (!warmest || state.latest > warmest.latest))
      warmest = { sensor, latest: state.latest };
  }
  return {
    active: settings.alert.enabled && warmest !== null,
    roomId: warmest?.sensor.roomId ?? null,
    roomName: warmest?.sensor.roomName ?? null,
    latest: warmest?.latest ?? null,
  };
}

export function heatwaveAlertCopy(
  settings: HeatwaveSettings,
  roomName: string | null,
  latest: number | null,
) {
  const value = latest === null ? '—' : new Intl.NumberFormat('fr-FR').format(latest);
  return {
    title: `Forte chaleur dans ${roomName ?? 'le logement'}`,
    explanation: `La température atteint ${value} °C, au moins ${settings.alert.celsius} °C depuis plus de ${settings.alert.minutes} minutes. Proposer à boire, fermer les volets ou passer un appel peut être utile.`,
  };
}

/** Groups temperature readings by sensor; values outside −10…60 °C are sensor glitches. */
export function groupTemperatureReadings(
  sensors: Array<{ id: string; roomId: string | null; roomName: string | null }>,
  events: Array<{ sensorId: string; occurredAt: Date; payload: unknown }>,
): HeatwaveSensor[] {
  const bySensor = new Map<string, HeatwaveSensor>(
    sensors.map((sensor) => [sensor.id, { ...sensor, readings: [] }]),
  );
  for (const event of events) {
    const value = numericPayload(event.payload);
    if (value === null || value < -10 || value > 60) continue;
    bySensor.get(event.sensorId)?.readings.push({ occurredAt: event.occurredAt, value });
  }
  return [...bySensor.values()];
}

function forecastFrom(value: unknown): HeatwaveForecast | null {
  if (!value || typeof value !== 'object') return null;
  const forecast = value as Partial<HeatwaveForecast>;
  return typeof forecast.date === 'string' && typeof forecast.fetchedAt === 'string'
    ? {
        date: forecast.date,
        todayMax: typeof forecast.todayMax === 'number' ? forecast.todayMax : null,
        tomorrowMax: typeof forecast.tomorrowMax === 'number' ? forecast.tomorrowMax : null,
        outdoorNow: typeof forecast.outdoorNow === 'number' ? forecast.outdoorNow : null,
        city: typeof forecast.city === 'string' ? forecast.city : null,
        fetchedAt: forecast.fetchedAt,
      }
    : null;
}

async function temperatureSensors(homeId: string): Promise<HeatwaveSensor[]> {
  const sensors = await pool.query<{ id: string; roomId: string | null; roomName: string | null }>(
    `SELECT s.id, r.id AS "roomId", r.name AS "roomName"
     FROM "Sensor" s
     LEFT JOIN "Room" r ON r.id = s."roomId"
     WHERE s."homeId" = $1 AND s.capability = 'temperature'
       AND s."analysisEnabled" = true AND s."removedAt" IS NULL
       AND (s."deviceId" IS NULL OR EXISTS (
         SELECT 1 FROM "Device" d WHERE d.id = s."deviceId" AND d.enabled = true
           AND (
             d."installationStatus" = 'OPERATIONAL'
             OR (d."installationStatus" = 'ATTENTION' AND d."placementConfirmedAt" IS NOT NULL)
           )
       ))`,
    [homeId],
  );
  if (sensors.rows.length === 0) return [];
  const events = await pool.query<{ sensorId: string; occurredAt: Date; payload: unknown }>(
    `SELECT e."sensorId", e."occurredAt", e.payload
     FROM "ObservationEvent" e
     WHERE e."homeId" = $1 AND e."sensorId" = ANY($2::text[])
       AND e.capability = 'temperature' AND e.quality = 'good'
       AND e."occurredAt" >= NOW() - INTERVAL '24 hours' AND e."occurredAt" <= NOW()
     ORDER BY e."occurredAt" ASC`,
    [homeId, sensors.rows.map((sensor) => sensor.id)],
  );
  return groupTemperatureReadings(sensors.rows, events.rows);
}

async function applyEvaluation(
  client: PoolClient,
  homeId: string,
  evaluation: HeatwaveEvaluation,
): Promise<void> {
  await client.query(
    `INSERT INTO "HeatwaveMode" (id, "homeId", active, source, manual, "activatedAt", "deactivatedAt", "createdAt", "updatedAt")
     VALUES (concat('heatwave_', gen_random_uuid()), $1, $2, $3, $4,
       CASE WHEN $5 = 'activated' THEN NOW() END, CASE WHEN $5 = 'deactivated' THEN NOW() END, NOW(), NOW())
     ON CONFLICT ("homeId") DO UPDATE SET
       active = EXCLUDED.active, source = EXCLUDED.source, manual = EXCLUDED.manual,
       "activatedAt" = CASE WHEN $5 = 'activated' THEN NOW() ELSE "HeatwaveMode"."activatedAt" END,
       "deactivatedAt" = CASE WHEN $5 = 'deactivated' THEN NOW() ELSE "HeatwaveMode"."deactivatedAt" END,
       "updatedAt" = NOW()`,
    [homeId, evaluation.active, evaluation.source, evaluation.manual, evaluation.change ?? ''],
  );
  if (evaluation.change === 'activated') {
    // Minimal content, as for every push: the details stay behind the authenticated API.
    await client.query(
      `INSERT INTO "OutboxMessage" (id, "homeId", topic, payload, status, attempts, "availableAt", "createdAt", "updatedAt")
       VALUES (concat('outbox_', gen_random_uuid()), $1, 'push',
         jsonb_build_object('kind', 'heatwave', 'title', 'Élise · Mode canicule activé',
           'body', 'Ouvrez Élise pour voir les conseils du jour.'),
         'PENDING', 0, NOW(), NOW(), NOW())`,
      [homeId],
    );
  }
  if (evaluation.change)
    await client.query(
      `INSERT INTO "AuditLog" (id, "homeId", "actorId", action, target, metadata, "createdAt")
       VALUES (concat('audit_', gen_random_uuid()), $1, NULL, $2, $1, $3::jsonb, NOW())`,
      [
        homeId,
        evaluation.change === 'activated' ? 'HEATWAVE_ACTIVATED' : 'HEATWAVE_DEACTIVATED',
        JSON.stringify({
          source: evaluation.source,
          indoorHot: evaluation.indoorHot,
          forecastHot: evaluation.forecastHot,
        }),
      ],
    );
}

/**
 * Every minute: turns the heatwave mode on or off, keeps the drink reminders of the TV and the
 * family alert up to date. Reads only the database: without Internet the indoor trigger,
 * reminders and alert keep working, with the last forecast received.
 */
export async function evaluateHeatwaveModes(): Promise<void> {
  const homes = await pool.query<{ homeId: string; timezone: string }>(
    `SELECT id AS "homeId", timezone FROM "Home"`,
  );
  for (const home of homes.rows) {
    const sensors = await temperatureSensors(home.homeId);
    const client = await pool.connect();
    let settings: HeatwaveSettings;
    let active = false;
    try {
      await client.query('BEGIN');
      // The same lock as the family's on/off button: neither can overwrite the other.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`heatwave:${home.homeId}`]);
      const row = await client.query<{
        settings: unknown;
        active: boolean;
        source: string | null;
        manual: string | null;
        forecast: unknown;
      }>(
        `SELECT settings, active, source, manual, forecast FROM "HeatwaveMode" WHERE "homeId" = $1`,
        [home.homeId],
      );
      const current = row.rows[0];
      settings = parseHeatwaveSettings(current?.settings);
      const now = new Date();
      const evaluation = evaluateHeatwave({
        settings,
        previous: {
          active: current?.active ?? false,
          source: (current?.source as HeatwaveSource | null) ?? null,
          manual: (current?.manual as HeatwaveManual | null) ?? null,
        },
        sensors,
        forecast: forecastFrom(current?.forecast),
        now,
        timeZone: home.timezone,
      });
      active = evaluation.active;
      const unchanged =
        current &&
        current.active === evaluation.active &&
        current.source === evaluation.source &&
        current.manual === evaluation.manual;
      if (!unchanged && (current || evaluation.active || evaluation.manual))
        await applyEvaluation(client, home.homeId, evaluation);

      const due = active ? dueHydrationReminder(settings, now, home.timezone) : null;
      if (due)
        await client.query(
          `INSERT INTO "HydrationReminder" (id, "homeId", "scheduledFor", "expiresAt", "createdAt", "updatedAt")
           VALUES (concat('hydration_', gen_random_uuid()), $1, $2, $3, NOW(), NOW())
           ON CONFLICT ("homeId", "scheduledFor") DO NOTHING`,
          [home.homeId, due.scheduledFor, due.expiresAt],
        );
      // The mode went off: a reminder still on screen leaves the TV now.
      if (!active)
        await client.query(
          `UPDATE "HydrationReminder" SET "expiresAt" = NOW(), "updatedAt" = NOW()
           WHERE "homeId" = $1 AND "expiresAt" > NOW()`,
          [home.homeId],
        );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const alert = heatwaveAlertCandidate(settings, sensors, new Date());
    const copy = heatwaveAlertCopy(settings, alert.roomName, alert.latest);
    await syncAlert({
      homeId: home.homeId,
      roomId: alert.roomId,
      ruleKey: HEATWAVE_ALERT_RULE_KEY,
      type: 'TEMPERATURE',
      severity: 'ATTENTION',
      active: alert.active,
      title: copy.title,
      explanation: copy.explanation,
    });
  }
}
