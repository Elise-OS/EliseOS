import { createHmac } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { MichelAiClient } from '@michel/ai-client';
import {
  alertRuleSettingsSchema,
  DEFAULT_ALERT_RULE_SETTINGS,
  type AlertRuleSettings,
} from '@michel/contracts';
import pg from 'pg';
import { LEARNED_HABIT_STATUS, shouldCreateAnomalyAlert } from './policy.js';
import { isDosePastConfirmationWindow, missedDoseCopy } from './medication-rules.js';
import {
  countNightActivity,
  isDoorOpenTooLong,
  isStale,
  numericPayload,
  persistentTemperatureViolation,
} from './rules.js';

const { Pool } = pg;
pg.types.setTypeParser(1114, (value) => new Date(`${value.replace(' ', 'T')}Z`));
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: '-c timezone=UTC',
});
const ai = new MichelAiClient(
  process.env.AI_BASE_URL ?? 'http://ai:8000',
  process.env.AI_SHARED_SECRET ?? 'development-secret-change-me',
);

interface OutboxRow {
  id: string;
  homeId: string;
  topic: string;
  payload: Record<string, unknown>;
  attempts: number;
}

type AlertType =
  | 'INACTIVITY'
  | 'DOOR_OPEN'
  | 'SOS'
  | 'UNUSUAL_ACTIVITY'
  | 'TEMPERATURE'
  | 'SENSOR_OFFLINE'
  | 'LOW_BATTERY'
  | 'MEDICATION_MISSED'
  | 'SYSTEM';

type AlertSeverity = 'INFO' | 'ATTENTION' | 'URGENT';

interface AlertCandidate {
  homeId: string;
  ruleKey: string;
  type: AlertType;
  severity: AlertSeverity;
  active: boolean;
  title: string;
  explanation: string;
}

const CAPABILITIES = [
  'motion',
  'occupancy',
  'contact',
  'button',
  'temperature',
  'humidity',
  'power',
  'energy',
  'battery',
] as const;

function eventFeatures(occurredAt: Date, capability: string, quality: string) {
  const hour = occurredAt.getHours();
  return {
    hour_sin: Math.sin((hour / 24) * Math.PI * 2),
    hour_cos: Math.cos((hour / 24) * Math.PI * 2),
    capability_code: CAPABILITIES.indexOf(capability as (typeof CAPABILITIES)[number]),
    quality: quality === 'good' ? 1 : 0,
  };
}

async function claim(): Promise<OutboxRow | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<OutboxRow>(
      `SELECT id, "homeId", topic, payload, attempts
       FROM "OutboxMessage"
       WHERE status IN ('PENDING', 'FAILED') AND "availableAt" <= NOW()
       ORDER BY "createdAt" ASC
       LIMIT 1 FOR UPDATE SKIP LOCKED`,
    );
    const row = result.rows[0];
    if (!row) {
      await client.query('COMMIT');
      return null;
    }
    await client.query(
      `UPDATE "OutboxMessage" SET status = 'PROCESSING', attempts = attempts + 1, "updatedAt" = NOW() WHERE id = $1`,
      [row.id],
    );
    await client.query('COMMIT');
    return row;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function handleAi(row: OutboxRow): Promise<void> {
  const score = await ai.score(row.payload);
  const previous = await pool.query<{ score: number; confidence: number }>(
    `SELECT score, confidence FROM "AnomalyEvaluation" WHERE "homeId" = $1 ORDER BY "evaluatedAt" DESC LIMIT 1`,
    [row.homeId],
  );
  await pool.query(
    `INSERT INTO "AnomalyEvaluation" (id, "homeId", "modelVersion", score, confidence, factors, "evaluatedAt")
     VALUES (concat('eval_', gen_random_uuid()), $1, $2, $3, $4, $5::jsonb, NOW())`,
    [row.homeId, score.model_version, score.score, score.confidence, JSON.stringify(score.factors)],
  );
  const prior = previous.rows[0];
  if (
    shouldCreateAnomalyAlert(
      { score: score.score, confidence: score.confidence, isAnomaly: score.is_anomaly },
      prior,
    )
  ) {
    const existing = await pool.query(
      `SELECT 1 FROM "Alert" WHERE "homeId" = $1 AND type = 'UNUSUAL_ACTIVITY' AND status IN ('OPEN', 'ACKNOWLEDGED') LIMIT 1`,
      [row.homeId],
    );
    if (existing.rowCount === 0) {
      const created = await pool.query<{ id: string }>(
        `INSERT INTO "Alert" (id, "homeId", type, severity, status, title, explanation, confidence, "openedAt", "createdAt", "updatedAt")
         VALUES (concat('alert_', gen_random_uuid()), $1, 'UNUSUAL_ACTIVITY', 'ATTENTION', 'OPEN', $2, $3, $4, NOW(), NOW(), NOW()) RETURNING id`,
        [
          row.homeId,
          'Activité inhabituelle détectée',
          score.factors[0]?.message ?? 'Le rythme observé diffère des habitudes récentes.',
          score.confidence,
        ],
      );
      await enqueueWebhook(row.homeId, created.rows[0]!.id, 'alert.opened');
    }
  }
}

