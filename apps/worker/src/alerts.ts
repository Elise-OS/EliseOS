import { type PoolClient } from 'pg';
import { clearanceConfirmed } from './rules.js';
import { pool, type AlertCandidate } from './db.js';

export async function enqueueWebhook(
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

export async function syncAlert(candidate: AlertCandidate): Promise<void> {
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

export async function syncAlertLocked(
  client: PoolClient,
  candidate: AlertCandidate,
): Promise<void> {
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
