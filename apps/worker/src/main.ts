import { createHmac } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MichelAiClient } from '@michel/ai-client';
import {
  alertRuleSettingsSchema,
  DEFAULT_ALERT_RULE_SETTINGS,
  type AlertRuleSettings,
} from '@michel/contracts';
import pg from 'pg';
import type { PoolClient } from 'pg';
import { LEARNED_HABIT_STATUS } from './policy.js';
import { isDosePastConfirmationWindow, missedDoseCopy } from './medication-rules.js';
import {
  clearanceConfirmed,
  countCurrentNightActivity,
  isDoorOpenTooLong,
  isUnavailableLongEnough,
  numericPayload,
  persistentTemperatureViolation,
  sensorCoverageState,
  shouldOpenInactivityAlert,
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
  roomId?: string | null;
  ruleKey: string;
  type: AlertType;
  severity: AlertSeverity;
  active: boolean;
  title: string;
  explanation: string;
}

function stableBucket(value: string | null, buckets = 8): number {
  if (!value) return -1;
  let hash = 5381;
  for (const character of value) hash = (hash * 33) ^ character.charCodeAt(0);
  return Math.abs(hash) % buckets;
}

function sessionFeatures(session: {
  startedAt: Date;
  durationSeconds: number;
  dailyTotalSeconds: number;
  roomId: string;
  previousRoomId: string | null;
  source: string;
  confidence: string;
  plausibleTransition: boolean | null;
}) {
  const hour = session.startedAt.getUTCHours() + session.startedAt.getUTCMinutes() / 60;
  const day = session.startedAt.getUTCDay();
  const roomBucket = stableBucket(session.roomId);
  const previousBucket = stableBucket(session.previousRoomId);
  return {
    hour_sin: Math.sin((hour / 24) * Math.PI * 2),
    hour_cos: Math.cos((hour / 24) * Math.PI * 2),
    weekday_sin: Math.sin((day / 7) * Math.PI * 2),
    weekday_cos: Math.cos((day / 7) * Math.PI * 2),
    log_duration: Math.log1p(session.durationSeconds),
    daily_total_hours: session.dailyTotalSeconds / 3_600,
    source_sensor: session.source === 'SENSOR' ? 1 : 0,
    source_camera: session.source === 'CAMERA' ? 1 : 0,
    source_combined: session.source === 'COMBINED' ? 1 : 0,
    confidence: session.confidence === 'HIGH' ? 1 : session.confidence === 'MEDIUM' ? 0.6 : 0.2,
    plausible_transition:
      session.plausibleTransition === null ? 0.5 : session.plausibleTransition ? 1 : 0,
    ...Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => [`room_${index}`, index === roomBucket ? 1 : 0]),
    ),
    ...Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => [
        `previous_room_${index}`,
        index === previousBucket ? 1 : 0,
      ]),
    ),
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
       ORDER BY CASE WHEN topic = 'camera.recording' THEN 0 ELSE 1 END, "createdAt" ASC
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
  const activeModel = await pool.query<{ algorithm: string }>(
    `SELECT algorithm FROM "ModelArtifact" WHERE "homeId" = $1 AND active = true
     ORDER BY "createdAt" DESC LIMIT 1`,
    [row.homeId],
  );
  if (activeModel.rows[0]?.algorithm === 'isolation-forest-session-v2') return;
  const score = await ai.score(row.payload);
  await pool.query(
    `INSERT INTO "AnomalyEvaluation" (id, "homeId", "modelVersion", score, confidence, factors, "evaluatedAt")
     VALUES (concat('eval_', gen_random_uuid()), $1, $2, $3, $4, $5::jsonb, NOW())`,
    [row.homeId, score.model_version, score.score, score.confidence, JSON.stringify(score.factors)],
  );
  // The raw-event model remains in shadow mode until session-based features have
  // completed their comparison period. Core deliberately creates no alert here.
}