async function handleWebhook(row: OutboxRow): Promise<void> {
  const url = process.env.WEBHOOK_URL;
  const secret = process.env.WEBHOOK_SECRET;
  if (!url || !secret) return;
  const body = JSON.stringify({
    schemaVersion: '1.0',
    deliveryId: row.id,
    occurredAt: new Date().toISOString(),
    ...row.payload,
  });
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-michel-signature': `sha256=${signature}` },
    body,
  });
  if (!response.ok) throw new Error(`Webhook returned ${response.status}`);
}

interface PushSubscriptionRow {
  id: string;
  expoPushToken: string;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

async function handlePush(row: OutboxRow): Promise<void> {
  const alertId = typeof row.payload.alertId === 'string' ? row.payload.alertId : null;
  const requestedUserId = typeof row.payload.userId === 'string' ? row.payload.userId : null;
  const subscriptions = await pool.query<PushSubscriptionRow>(
    `SELECT DISTINCT ps.id, ps."expoPushToken"
     FROM "PushSubscription" ps
     JOIN "User" u ON u.id = ps."userId"
     JOIN "Membership" m ON m."userId" = u.id
     JOIN "Home" h ON h."organizationId" = m."organizationId"
     WHERE h.id = $1 AND ps.enabled = true
       AND ($2::text IS NULL OR ps."userId" = $2)`,
    [row.homeId, requestedUserId],
  );
  if (subscriptions.rows.length === 0) return;

  let title =
    typeof row.payload.title === 'string' ? row.payload.title : 'Nouvelle information Élise';
  let body =
    typeof row.payload.body === 'string'
      ? row.payload.body
      : 'Ouvrez Élise pour consulter la situation.';
  let severity: string | null = null;
  if (alertId) {
    const alert = await pool.query<{ severity: string; status: string }>(
      `SELECT severity, status FROM "Alert" WHERE id = $1 AND "homeId" = $2`,
      [alertId, row.homeId],
    );
    severity = alert.rows[0]?.severity ?? null;
    title = severity === 'URGENT' ? 'Élise · Attention requise' : 'Élise · Nouvelle information';
    body = 'Une situation a été détectée au domicile. Ouvrez Élise pour les détails.';
  }

  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(process.env.EXPO_ACCESS_TOKEN
        ? { authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
        : {}),
    },
    body: JSON.stringify(
      subscriptions.rows.map((subscription) => ({
        to: subscription.expoPushToken,
        sound: 'default',
        title,
        body,
        priority: severity === 'URGENT' ? 'high' : 'default',
        data: { kind: alertId ? 'alert' : (row.payload.kind ?? 'system'), alertId, severity },
      })),
    ),
  });
  if (!response.ok) throw new Error(`Expo Push returned ${response.status}`);
  const result = (await response.json()) as { data?: ExpoTicket[] };
  const tickets = result.data ?? [];
  for (const [index, subscription] of subscriptions.rows.entries()) {
    const ticket = tickets[index];
    const delivery = await pool.query<{ id: string }>(
      `INSERT INTO "NotificationDelivery"
       (id, "alertId", "pushSubscriptionId", channel, endpoint, status, attempts, "lastAttemptAt", "deliveredAt", error, "providerTicketId", "createdAt")
       VALUES (concat('delivery_', gen_random_uuid()), $1, $2, 'expo_push', $3, $4, 1, NOW(), NULL, $5, $6, NOW())
       RETURNING id`,
      [
        alertId,
        subscription.id,
        subscription.expoPushToken,
        ticket?.status === 'ok' ? 'TICKETED' : 'FAILED',
        ticket?.message ?? null,
        ticket?.id ?? null,
      ],
    );
    if (ticket?.id && delivery.rows[0]) {
      await pool.query(
        `INSERT INTO "OutboxMessage"
         (id, "homeId", topic, payload, status, attempts, "availableAt", "createdAt", "updatedAt")
         VALUES (concat('outbox_', gen_random_uuid()), $1, 'push.receipt',
           jsonb_build_object('deliveryId', $2, 'ticketId', $3, 'subscriptionId', $4),
           'PENDING', 0, NOW() + INTERVAL '15 minutes', NOW(), NOW())`,
        [row.homeId, delivery.rows[0].id, ticket.id, subscription.id],
      );
    }
    if (ticket?.details?.error === 'DeviceNotRegistered') {
      await pool.query(
        `UPDATE "PushSubscription" SET enabled = false, "updatedAt" = NOW() WHERE id = $1`,
        [subscription.id],
      );
    }
  }
}

