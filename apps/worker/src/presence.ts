import { LEARNED_HABIT_STATUS } from './policy.js';
import { syncAlert } from './alerts.js';
import { ai, pool } from './db.js';

export function stableBucket(value: string | null, buckets = 8): number {
  if (!value) return -1;
  let hash = 5381;
  for (const character of value) hash = (hash * 33) ^ character.charCodeAt(0);
  return Math.abs(hash) % buckets;
}

export function sessionFeatures(session: {
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

export async function maintainTopologicalPresence(): Promise<void> {
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

export async function maintainPresenceSessions(): Promise<void> {
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

export async function calculatePresenceAggregates(): Promise<void> {
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

export function frenchDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours} h${rest ? ` ${rest} min` : ''}` : `${minutes} min`;
}

export async function evaluateBehavioralDwell(): Promise<void> {
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

export async function scorePresenceSessionsInShadowMode(): Promise<void> {
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

export async function trainEligibleHomes(): Promise<void> {
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
          `elise-ai://${home.homeId}/${trained.model_version}`,
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
