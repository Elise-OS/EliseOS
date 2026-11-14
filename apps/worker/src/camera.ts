import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pool } from './db.js';

export async function captureAlertSnapshot(homeId: string, alertId: string): Promise<void> {
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

export async function recordMainEntranceOpening(
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