async function handlePushReceipt(row: OutboxRow): Promise<void> {
  const ticketId = typeof row.payload.ticketId === 'string' ? row.payload.ticketId : '';
  const deliveryId = typeof row.payload.deliveryId === 'string' ? row.payload.deliveryId : '';
  const subscriptionId =
    typeof row.payload.subscriptionId === 'string' ? row.payload.subscriptionId : '';
  if (!ticketId || !deliveryId) return;
  const response = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(process.env.EXPO_ACCESS_TOKEN
        ? { authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({ ids: [ticketId] }),
  });
  if (!response.ok) throw new Error(`Expo Push receipts returned ${response.status}`);
  const result = (await response.json()) as {
    data?: Record<
      string,
      { status: 'ok' | 'error'; message?: string; details?: { error?: string } }
    >;
  };
  const receipt = result.data?.[ticketId];
  if (!receipt) throw new Error('Expo Push receipt is not available yet');
  await pool.query(
    `UPDATE "NotificationDelivery"
     SET status = $2, "deliveredAt" = $3, error = $4, attempts = attempts + 1, "lastAttemptAt" = NOW()
     WHERE id = $1`,
    [
      deliveryId,
      receipt.status === 'ok' ? 'DELIVERED' : 'FAILED',
      receipt.status === 'ok' ? new Date() : null,
      receipt.message ?? null,
    ],
  );
  if (receipt.details?.error === 'DeviceNotRegistered' && subscriptionId) {
    await pool.query(
      `UPDATE "PushSubscription" SET enabled = false, "updatedAt" = NOW() WHERE id = $1`,
      [subscriptionId],
    );
  }
}

async function complete(row: OutboxRow): Promise<void> {
  await pool.query(
    `UPDATE "OutboxMessage" SET status = 'COMPLETED', "processedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`,
    [row.id],
  );
}

async function fail(row: OutboxRow, error: unknown): Promise<void> {
  const seconds = Math.min(3600, 2 ** Math.min(row.attempts + 1, 10));
  await pool.query(
    `UPDATE "OutboxMessage" SET status = 'FAILED', "lastError" = $2, "availableAt" = NOW() + ($3 || ' seconds')::interval, "updatedAt" = NOW() WHERE id = $1`,
    [row.id, error instanceof Error ? error.message : String(error), seconds],
  );
}

async function enqueueWebhook(homeId: string, alertId: string, event: string): Promise<void> {
  await pool.query(
    `INSERT INTO "OutboxMessage" (id, "homeId", topic, payload, status, attempts, "availableAt", "createdAt", "updatedAt")
     VALUES
       (concat('outbox_', gen_random_uuid()), $1, 'webhook', jsonb_build_object('event', $2, 'alertId', $3), 'PENDING', 0, NOW(), NOW(), NOW()),
       (concat('outbox_', gen_random_uuid()), $1, 'push', jsonb_build_object('event', $2, 'alertId', $3), 'PENDING', 0, NOW(), NOW(), NOW())`,
    [homeId, event, alertId],
  );
}