async function handleWebhook(row: OutboxRow): Promise<void> {
  const url = process.env.WEBHOOK_URL;
  const secret = process.env.WEBHOOK_SECRET;
  if (!url || !secret) return;
  const alertId = typeof row.payload.alertId === 'string' ? row.payload.alertId : null;
  const event = typeof row.payload.event === 'string' ? row.payload.event : null;
  if (!alertId || !event) return;
  const result = await pool.query<{
    id: string;
    type: string;
    severity: string;
    status: string;
    title: string;
    explanation: string;
    confidence: number | null;
    openedAt: Date;
    resolvedAt: Date | null;
  }>(
    `SELECT id, type, severity, status, title, explanation, confidence, "openedAt", "resolvedAt"
     FROM "Alert" WHERE id = $1 AND "homeId" = $2`,
    [alertId, row.homeId],
  );
  const alert = result.rows[0];
  if (!alert) return;
  const body = JSON.stringify({
    schemaVersion: '1.0',
    deliveryId: row.id,
    occurredAt: new Date().toISOString(),
    event,
    alert: {
      ...alert,
      openedAt: alert.openedAt.toISOString(),
      resolvedAt: alert.resolvedAt?.toISOString() ?? null,
    },
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
  const excludedUserId =
    typeof row.payload.excludeUserId === 'string' ? row.payload.excludeUserId : null;
  const liaisonId = typeof row.payload.liaisonId === 'string' ? row.payload.liaisonId : null;
  let title =
    typeof row.payload.title === 'string' ? row.payload.title : 'Nouvelle information Élise';
  let body =
    typeof row.payload.body === 'string'
      ? row.payload.body
      : 'Ouvrez Élise pour consulter la situation.';
  let severity: string | null = null;
  let preferenceColumn: string | null = null;
  if (alertId) {
    const alert = await pool.query<{
      severity: string;
      status: string;
      type: string;
      title: string;
    }>(`SELECT severity, status, type, title FROM "Alert" WHERE id = $1 AND "homeId" = $2`, [
      alertId,
      row.homeId,
    ]);
    if (!alert.rows[0]) return;
    if (
      row.payload.event === 'alert.opened' &&
      !['OPEN', 'ACKNOWLEDGED'].includes(alert.rows[0].status)
    )
      return;
    preferenceColumn =
      {
        FALL_DETECTION: 'fallDetection',
        SMOKE: 'smoke',
        WATER_LEAK: 'waterLeak',
      }[alert.rows[0].type] ?? null;
    // Alert types without a user preference (SOS, CO, inactivity…) are always pushed.
    severity = alert.rows[0].severity;
    title = alert.rows[0].title
      ? `Élise · ${alert.rows[0].title}`
      : severity === 'URGENT'
        ? 'Élise · Attention requise'
        : 'Élise · Nouvelle information';
    body = 'Une situation a été détectée au domicile. Ouvrez Élise pour les détails.';
  } else if (liaisonId) {
    const preference = row.payload.preference;
    if (preference !== 'liaisonMessages' && preference !== 'liaisonMoods') return;
    preferenceColumn = preference;
    title =
      preference === 'liaisonMoods'
        ? 'Élise · Nouvelle humeur dans le carnet'
        : 'Élise · Nouveau message dans le carnet';
    body = 'Ouvrez Élise pour consulter le carnet de liaison.';
  }

  const bypassPreferences = row.payload.kind === 'test';
  const preferenceFilter =
    preferenceColumn && !bypassPreferences
      ? `AND COALESCE(np."${preferenceColumn}", true) = true`
      : '';
  const subscriptions = await pool.query<PushSubscriptionRow>(
    `SELECT DISTINCT ps.id, ps."expoPushToken"
     FROM "PushSubscription" ps
     JOIN "User" u ON u.id = ps."userId"
     JOIN "Session" se ON se.id = ps."sessionId" AND se."userId" = u.id
     JOIN "Membership" m ON m."userId" = u.id
     JOIN "Home" h ON h."organizationId" = m."organizationId"
     LEFT JOIN "NotificationPreference" np ON np."userId" = u.id
     WHERE h.id = $1 AND ps.enabled = true AND m."disabledAt" IS NULL
       AND se."expiresAt" > NOW()
       AND ($2::text IS NULL OR ps."userId" = $2)
       AND ($3::text IS NULL OR ps."userId" <> $3)
       ${preferenceFilter}`,
    [row.homeId, requestedUserId, excludedUserId],
  );
  if (subscriptions.rows.length === 0) return;

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
        data: {
          kind: alertId ? 'alert' : (row.payload.kind ?? 'system'),
          ...(alertId ? { alertId } : {}),
          ...(liaisonId ? { liaisonId } : {}),
          severity,
        },
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
           jsonb_build_object('deliveryId', $2::text, 'ticketId', $3::text, 'subscriptionId', $4::text),
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

async function enqueueWebhook(
  client: PoolClient,
  homeId: string,
  alertId: string,
  event: string,
): Promise<void> {
  await client.query(
    `INSERT INTO "OutboxMessage" (id, "homeId", topic, payload, status, attempts, "availableAt", "createdAt", "updatedAt")
     VALUES
       (concat('outbox_', gen_random_uuid()), $1, 'webhook', jsonb_build_object('event', $2::text, 'alertId', $3::text), 'PENDING', 0, NOW(), NOW(), NOW())`,
    [homeId, event, alertId],
  );
  if (event === 'alert.opened') {
    await client.query(
      `INSERT INTO "OutboxMessage" (id, "homeId", topic, payload, status, attempts, "availableAt", "createdAt", "updatedAt")
       VALUES (concat('outbox_', gen_random_uuid()), $1, 'push', jsonb_build_object('event', $2::text, 'alertId', $3::text), 'PENDING', 0, NOW(), NOW(), NOW())`,
      [homeId, event, alertId],
    );
    await client.query(
      `INSERT INTO "OutboxMessage" (id, "homeId", topic, payload, status, attempts, "availableAt", "createdAt", "updatedAt")
       VALUES (concat('outbox_', gen_random_uuid()), $1, 'camera.snapshot', jsonb_build_object('alertId', $2::text), 'PENDING', 0, NOW(), NOW(), NOW())`,
      [homeId, alertId],
    );
  }
}

async function syncAlert(candidate: AlertCandidate): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `${candidate.homeId}:${candidate.ruleKey}`,
    ]);
    await syncAlertLocked(client, candidate);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function syncAlertLocked(client: PoolClient, candidate: AlertCandidate): Promise<void> {
  // For an open alert, conditionClearedAt starts a two-minute normal-state check.
  // For a closed alert, it prevents re-opening until the condition has really cleared.
  const now = new Date();
  const existing = await client.query<{
    id: string;
    status: string;
    conditionClearedAt: Date | null;
  }>(
    `SELECT id, status, "conditionClearedAt" FROM "Alert"
     WHERE "homeId" = $1 AND "ruleKey" = $2
     ORDER BY "openedAt" DESC LIMIT 1 FOR UPDATE`,
    [candidate.homeId, candidate.ruleKey],
  );
  const current = existing.rows[0];
  if (candidate.active) {
    if (current && ['OPEN', 'ACKNOWLEDGED'].includes(current.status)) {
      await client.query(
        `UPDATE "Alert" SET severity = $2, title = $3, explanation = $4, "conditionClearedAt" = NULL, "updatedAt" = NOW()
         WHERE id = $1 AND status IN ('OPEN', 'ACKNOWLEDGED')`,
        [current.id, candidate.severity, candidate.title, candidate.explanation],
      );
      return;
    }
    if (current && !clearanceConfirmed(current.conditionClearedAt, now)) {
      if (current.conditionClearedAt)
        await client.query(
          `UPDATE "Alert" SET "conditionClearedAt" = NULL, "updatedAt" = NOW() WHERE id = $1`,
          [current.id],
        );
      return;
    }
    const created = await client.query<{ id: string }>(
      `INSERT INTO "Alert" (id, "homeId", "roomId", type, severity, status, title, explanation, "ruleKey", "openedAt", "createdAt", "updatedAt")
       VALUES (concat('alert_', gen_random_uuid()), $1, $2, $3, $4, 'OPEN', $5, $6, $7, NOW(), NOW(), NOW()) RETURNING id`,
      [
        candidate.homeId,
        candidate.roomId ?? null,
        candidate.type,
        candidate.severity,
        candidate.title,
        candidate.explanation,
        candidate.ruleKey,
      ],
    );
    await enqueueWebhook(client, candidate.homeId, created.rows[0]!.id, 'alert.opened');
    return;
  }
  if (!current) return;
  if (!['OPEN', 'ACKNOWLEDGED'].includes(current.status)) {
    if (!current.conditionClearedAt)
      await client.query(
        `UPDATE "Alert" SET "conditionClearedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1 AND "conditionClearedAt" IS NULL`,
        [current.id],
      );
    return;
  }
  if (!current.conditionClearedAt) {
    await client.query(
      `UPDATE "Alert" SET "conditionClearedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1 AND "conditionClearedAt" IS NULL`,
      [current.id],
    );
    return;
  }
  if (!clearanceConfirmed(current.conditionClearedAt, now)) return;
  const resolved = await client.query<{ id: string }>(
    `UPDATE "Alert" SET status = 'RESOLVED', "resolvedAt" = NOW(), "updatedAt" = NOW()
     WHERE id = $1 AND status IN ('OPEN', 'ACKNOWLEDGED') RETURNING id`,
    [current.id],
  );
  if (resolved.rowCount !== 1) return;
  await client.query(
    `INSERT INTO "AlertTransition" (id, "alertId", "userId", "from", "to", note, "createdAt")
     VALUES (concat('transition_', gen_random_uuid()), $1, NULL, $2::"AlertStatus", 'RESOLVED', 'Retour automatique à la normale', NOW())`,
    [current.id, current.status],
  );
  await enqueueWebhook(client, candidate.homeId, current.id, 'alert.resolved');
}

async function captureAlertSnapshot(homeId: string, alertId: string): Promise<void> {
  const alert = await pool.query<{ roomId: string | null }>(
    `SELECT "roomId" FROM "Alert" WHERE id = $1 AND "homeId" = $2`,
    [alertId, homeId],
  );
  const roomId = alert.rows[0]?.roomId;
  if (!roomId) return;
  const result = await pool.query<{ id: string; streamKey: string }>(
    `SELECT id, "streamKey" FROM "Camera"
     WHERE "homeId" = $1 AND "roomId" = $2 AND "snapshotEnabled" = true
       AND "privacyMode" = false AND "consentedAt" IS NOT NULL
       AND status IN ('ONLINE', 'DEGRADED')
     ORDER BY "createdAt" ASC LIMIT 1`,
    [homeId, roomId],
  );
  const camera = result.rows[0];
  if (!camera) return;
  const go2rtc = process.env.GO2RTC_URL ?? 'http://go2rtc:1984';
  const query = new URLSearchParams({ src: camera.streamKey });
  const response = await fetch(`${go2rtc}/api/frame.jpeg?${query}`);
  if (!response.ok) throw new Error(`Snapshot service returned ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024) {
    throw new Error('Snapshot has an invalid size');
  }
  const root = path.resolve(process.env.CAMERA_MEDIA_ROOT ?? '/var/lib/elise/camera-media');
  const directory = path.join(root, homeId);
  await fs.mkdir(directory, { recursive: true });
  const relativePath = path.join(homeId, `${alertId}-${camera.id}.jpg`);
  await fs.writeFile(path.join(root, relativePath), bytes, { mode: 0o600 });
  await pool.query(
    `INSERT INTO "CameraSnapshot"
     (id, "homeId", "cameraId", "alertId", path, "mimeType", "sizeBytes", "capturedAt", "expiresAt", "createdAt")
     VALUES (concat('snapshot_', gen_random_uuid()), $1, $2, $3, $4, 'image/jpeg', $5, NOW(), NOW() + INTERVAL '24 hours', NOW())
     ON CONFLICT ("alertId", "cameraId") DO NOTHING`,
    [homeId, camera.id, alertId, relativePath, bytes.length],
  );
}

async function recordMainEntranceOpening(
  homeId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const cameraId = typeof payload.cameraId === 'string' ? payload.cameraId : '';
  const sourceEventId = typeof payload.sourceEventId === 'string' ? payload.sourceEventId : '';
  const outboxId = typeof payload.outboxId === 'string' ? payload.outboxId : '';
  if (!cameraId || !sourceEventId || !outboxId) throw new Error('Recording request is incomplete');

  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM "CameraRecording" WHERE "outboxId" = $1`,
    [outboxId],
  );
  if (existing.rowCount) return;

  const cameraResult = await pool.query<{
    id: string;
    streamKey: string;
    name: string;
    roomId: string | null;
    roomName: string | null;
  }>(
    `SELECT c.id, c."streamKey", c.name, c."roomId", r.name AS "roomName"
     FROM "Camera" c
     LEFT JOIN "Room" r ON r.id = c."roomId"
     WHERE c.id = $1 AND c."homeId" = $2 AND c."liveEnabled" = true
       AND c."privacyMode" = false AND c."consentedAt" IS NOT NULL
       AND c.status IN ('ONLINE', 'DEGRADED')`,
    [cameraId, homeId],
  );
  const camera = cameraResult.rows[0];
  if (!camera) return;

  const durationSeconds = 30;
  const query = new URLSearchParams({
    src: camera.streamKey,
    duration: String(durationSeconds),
    video: 'all',
    audio: '',
  });
  const go2rtc = process.env.GO2RTC_URL ?? 'http://go2rtc:1984';
  const response = await fetch(`${go2rtc}/api/stream.mp4?${query}`, {
    signal: AbortSignal.timeout((durationSeconds + 20) * 1_000),
  });
  if (!response.ok) throw new Error(`Camera recording service returned ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1_024 || bytes.length > 100 * 1024 * 1024) {
    throw new Error('Camera recording has an invalid size');
  }

  const root = path.resolve(process.env.CAMERA_MEDIA_ROOT ?? '/var/lib/elise/camera-media');
  const safeHomeId = homeId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeOutboxId = outboxId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `entrance-${safeOutboxId}.mp4`;
  const directory = path.join(root, 'recordings', safeHomeId);
  const relativePath = path.join('recordings', safeHomeId, filename);
  const absolutePath = path.join(root, relativePath);
  const partialPath = `${absolutePath}.partial`;
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(partialPath, bytes, { mode: 0o600 });
    await fs.rename(partialPath, absolutePath);
    const triggeredAt =
      typeof payload.triggeredAt === 'string' && Number.isFinite(Date.parse(payload.triggeredAt))
        ? new Date(payload.triggeredAt)
        : new Date();
    const doorName = typeof payload.doorName === 'string' ? payload.doorName : 'Entrée principale';
    await pool.query(
      `INSERT INTO "CameraRecording"
       (id, "homeId", "cameraId", "roomId", "outboxId", "sourceEventId", "cameraName", "roomName", "doorName", path, "mimeType", "sizeBytes", "durationSeconds", "capturedAt", "expiresAt", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'video/mp4', $11, $12, $13, NOW() + INTERVAL '24 hours', NOW())
       ON CONFLICT ("outboxId") DO NOTHING`,
      [
        `recording_${safeOutboxId}`,
        homeId,
        camera.id,
        typeof payload.roomId === 'string' ? payload.roomId : camera.roomId,
        outboxId,
        sourceEventId,
        camera.name,
        camera.roomName,
        doorName,
        relativePath,
        bytes.length,
        durationSeconds,
        triggeredAt,
      ],
    );
  } catch (error) {
    await fs.rm(partialPath, { force: true });
    await fs.rm(absolutePath, { force: true });
    throw error;
  }
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
    const evaluatedSensorKeys = new Set<string>();
    const sensors = await pool.query<{
      id: string;
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
      `SELECT s.id, s."entityId", COALESCE(d.name, s."entityId") AS name, s.capability,
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
        await syncAlert({
          homeId: home.homeId,
          roomId: sensor.roomId,
          ruleKey: `low-battery:${sensor.id}`,
          type: 'LOW_BATTERY',
          severity: 'INFO',
          active:
            rules.lowBattery.enabled &&
            sensor.available &&
            sensor.status === 'ONLINE' &&
            battery !== null &&
            battery >= 0 &&
            battery <= rules.lowBattery.percent,
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

async function resolveClearedSecurityAlerts(): Promise<void> {
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

async function evaluateInactivity(): Promise<void> {
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
  await pool.query(
    `DELETE FROM "RoomPresenceSession" WHERE "startedAt" < NOW() - INTERVAL '90 days'`,
  );
  await pool.query(
    `DELETE FROM "PresenceTransitionDecision" WHERE "occurredAt" < NOW() - INTERVAL '90 days'`,
  );
  await pool.query(
    `DELETE FROM "RoomDailyPresenceAggregate" WHERE "localDate" < NOW() - INTERVAL '2 years'`,
  );
}

async function maintainTopologicalPresence(): Promise<void> {
  if (process.env.TOPOLOGY_TRACKING_ENABLED === 'false') return;
  const pending = await pool.query<{
    id: string;
    homeId: string;
    residentId: string | null;
    confirmedRoomId: string;
    candidateRoomId: string;
    pathRoomIds: unknown;
    transitionStartedAt: Date;
  }>(
    `SELECT id, "homeId", "residentId", "confirmedRoomId", "candidateRoomId",
       "pathRoomIds", "transitionStartedAt"
     FROM "PresenceTrackingState"
     WHERE status = 'IN_TRANSIT' AND "confirmedRoomId" IS NOT NULL
       AND "candidateRoomId" IS NOT NULL AND "transitionStartedAt" <= NOW() - INTERVAL '20 seconds'
       AND "transitionStartedAt" >= NOW() - INTERVAL '2 minutes'`,
  );
  for (const tracking of pending.rows) {
    const latest = await pool.query<{
      id: string;
      sensorId: string | null;
      capability: string;
      occurredAt: Date;
      active: boolean | null;
    }>(
      `SELECT e.id, e."sensorId", e.capability, e."occurredAt",
         CASE WHEN e.payload ? 'active' THEN (e.payload->>'active')::boolean ELSE NULL END AS active
       FROM "ObservationEvent" e
       WHERE e."homeId" = $1 AND e."roomId" = $2
         AND e.capability IN ('occupancy', 'person_presence')
         AND e."occurredAt" >= $3
       ORDER BY e."occurredAt" DESC, e.id DESC LIMIT 1`,
      [tracking.homeId, tracking.candidateRoomId, tracking.transitionStartedAt],
    );
    const proof = latest.rows[0];
    if (!proof?.active) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const promoted = await client.query(
        `UPDATE "PresenceTrackingState"
         SET status = 'CONFIRMED', "confirmedRoomId" = "candidateRoomId", "candidateRoomId" = NULL,
           "confidenceScore" = LEAST("confidenceScore", 0.82),
           "reasonCodes" = '["PERSISTENT_DESTINATION","INFERRED_PATH"]'::jsonb,
           "transitionStartedAt" = NULL, "updatedAt" = NOW()
         WHERE id = $1 AND status = 'IN_TRANSIT' RETURNING id`,
        [tracking.id],
      );
      if (!promoted.rowCount) {
        await client.query('ROLLBACK');
        continue;
      }
      await client.query(
        `UPDATE "RoomPresenceSession"
         SET state = 'CLOSED', "endedAt" = NOW(),
           "durationSeconds" = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - "startedAt"))::int),
           "endReason" = 'TRANSITION', "updatedAt" = NOW()
         WHERE "homeId" = $1 AND state = 'OPEN' AND "endedAt" IS NULL`,
        [tracking.homeId],
      );
      await client.query(
        `INSERT INTO "RoomPresenceSession"
          (id, "homeId", "residentId", "roomId", "sensorId", capability, "startedAt",
           "lastConfirmedAt", state, confidence, source, "entryEventId", "previousRoomId",
           "plausibleTransition", "excludedFromLearning", "ambiguousReason", "createdAt", "updatedAt")
         VALUES (concat('presence_', gen_random_uuid()), $1, $2, $3, $4, $5, $6, NOW(),
           'OPEN', 'MEDIUM', CASE WHEN $5 = 'person_presence' THEN 'CAMERA'::"PresenceSource" ELSE 'SENSOR'::"PresenceSource" END,
           $7, $8, false, true, 'INFERRED_PATH', NOW(), NOW())`,
        [
          tracking.homeId,
          tracking.residentId,
          tracking.candidateRoomId,
          proof.sensorId,
          proof.capability,
          proof.occurredAt,
          proof.id,
          tracking.confirmedRoomId,
        ],
      );
      await client.query(
        `INSERT INTO "PresenceTransitionDecision"
          (id, "homeId", "residentId", "fromRoomId", "toRoomId", "pathRoomIds", outcome,
           "confidenceScore", "reasonCodes", "evidenceSummary", explanation, "occurredAt", "confirmedAt", "createdAt")
         VALUES (concat('presence_decision_', gen_random_uuid()), $1, $2, $3, $4, $5::jsonb,
           'CONFIRMED', 0.82, '["PERSISTENT_DESTINATION","INFERRED_PATH"]'::jsonb,
           jsonb_build_array(jsonb_build_object('eventId', $6, 'sensorId', $7, 'roomId', $4,
             'capability', $8, 'occurredAt', $9, 'observed', true)),
           'Destination confirmée après une présence persistante de 20 secondes.', NOW(), NOW(), NOW())`,
        [
          tracking.homeId,
          tracking.residentId,
          tracking.confirmedRoomId,
          tracking.candidateRoomId,
          JSON.stringify(tracking.pathRoomIds),
          proof.id,
          proof.sensorId,
          proof.capability,
          proof.occurredAt.toISOString(),
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

  const activeStatefulSensor = `EXISTS (
    SELECT 1
    FROM "Sensor" s
    LEFT JOIN "Device" d ON d.id = s."deviceId"
    JOIN LATERAL (
      SELECT e.payload
      FROM "ObservationEvent" e
      WHERE e."sensorId" = s.id
        AND e.capability IN ('occupancy', 'person_presence')
      ORDER BY e."occurredAt" DESC, e.id DESC
      LIMIT 1
    ) latest ON true
    WHERE s."homeId" = tracking."homeId"
      AND s."roomId" = tracking."confirmedRoomId"
      AND s.capability IN ('occupancy', 'person_presence')
      AND s."analysisEnabled" = true
      AND s."removedAt" IS NULL
      AND s.available = true
      AND (s."deviceId" IS NULL OR (
        d.enabled = true
        AND (
          d."installationStatus" = 'OPERATIONAL'
          OR (d."installationStatus" = 'ATTENTION' AND d."placementConfirmedAt" IS NOT NULL)
        )
      ))
      AND COALESCE(d."lastSeenAt", s."lastSeenAt") >= NOW() - INTERVAL '5 minutes'
      AND COALESCE((latest.payload->>'active')::boolean, false) = true
  )`;

  // Recover states that were made stale by the former fixed timeout. Presence/occupancy values
  // are stateful: other measurements from the same fresh device prove that the active value is
  // still current even when Home Assistant does not repeat it.
  await pool.query(
    `UPDATE "PresenceTrackingState" tracking
     SET status = 'CONFIRMED', "reasonCodes" = '[]'::jsonb,
       "confidenceScore" = GREATEST("confidenceScore", 0.8), "updatedAt" = NOW()
     WHERE status = 'STALE'
       AND "reasonCodes" @> '["NO_RECENT_EVIDENCE"]'::jsonb
       AND ${activeStatefulSensor}`,
  );

  await pool.query(
    `UPDATE "PresenceTrackingState" tracking
     SET status = 'STALE', "reasonCodes" = '["NO_RECENT_EVIDENCE"]'::jsonb,
       "confidenceScore" = LEAST("confidenceScore", 0.45), "updatedAt" = NOW()
     WHERE status IN ('CONFIRMED', 'AMBIGUOUS')
       AND "lastEvidenceAt" <= NOW() - INTERVAL '15 minutes'
       AND NOT ${activeStatefulSensor}`,
  );
}

async function maintainPresenceSessions(): Promise<void> {
  await pool.query(
    `UPDATE "RoomPresenceSession"
     SET state = CASE WHEN state = 'AMBIGUOUS' THEN 'AMBIGUOUS'::"PresenceSessionState" ELSE 'CLOSED'::"PresenceSessionState" END,
         "endedAt" = "lastConfirmedAt" + INTERVAL '10 minutes',
         "durationSeconds" = GREATEST(0, EXTRACT(EPOCH FROM (("lastConfirmedAt" + INTERVAL '10 minutes') - "startedAt"))::int),
         "endReason" = 'MOTION_TIMEOUT',
         "updatedAt" = NOW()
     WHERE state IN ('OPEN', 'AMBIGUOUS') AND "endedAt" IS NULL AND capability = 'motion'
       AND "lastConfirmedAt" <= NOW() - INTERVAL '10 minutes'`,
  );
  await pool.query(
    `UPDATE "RoomPresenceSession" session
     SET state = CASE WHEN session.state = 'AMBIGUOUS' THEN 'AMBIGUOUS'::"PresenceSessionState" ELSE 'CLOSED'::"PresenceSessionState" END,
         "endedAt" = session."lastConfirmedAt",
         "durationSeconds" = GREATEST(0, EXTRACT(EPOCH FROM (session."lastConfirmedAt" - session."startedAt"))::int),
         "endReason" = 'SENSOR_OFFLINE', "excludedFromLearning" = true, "updatedAt" = NOW()
     FROM "Sensor" sensor
     WHERE session."sensorId" = sensor.id AND session.state IN ('OPEN', 'AMBIGUOUS')
       AND session."endedAt" IS NULL AND sensor.status = 'OFFLINE'`,
  );
}

async function calculatePresenceAggregates(): Promise<void> {
  await pool.query(
    `WITH all_sessions AS (
       SELECT s."homeId", s."roomId", date_trunc('day', s."startedAt" AT TIME ZONE h.timezone) AS "localDate",
         COUNT(*)::int AS passages,
         COUNT(*) FILTER (WHERE s.state = 'AMBIGUOUS')::int AS ambiguous
       FROM "RoomPresenceSession" s JOIN "Home" h ON h.id = s."homeId"
       WHERE s."startedAt" >= NOW() - INTERVAL '28 days'
       GROUP BY s."homeId", s."roomId", date_trunc('day', s."startedAt" AT TIME ZONE h.timezone)
     ), reliable AS (
       SELECT s."homeId", s."roomId", date_trunc('day', s."startedAt" AT TIME ZONE h.timezone) AS "localDate",
         s."durationSeconds", s."startedAt", s."endedAt", h.timezone
       FROM "RoomPresenceSession" s JOIN "Home" h ON h.id = s."homeId"
       WHERE s."startedAt" >= NOW() - INTERVAL '28 days' AND s.state = 'CLOSED'
         AND s.confidence <> 'LOW' AND s."excludedFromLearning" = false AND s."durationSeconds" IS NOT NULL
     ), medians AS (
       SELECT "homeId", "roomId", "localDate",
         percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationSeconds") AS median
       FROM reliable GROUP BY "homeId", "roomId", "localDate"
     ), stats AS (
       SELECT r."homeId", r."roomId", r."localDate", COUNT(*)::int AS reliable_count,
         SUM(r."durationSeconds")::int AS total_seconds,
         ROUND(AVG(r."durationSeconds"))::int AS average_seconds,
         ROUND(m.median)::int AS median_seconds,
         ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY ABS(r."durationSeconds" - m.median)))::int AS mad_seconds,
         MIN(EXTRACT(HOUR FROM r."startedAt" AT TIME ZONE r.timezone)::int * 60 + EXTRACT(MINUTE FROM r."startedAt" AT TIME ZONE r.timezone)::int)::int AS first_minute,
         MAX(EXTRACT(HOUR FROM r."endedAt" AT TIME ZONE r.timezone)::int * 60 + EXTRACT(MINUTE FROM r."endedAt" AT TIME ZONE r.timezone)::int)::int AS last_minute
       FROM reliable r JOIN medians m USING ("homeId", "roomId", "localDate")
       GROUP BY r."homeId", r."roomId", r."localDate", m.median
     )
     INSERT INTO "RoomDailyPresenceAggregate"
       (id, "homeId", "roomId", "localDate", "dayKind", passages, "totalSeconds", "averageSeconds",
        "medianSeconds", "madSeconds", "firstMinute", "lastMinute", "reliableSessions",
        "ambiguousSessions", "confidenceRate", "calculatedAt")
     SELECT concat('presence_daily_', gen_random_uuid()), a."homeId", a."roomId", a."localDate",
       CASE WHEN EXTRACT(ISODOW FROM a."localDate") >= 6 THEN 'WEEKEND' ELSE 'WEEKDAY' END,
       a.passages, COALESCE(s.total_seconds, 0), COALESCE(s.average_seconds, 0),
       COALESCE(s.median_seconds, 0), COALESCE(s.mad_seconds, 0), s.first_minute, s.last_minute,
       COALESCE(s.reliable_count, 0), a.ambiguous,
       CASE WHEN a.passages = 0 THEN 0 ELSE COALESCE(s.reliable_count, 0)::float / a.passages END, NOW()
     FROM all_sessions a LEFT JOIN stats s USING ("homeId", "roomId", "localDate")
     ON CONFLICT ("homeId", "roomId", "localDate") DO UPDATE SET
       "dayKind" = EXCLUDED."dayKind", passages = EXCLUDED.passages,
       "totalSeconds" = EXCLUDED."totalSeconds", "averageSeconds" = EXCLUDED."averageSeconds",
       "medianSeconds" = EXCLUDED."medianSeconds", "madSeconds" = EXCLUDED."madSeconds",
       "firstMinute" = EXCLUDED."firstMinute", "lastMinute" = EXCLUDED."lastMinute",
       "reliableSessions" = EXCLUDED."reliableSessions", "ambiguousSessions" = EXCLUDED."ambiguousSessions",
       "confidenceRate" = EXCLUDED."confidenceRate", "calculatedAt" = NOW()`,
  );

  const profiles = await pool.query<{
    homeId: string;
    roomId: string;
    samples: number;
    days: number;
    medianSeconds: number;
    madSeconds: number;
    averageDailySeconds: number;
    confidence: number;
    learningDays: number;
  }>(
    `SELECT a."homeId", a."roomId", SUM(a."reliableSessions")::int AS samples,
       COUNT(*)::int AS days, ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY a."medianSeconds"))::int AS "medianSeconds",
       ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY a."madSeconds"))::int AS "madSeconds",
       ROUND(AVG(a."totalSeconds"))::int AS "averageDailySeconds", AVG(a."confidenceRate") AS confidence,
       GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - h."learningStartedAt")) / 86400))::int AS "learningDays"
     FROM "RoomDailyPresenceAggregate" a JOIN "Home" h ON h.id = a."homeId"
     WHERE a."localDate" >= (NOW() - INTERVAL '28 days')
     GROUP BY a."homeId", a."roomId", h."learningStartedAt"`,
  );
  for (const profile of profiles.rows) {
    const kind = `room-presence:${profile.roomId}`;
    const status =
      profile.learningDays >= 14 && profile.samples >= 10 ? LEARNED_HABIT_STATUS : 'LEARNING';
    await pool.query(
      `UPDATE "HabitProfile" SET "validTo" = NOW()
       WHERE "homeId" = $1 AND kind = $2 AND "validTo" IS NULL`,
      [profile.homeId, kind],
    );
    await pool.query(
      `INSERT INTO "HabitProfile"
       (id, "homeId", "residentId", kind, status, source, parameters, confidence, "validFrom", "createdAt")
       SELECT concat('habit_', gen_random_uuid()), h.id, h."primaryResidentId", $2, $3::"HabitStatus", 'LEARNED', $4::jsonb, $5, NOW(), NOW()
       FROM "Home" h WHERE h.id = $1`,
      [
        profile.homeId,
        kind,
        status,
        JSON.stringify({
          roomId: profile.roomId,
          samples: profile.samples,
          days: profile.days,
          medianSeconds: profile.medianSeconds,
          madSeconds: profile.madSeconds,
          averageDailySeconds: profile.averageDailySeconds,
          windowDays: 28,
        }),
        Math.min(1, Number(profile.confidence)),
      ],
    );
  }
}

function frenchDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours} h${rest ? ` ${rest} min` : ''}` : `${minutes} min`;
}

async function evaluateBehavioralDwell(): Promise<void> {
  const sessions = await pool.query<{
    id: string;
    homeId: string;
    roomId: string;
    roomName: string;
    startedAt: Date;
    anomalySince: Date | null;
    medianSeconds: number;
    madSeconds: number;
  }>(
    `SELECT s.id, s."homeId", s."roomId", r.name AS "roomName", s."startedAt",
       s."dwellAnomalySince" AS "anomalySince", baseline.median AS "medianSeconds", baseline.mad AS "madSeconds"
     FROM "RoomPresenceSession" s JOIN "Room" r ON r.id = s."roomId"
     JOIN LATERAL (
       SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY a."medianSeconds"))::int AS median,
         ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY a."madSeconds"))::int AS mad,
         SUM(a."reliableSessions") AS samples
       FROM "RoomDailyPresenceAggregate" a
       WHERE a."homeId" = s."homeId" AND a."roomId" = s."roomId" AND a."localDate" >= NOW() - INTERVAL '28 days'
     ) baseline ON baseline.samples >= 10
     WHERE s.state = 'OPEN' AND s.confidence <> 'LOW' AND s."excludedFromLearning" = false
       AND EXISTS (SELECT 1 FROM "Home" h WHERE h.id = s."homeId" AND h."learningStartedAt" <= NOW() - INTERVAL '14 days')
       AND COALESCE((SELECT (c.settings#>>'{alertRules,behavioral,enabled}')::boolean
         FROM "ConfigurationRevision" c WHERE c."homeId" = s."homeId" ORDER BY c.version DESC LIMIT 1), false) = true
       AND NOT EXISTS (SELECT 1 FROM "Sensor" sensor WHERE sensor."homeId" = s."homeId"
         AND sensor."analysisEnabled" = true AND sensor.capability IN ('motion','occupancy','person_presence')
         AND sensor."removedAt" IS NULL
         AND (sensor.status <> 'ONLINE' OR sensor.available = false))`,
  );
  const eligibleRuleKeys = new Set(sessions.rows.map((session) => `behavior-dwell:${session.id}`));
  for (const session of sessions.rows) {
    const elapsed = Math.round((Date.now() - session.startedAt.getTime()) / 1_000);
    const threshold = session.medianSeconds + Math.max(3 * session.madSeconds, 30 * 60);
    const abnormal = elapsed > threshold;
    if (!abnormal) {
      if (session.anomalySince)
        await pool.query(
          `UPDATE "RoomPresenceSession" SET "dwellAnomalySince" = NULL WHERE id = $1`,
          [session.id],
        );
      await syncAlert({
        homeId: session.homeId,
        roomId: session.roomId,
        ruleKey: `behavior-dwell:${session.id}`,
        type: 'UNUSUAL_ACTIVITY',
        severity: 'ATTENTION',
        active: false,
        title: 'Durée de présence revenue à l’habitude',
        explanation: '',
      });
      continue;
    }
    if (!session.anomalySince) {
      await pool.query(
        `UPDATE "RoomPresenceSession" SET "dwellAnomalySince" = NOW() WHERE id = $1`,
        [session.id],
      );
      continue;
    }
    const persistent = Date.now() - session.anomalySince.getTime() >= 15 * 60_000;
    await syncAlert({
      homeId: session.homeId,
      roomId: session.roomId,
      ruleKey: `behavior-dwell:${session.id}`,
      type: 'UNUSUAL_ACTIVITY',
      severity: 'ATTENTION',
      active: persistent,
      title: `Présence inhabituellement longue dans ${session.roomName}`,
      explanation: `La présence dans ${session.roomName} dure depuis ${frenchDuration(elapsed)} ; la durée habituelle est d’environ ${frenchDuration(session.medianSeconds)}.`,
    });
  }
  const staleAlerts = await pool.query<{ homeId: string; roomId: string | null; ruleKey: string }>(
    `SELECT a."homeId", a."roomId", a."ruleKey" FROM "Alert" a
     WHERE a."ruleKey" LIKE 'behavior-dwell:%' AND a.status IN ('OPEN','ACKNOWLEDGED')`,
  );
  for (const alert of staleAlerts.rows) {
    if (eligibleRuleKeys.has(alert.ruleKey)) continue;
    await syncAlert({
      homeId: alert.homeId,
      roomId: alert.roomId,
      ruleKey: alert.ruleKey,
      type: 'UNUSUAL_ACTIVITY',
      severity: 'ATTENTION',
      active: false,
      title: 'Durée de présence revenue à l’habitude',
      explanation: '',
    });
  }
}

async function scorePresenceSessionsInShadowMode(): Promise<void> {
  const sessions = await pool.query<{
    id: string;
    homeId: string;
    startedAt: Date;
    durationSeconds: number;
    dailyTotalSeconds: number;
    roomId: string;
    previousRoomId: string | null;
    source: string;
    confidence: string;
    plausibleTransition: boolean | null;
  }>(
    `SELECT s.id, s."homeId", s."startedAt", s."durationSeconds", s."roomId",
       s."previousRoomId", s.source, s.confidence, s."plausibleTransition",
       SUM(s."durationSeconds") OVER (
         PARTITION BY s."homeId", date_trunc('day', s."startedAt" AT TIME ZONE h.timezone)
       )::int AS "dailyTotalSeconds"
     FROM "RoomPresenceSession" s JOIN "Home" h ON h.id = s."homeId"
     WHERE s.state = 'CLOSED' AND s."endedAt" >= NOW() - INTERVAL '24 hours'
       AND s."durationSeconds" IS NOT NULL AND s.confidence <> 'LOW'
       AND s."excludedFromLearning" = false
       AND EXISTS (SELECT 1 FROM "ModelArtifact" model WHERE model."homeId" = s."homeId"
         AND model.active = true AND model.algorithm = 'isolation-forest-session-v2')
       AND NOT EXISTS (SELECT 1 FROM "AnomalyEvaluation" evaluation
         WHERE evaluation."homeId" = s."homeId"
           AND evaluation.factors @> jsonb_build_array(jsonb_build_object('feature', 'session_id', 'message', s.id)))`,
  );
  for (const session of sessions.rows) {
    const score = await ai.score({
      home_id: session.homeId,
      observed_at: session.startedAt.toISOString(),
      features: sessionFeatures(session),
    });
    await pool.query(
      `INSERT INTO "AnomalyEvaluation"
       (id, "homeId", "modelVersion", score, confidence, factors, "evaluatedAt")
       VALUES (concat('eval_', gen_random_uuid()), $1, $2, $3, $4, $5::jsonb, NOW())`,
      [
        session.homeId,
        score.model_version,
        score.score,
        score.confidence,
        JSON.stringify([
          ...score.factors,
          { feature: 'session_id', contribution: 0, message: session.id },
        ]),
      ],
    );
  }
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
      startedAt: Date;
      durationSeconds: number;
      dailyTotalSeconds: number;
      roomId: string;
      previousRoomId: string | null;
      source: string;
      confidence: string;
      plausibleTransition: boolean | null;
    }>(
      `SELECT s."startedAt", s."durationSeconds", s."roomId", s."previousRoomId", s.source,
         s.confidence, s."plausibleTransition",
         SUM(s."durationSeconds") OVER (
           PARTITION BY date_trunc('day', s."startedAt" AT TIME ZONE h.timezone)
         )::int AS "dailyTotalSeconds"
       FROM "RoomPresenceSession" s JOIN "Home" h ON h.id = s."homeId"
       WHERE s."homeId" = $1 AND s."startedAt" >= NOW() - INTERVAL '28 days'
         AND s.state = 'CLOSED' AND s.confidence <> 'LOW'
         AND s."excludedFromLearning" = false AND s."durationSeconds" IS NOT NULL
       ORDER BY s."startedAt" ASC`,
      [home.homeId],
    );
    if (observations.rowCount === null || observations.rowCount < 96) continue;
    const first = observations.rows[0]!.startedAt;
    const last = observations.rows.at(-1)!.startedAt;
    const daysCovered = Math.floor((last.getTime() - first.getTime()) / 86_400_000) + 1;
    if (daysCovered < 14) continue;
    const trained = await ai.train({
      home_id: home.homeId,
      days_covered: daysCovered,
      samples: observations.rows.map(sessionFeatures),
    });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE "ModelArtifact" SET active = false WHERE "homeId" = $1`, [
        home.homeId,
      ]);
      await client.query(
        `INSERT INTO "ModelArtifact" (id, "homeId", version, algorithm, path, sha256, "trainedFrom", "trainedTo", metrics, active, "createdAt")
         VALUES (concat('model_', gen_random_uuid()), $1, $2, 'isolation-forest-session-v2', $3, $4, $5, $6, $7::jsonb, true, NOW())
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
         WHERE "homeId" = $1 AND kind = 'ml:routine' AND "validTo" IS NULL`,
        [home.homeId],
      );
      await client.query(
        `INSERT INTO "HabitProfile" (id, "homeId", kind, status, parameters, confidence, "validFrom", "createdAt")
         VALUES (concat('habit_', gen_random_uuid()), $1, 'ml:routine', $2, $3::jsonb, $4, NOW(), NOW())`,
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
  let lastPresenceCheck = 0;
  let lastPresenceAggregateRun = 0;
  let lastTopologicalPresenceCheck = 0;
  while (running) {
    try {
      if (Date.now() - lastRuleCheck > 60_000) {
        await evaluateSensorRules();
        await resolveClearedSecurityAlerts();
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
      if (Date.now() - lastPresenceCheck > 60_000) {
        await maintainPresenceSessions();
        await evaluateBehavioralDwell();
        await scorePresenceSessionsInShadowMode();
        lastPresenceCheck = Date.now();
      }
      if (Date.now() - lastTopologicalPresenceCheck > 5_000) {
        await maintainTopologicalPresence();
        lastTopologicalPresenceCheck = Date.now();
      }
      if (Date.now() - lastPresenceAggregateRun > 86_400_000) {
        await calculatePresenceAggregates();
        lastPresenceAggregateRun = Date.now();
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
        if (row.topic === 'camera.snapshot') {
          const alertId = typeof row.payload.alertId === 'string' ? row.payload.alertId : '';
          if (alertId) await captureAlertSnapshot(row.homeId, alertId);
        }
        if (row.topic === 'camera.recording') {
          await recordMainEntranceOpening(row.homeId, { ...row.payload, outboxId: row.id });
        }
        await complete(row);
      } catch (error) {
        await fail(row, error);
      }
    } catch (error) {
      console.error('Worker cycle failed; retrying without stopping the worker.', error);
      await delay(5_000);
    }
  }
  await pool.end();
}

void main();
