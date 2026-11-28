import { digestLocalClock, digestWeekStart, WEEKLY_DIGEST_READY_MINUTE } from '@elise/contracts';
import { pool } from './db.js';

/**
 * Sunday evening, the weekly digest of the notebook is ready: the family gets one push. The
 * digest itself is computed on the box when it is opened; the push says nothing about the week,
 * as every push: the details stay behind the authenticated API. Its title and text are written
 * here, for the message preference "notebook messages".
 */
export const WEEKLY_DIGEST_PUSH = {
  title: 'Élise · Le bilan de la semaine est prêt',
  body: 'Ouvrez le carnet de liaison pour le lire.',
} as const;

/** The week whose digest becomes ready now (Sunday evening, local time), or null. */
export function weeklyDigestDue(now: Date, timeZone: string): string | null {
  const { dateKey, minute } = digestLocalClock(now, timeZone);
  const sunday = new Date(`${dateKey}T12:00:00Z`).getUTCDay() === 0;
  return sunday && minute >= WEEKLY_DIGEST_READY_MINUTE ? digestWeekStart(dateKey) : null;
}

/** Every few minutes: one push per home and per week, on Sunday from 20:00 until midnight. */
export async function notifyWeeklyDigests(now = new Date()): Promise<number> {
  const homes = await pool.query<{ homeId: string; timezone: string }>(
    `SELECT id AS "homeId", timezone FROM "Home"`,
  );
  let sent = 0;
  for (const home of homes.rows) {
    const week = weeklyDigestDue(now, home.timezone);
    if (!week) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `weekly-digest:${home.homeId}:${week}`,
      ]);
      const done = await client.query(
        `SELECT 1 FROM "AuditLog" WHERE "homeId" = $1 AND action = 'WEEKLY_DIGEST_READY' AND target = $2 LIMIT 1`,
        [home.homeId, week],
      );
      if (done.rowCount) {
        await client.query('COMMIT');
        continue;
      }
      await client.query(
        `INSERT INTO "OutboxMessage" (id, "homeId", topic, payload, status, attempts, "availableAt", "createdAt", "updatedAt")
         VALUES (concat('outbox_', gen_random_uuid()), $1, 'push',
           jsonb_build_object('kind', 'weekly_digest', 'weekStart', $2::text,
             'preference', 'liaisonMessages', 'title', $3::text, 'body', $4::text),
           'PENDING', 0, NOW(), NOW(), NOW())`,
        [home.homeId, week, WEEKLY_DIGEST_PUSH.title, WEEKLY_DIGEST_PUSH.body],
      );
      await client.query(
        `INSERT INTO "AuditLog" (id, "homeId", "actorId", action, target, metadata, "createdAt")
         VALUES (concat('audit_', gen_random_uuid()), $1, NULL, 'WEEKLY_DIGEST_READY', $2, '{}'::jsonb, NOW())`,
        [home.homeId, week],
      );
      await client.query('COMMIT');
      sent += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  return sent;
}