async function syncAlert(candidate: AlertCandidate): Promise<void> {
  const existing = await pool.query<{ id: string; status: string }>(
    `SELECT id, status FROM "Alert"
     WHERE "homeId" = $1 AND "ruleKey" = $2 AND status IN ('OPEN', 'ACKNOWLEDGED')
     ORDER BY "openedAt" DESC LIMIT 1`,
    [candidate.homeId, candidate.ruleKey],
  );
  const current = existing.rows[0];
  if (candidate.active) {
    if (current) {
      await pool.query(
        `UPDATE "Alert" SET severity = $2, title = $3, explanation = $4, "updatedAt" = NOW()
         WHERE id = $1`,
        [current.id, candidate.severity, candidate.title, candidate.explanation],
      );
      return;
    }
    const created = await pool.query<{ id: string }>(
      `INSERT INTO "Alert" (id, "homeId", type, severity, status, title, explanation, "ruleKey", "openedAt", "createdAt", "updatedAt")
       VALUES (concat('alert_', gen_random_uuid()), $1, $2, $3, 'OPEN', $4, $5, $6, NOW(), NOW(), NOW()) RETURNING id`,
      [
        candidate.homeId,
        candidate.type,
        candidate.severity,
        candidate.title,
        candidate.explanation,
        candidate.ruleKey,
      ],
    );
    await enqueueWebhook(candidate.homeId, created.rows[0]!.id, 'alert.opened');
    return;
  }
  if (!current) return;
  await pool.query(
    `UPDATE "Alert" SET status = 'RESOLVED', "resolvedAt" = NOW(), "updatedAt" = NOW()
     WHERE id = $1`,
    [current.id],
  );
  await pool.query(
    `INSERT INTO "AlertTransition" (id, "alertId", "userId", "from", "to", note, "createdAt")
     VALUES (concat('transition_', gen_random_uuid()), $1, NULL, $2::"AlertStatus", 'RESOLVED', 'Retour automatique à la normale', NOW())`,
    [current.id, current.status],
  );
  await enqueueWebhook(candidate.homeId, current.id, 'alert.resolved');
}

function parseRules(settings: unknown): AlertRuleSettings {
  const candidate = (settings as { alertRules?: unknown } | null)?.alertRules;
  const parsed = alertRuleSettingsSchema.safeParse(candidate);
  return parsed.success ? parsed.data : DEFAULT_ALERT_RULE_SETTINGS;
}

