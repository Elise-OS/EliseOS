import { captureAlertSnapshot, recordMainEntranceOpening } from './camera.js';
import { createHmac } from 'node:crypto';
import { ai, pool, type OutboxRow } from './db.js';

export async function claim(): Promise<OutboxRow | null> {
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

export async function handleAi(row: OutboxRow): Promise<void> {
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

export async function handleWebhook(row: OutboxRow): Promise<void> {
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
    headers: { 'content-type': 'application/json', 'x-elise-signature': `sha256=${signature}` },
    body,
  });
  if (!response.ok) throw new Error(`Webhook returned ${response.status}`);
}

export interface PushSubscriptionRow {
  id: string;
  expoPushToken: string;
}

export interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export async function handlePush(row: OutboxRow): Promise<void> {
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
        // Lets urgent alerts break through iOS Focus modes.
        ...(severity === 'URGENT' ? { interruptionLevel: 'time-sensitive' } : {}),
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

export async function handlePushReceipt(row: OutboxRow): Promise<void> {
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

export async function complete(row: OutboxRow): Promise<void> {
  await pool.query(
    `UPDATE "OutboxMessage" SET status = 'COMPLETED', "processedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`,
    [row.id],
  );
}

export async function fail(row: OutboxRow, error: unknown): Promise<void> {
  const seconds = Math.min(3600, 2 ** Math.min(row.attempts + 1, 10));
  await pool.query(
    `UPDATE "OutboxMessage" SET status = 'FAILED', "lastError" = $2, "availableAt" = NOW() + ($3 || ' seconds')::interval, "updatedAt" = NOW() WHERE id = $1`,
    [row.id, error instanceof Error ? error.message : String(error), seconds],
  );
}

async function dispatch(row: OutboxRow): Promise<void> {
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
}

/** Processes one queued message. Returns false when the queue is empty. */
export async function processNextMessage(): Promise<boolean> {
  const row = await claim();
  if (!row) return false;
  try {
    await dispatch(row);
    await complete(row);
  } catch (error) {
    await fail(row, error);
  }
  return true;
}
