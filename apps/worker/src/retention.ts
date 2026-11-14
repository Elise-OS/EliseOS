import { pool } from './db.js';

export async function applyRetention(): Promise<void> {
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