async function evaluateSensorRules(): Promise<void> {
  const now = new Date();
  const homes = await pool.query<{ homeId: string; timezone: string; settings: unknown }>(
    `SELECT h.id AS "homeId", h.timezone,
      (SELECT c.settings FROM "ConfigurationRevision" c WHERE c."homeId" = h.id ORDER BY c.version DESC LIMIT 1) AS settings
     FROM "Home" h`,
  );
  for (const home of homes.rows) {
    const rules = parseRules(home.settings);
    const sensors = await pool.query<{
      id: string;
      entityId: string;
      name: string;
      capability: string;
      status: string;
      lastSeenAt: Date | null;
      roomName: string | null;
      payload: unknown;
      occurredAt: Date | null;
    }>(
      `SELECT s.id, s."entityId", COALESCE(d.name, s."entityId") AS name, s.capability,
        s.status, s."lastSeenAt", r.name AS "roomName", latest.payload, latest."occurredAt"
       FROM "Sensor" s
       LEFT JOIN "Device" d ON d.id = s."deviceId"
       LEFT JOIN "Room" r ON r.id = s."roomId"
       LEFT JOIN LATERAL (
         SELECT e.payload, e."occurredAt" FROM "ObservationEvent" e
         WHERE e."sensorId" = s.id ORDER BY e."occurredAt" DESC LIMIT 1
       ) latest ON true
       WHERE s."homeId" = $1`,
      [home.homeId],
    );
    for (const sensor of sensors.rows) {
      const stale = isStale(sensor.lastSeenAt, now, rules.sensorOffline.minutes);
      if (stale && sensor.status !== 'OFFLINE') {
        await pool.query(
          `UPDATE "Sensor" SET status = 'OFFLINE', "updatedAt" = NOW() WHERE id = $1`,
          [sensor.id],
        );
      }
      await syncAlert({
        homeId: home.homeId,
        ruleKey: `sensor-offline:${sensor.id}`,
        type: 'SENSOR_OFFLINE',
        severity: 'ATTENTION',
        active: rules.sensorOffline.enabled && stale,
        title: `${sensor.name} ne répond plus`,
        explanation: `${sensor.roomName ?? 'Ce capteur'} n’a transmis aucune donnée depuis plus de ${rules.sensorOffline.minutes} minutes. Élise suspend les conclusions qui en dépendent.`,
      });

      if (sensor.capability === 'contact') {
        await syncAlert({
          homeId: home.homeId,
          ruleKey: `door-open:${sensor.id}`,
          type: 'DOOR_OPEN',
          severity: 'ATTENTION',
          active:
            rules.doorOpen.enabled &&
            !stale &&
            isDoorOpenTooLong(sensor.payload, sensor.occurredAt, now, rules.doorOpen.minutes),
          title: `${sensor.roomName ?? 'Une porte'} est restée ouverte`,
          explanation: `L’ouverture dure depuis plus de ${rules.doorOpen.minutes} minutes. Une vérification simple peut être utile.`,
        });
      }

      if (sensor.capability === 'battery') {
        const battery = numericPayload(sensor.payload);
        await syncAlert({
          homeId: home.homeId,
          ruleKey: `low-battery:${sensor.id}`,
          type: 'LOW_BATTERY',
          severity: 'INFO',
          active:
            rules.lowBattery.enabled && battery !== null && battery <= rules.lowBattery.percent,
          title: `Batterie faible pour ${sensor.name}`,
          explanation:
            battery === null
              ? 'Le niveau de batterie est momentanément indisponible.'
              : `La batterie indique ${battery} %. Son remplacement peut être planifié.`,
        });
      }
    }

    const temperatures = await pool.query<{
      sensorId: string;
      entityId: string;
      roomName: string | null;
      occurredAt: Date;
      payload: unknown;
    }>(
      `SELECT e."sensorId", s."entityId", r.name AS "roomName", e."occurredAt", e.payload
       FROM "ObservationEvent" e
       JOIN "Sensor" s ON s.id = e."sensorId"
       LEFT JOIN "Room" r ON r.id = s."roomId"
       WHERE e."homeId" = $1 AND e.capability = 'temperature'
         AND e."occurredAt" >= NOW() - INTERVAL '24 hours'
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
    for (const [sensorId, readings] of bySensor) {
      const values = readings
        .map((reading) => ({
          occurredAt: reading.occurredAt,
          value: numericPayload(reading.payload),
        }))
        .filter(
          (reading): reading is { occurredAt: Date; value: number } => reading.value !== null,
        );
      const first = readings[0]!;
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
        ruleKey: `temperature-low:${sensorId}`,
        type: 'TEMPERATURE',
        severity: 'ATTENTION',
        active: rules.lowTemperature.enabled && low.active,
        title: `Température basse dans ${first.roomName ?? 'le logement'}`,
        explanation: `La température est à ${low.latest ?? '—'} °C, sous le seuil de ${rules.lowTemperature.celsius} °C depuis au moins ${rules.lowTemperature.minutes} minutes.`,
      });
      await syncAlert({
        homeId: home.homeId,
        ruleKey: `temperature-high:${sensorId}`,
        type: 'TEMPERATURE',
        severity: 'ATTENTION',
        active: rules.highTemperature.enabled && high.active,
        title: `Température élevée dans ${first.roomName ?? 'le logement'}`,
        explanation: `La température est à ${high.latest ?? '—'} °C, au-dessus du seuil de ${rules.highTemperature.celsius} °C depuis au moins ${rules.highTemperature.minutes} minutes.`,
      });
    }

    const nightEvents = await pool.query<{ occurredAt: Date }>(
      `SELECT "occurredAt" FROM "ObservationEvent"
       WHERE "homeId" = $1 AND capability IN ('motion', 'occupancy')
         AND "occurredAt" >= NOW() - INTERVAL '24 hours'`,
      [home.homeId],
    );
    const nightCount = countNightActivity(
      nightEvents.rows.map((event) => event.occurredAt),
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

async function evaluateInactivity(): Promise<void> {
  const homes = await pool.query<{
    homeId: string;
    lastActivity: Date | null;
    inactivityMinutes: number;
    inactivityEnabled: boolean;
    activeSensors: number;
  }>(
    `SELECT h.id AS "homeId", MAX(e."occurredAt") AS "lastActivity",
      COALESCE((SELECT (c.settings#>>'{alertRules,inactivity,minutes}')::int FROM "ConfigurationRevision" c WHERE c."homeId" = h.id ORDER BY version DESC LIMIT 1),
        (SELECT (c.settings->>'inactivityMinutes')::int FROM "ConfigurationRevision" c WHERE c."homeId" = h.id ORDER BY version DESC LIMIT 1), 180) AS "inactivityMinutes",
      COALESCE((SELECT (c.settings#>>'{alertRules,inactivity,enabled}')::boolean FROM "ConfigurationRevision" c WHERE c."homeId" = h.id ORDER BY version DESC LIMIT 1), true) AS "inactivityEnabled",
      (SELECT COUNT(*)::int FROM "Sensor" s WHERE s."homeId" = h.id AND s.status = 'ONLINE') AS "activeSensors"
     FROM "Home" h LEFT JOIN "ObservationEvent" e ON e."homeId" = h.id AND e.capability IN ('motion', 'occupancy', 'contact') GROUP BY h.id`,
  );
  for (const home of homes.rows) {
    if (home.activeSensors === 0) {
      await syncAlert({
        homeId: home.homeId,
        ruleKey: 'coverage',
        type: 'SYSTEM',
        severity: 'ATTENTION',
        active: true,
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
    const inactive =
      !home.lastActivity ||
      Date.now() - home.lastActivity.getTime() >= home.inactivityMinutes * 60_000;
    await syncAlert({
      homeId: home.homeId,
      ruleKey: 'inactivity',
      type: 'INACTIVITY',
      severity: 'ATTENTION',
      active: home.inactivityEnabled && inactive,
      title: 'Aucune activité récente',
      explanation: `Aucun mouvement fiable n’a été observé depuis plus de ${home.inactivityMinutes} minutes.`,
    });
  }
}

async function evaluateMedicationDoses(): Promise<void> {
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
     WHERE dose.status = 'PENDING' AND dose."scheduledFor" <= NOW()`,
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
     WHERE dose.status = 'MISSED'
       AND dose."scheduledFor" >= NOW() - INTERVAL '48 hours'`,
  );
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
}

async function applyRetention(): Promise<void> {
  await pool.query(
    `DELETE FROM "ObservationEvent" WHERE "occurredAt" < NOW() - INTERVAL '90 days'`,
  );
  await pool.query(
    `DELETE FROM "OutboxMessage" WHERE status = 'COMPLETED' AND "processedAt" < NOW() - INTERVAL '30 days'`,
  );
  await pool.query(
    `DELETE FROM "JournalEntry" WHERE kind = 'DAILY_SUMMARY' AND "occurredAt" < NOW() - INTERVAL '2 years'`,
  );
  await pool.query(`DELETE FROM "AuditLog" WHERE "createdAt" < NOW() - INTERVAL '30 days'`);
  await pool.query(
    `DELETE FROM "NotificationDelivery" WHERE "createdAt" < NOW() - INTERVAL '30 days'`,
  );
}

async function trainEligibleHomes(): Promise<void> {
  const homes = await pool.query<{ homeId: string }>(
    `SELECT h.id AS "homeId"
     FROM "Home" h
     WHERE h."learningStartedAt" <= NOW() - INTERVAL '14 days'
       AND NOT EXISTS (
         SELECT 1 FROM "ModelArtifact" m
         WHERE m."homeId" = h.id AND m.active = true AND m."createdAt" > NOW() - INTERVAL '7 days'
       )`,
  );
  for (const home of homes.rows) {
    const observations = await pool.query<{
      occurredAt: Date;
      capability: string;
      quality: string;
    }>(
      `SELECT "occurredAt", capability, quality
       FROM "ObservationEvent"
       WHERE "homeId" = $1 AND "occurredAt" >= NOW() - INTERVAL '28 days'
       ORDER BY "occurredAt" ASC`,
      [home.homeId],
    );
    if (observations.rowCount === null || observations.rowCount < 96) continue;
    const first = observations.rows[0]!.occurredAt;
    const last = observations.rows.at(-1)!.occurredAt;
    const daysCovered = Math.floor((last.getTime() - first.getTime()) / 86_400_000) + 1;
    if (daysCovered < 14) continue;
    const trained = await ai.train({
      home_id: home.homeId,
      days_covered: daysCovered,
      samples: observations.rows.map((event) =>
        eventFeatures(event.occurredAt, event.capability, event.quality),
      ),
    });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE "ModelArtifact" SET active = false WHERE "homeId" = $1`, [
        home.homeId,
      ]);
      await client.query(
        `INSERT INTO "ModelArtifact" (id, "homeId", version, algorithm, path, sha256, "trainedFrom", "trainedTo", metrics, active, "createdAt")
         VALUES (concat('model_', gen_random_uuid()), $1, $2, 'isolation-forest', $3, $4, $5, $6, $7::jsonb, true, NOW())
         ON CONFLICT ("homeId", version) DO UPDATE SET active = true, metrics = EXCLUDED.metrics`,
        [
          home.homeId,
          trained.model_version,
          `michel-ai://${home.homeId}/${trained.model_version}`,
          trained.sha256,
          first,
          last,
          JSON.stringify({ samples: trained.samples, daysCovered }),
        ],
      );
      await client.query(
        `UPDATE "HabitProfile" SET "validTo" = NOW()
         WHERE "homeId" = $1 AND kind = 'routine' AND "validTo" IS NULL`,
        [home.homeId],
      );
      await client.query(
        `INSERT INTO "HabitProfile" (id, "homeId", kind, status, parameters, confidence, "validFrom", "createdAt")
         VALUES (concat('habit_', gen_random_uuid()), $1, 'routine', $2, $3::jsonb, $4, NOW(), NOW())`,
        [
          home.homeId,
          LEARNED_HABIT_STATUS,
          JSON.stringify({ modelVersion: trained.model_version, samples: trained.samples }),
          Math.min(1, trained.samples / (14 * 96)),
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

let running = true;
process.on('SIGTERM', () => {
  running = false;
});
process.on('SIGINT', () => {
  running = false;
});

async function main(): Promise<void> {
  let lastInactivityCheck = 0;
  let lastMedicationCheck = 0;
  let lastRuleCheck = 0;
  let lastRetentionRun = 0;
  let lastTrainingRun = 0;
  while (running) {
    if (Date.now() - lastRuleCheck > 60_000) {
      await evaluateSensorRules();
      lastRuleCheck = Date.now();
    }
    if (Date.now() - lastInactivityCheck > 60_000) {
      await evaluateInactivity();
      lastInactivityCheck = Date.now();
    }
    if (Date.now() - lastMedicationCheck > 60_000) {
      await evaluateMedicationDoses();
      lastMedicationCheck = Date.now();
    }
    if (Date.now() - lastRetentionRun > 86_400_000) {
      await applyRetention();
      lastRetentionRun = Date.now();
    }
    if (Date.now() - lastTrainingRun > 86_400_000) {
      await trainEligibleHomes();
      lastTrainingRun = Date.now();
    }
    const row = await claim();
    if (!row) {
      await delay(1_000);
      continue;
    }
    try {
      if (row.topic === 'ai.score') await handleAi(row);
      if (row.topic === 'webhook') await handleWebhook(row);
      if (row.topic === 'push') await handlePush(row);
      if (row.topic === 'push.receipt') await handlePushReceipt(row);
      await complete(row);
    } catch (error) {
      await fail(row, error);
    }
  }
  await pool.end();
}

void main();
