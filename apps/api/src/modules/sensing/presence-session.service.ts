import type { PresenceConfidence, PresenceSource, Prisma } from '@prisma/client';

const PRESENCE_CAPABILITIES = new Set(['motion', 'occupancy', 'person_presence']);
const STATEFUL_CAPABILITIES = new Set(['occupancy', 'person_presence']);
const SIMULTANEOUS_WINDOW_MS = 90_000;
const RECONCILIATION_WINDOW_MS = 24 * 60 * 60 * 1_000;

export interface PresenceEvidence {
  eventId: string;
  homeId: string;
  residentId: string | null;
  roomId: string | null;
  sensorId: string | null;
  capability: string;
  active: boolean | null;
  occurredAt: Date;
  confidence: PresenceConfidence;
  source: PresenceSource;
  connectedRoomIds: ReadonlySet<string>;
}

type Transaction = Prisma.TransactionClient;

function durationSeconds(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 1_000));
}

function connectionKey(first: string, second: string): string {
  return [first, second].sort().join(':');
}

export class PresenceSessionService {
  public async process(tx: Transaction, evidence: PresenceEvidence): Promise<void> {
    if (!PRESENCE_CAPABILITIES.has(evidence.capability) || !evidence.roomId) return;
    if (evidence.active === null) return;

    const newest = await tx.roomPresenceSession.findFirst({
      where: { homeId: evidence.homeId },
      orderBy: { lastConfirmedAt: 'desc' },
    });
    if (newest && evidence.occurredAt < newest.lastConfirmedAt) {
      await this.reconcile(tx, evidence.homeId, evidence.occurredAt);
      return;
    }
    await this.applyEvidence(tx, evidence);
  }

  private async applyEvidence(tx: Transaction, evidence: PresenceEvidence): Promise<void> {
    const roomId = evidence.roomId;
    if (!roomId) return;
    const current = await tx.roomPresenceSession.findFirst({
      where: {
        homeId: evidence.homeId,
        state: { in: ['OPEN', 'AMBIGUOUS'] },
        endedAt: null,
      },
      orderBy: { lastConfirmedAt: 'desc' },
    });

    if (!evidence.active) {
      if (!STATEFUL_CAPABILITIES.has(evidence.capability) || current?.roomId !== evidence.roomId)
        return;
      await tx.roomPresenceSession.update({
        where: { id: current.id },
        data: {
          state: current.state === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'CLOSED',
          endedAt: evidence.occurredAt,
          durationSeconds: durationSeconds(current.startedAt, evidence.occurredAt),
          exitEventId: evidence.eventId,
          endReason: 'EXPLICIT_ABSENCE',
        },
      });
      return;
    }

    const visit = await tx.visit.findFirst({
      where: {
        homeId: evidence.homeId,
        startsAt: { lte: evidence.occurredAt },
        OR: [
          { endsAt: { gte: evidence.occurredAt } },
          {
            endsAt: null,
            startsAt: { gte: new Date(evidence.occurredAt.getTime() - 2 * 60 * 60 * 1_000) },
          },
        ],
      },
      select: { id: true },
    });

    if (current?.roomId === roomId) {
      const source = current.source === evidence.source ? current.source : ('COMBINED' as const);
      await tx.roomPresenceSession.update({
        where: { id: current.id },
        data: {
          lastConfirmedAt: evidence.occurredAt,
          sensorId: evidence.sensorId,
          capability: evidence.capability,
          source,
          confidence:
            current.confidence === 'LOW' || evidence.confidence === 'LOW'
              ? 'LOW'
              : current.confidence === 'MEDIUM' || evidence.confidence === 'MEDIUM'
                ? 'MEDIUM'
                : 'HIGH',
          excludedFromLearning: current.excludedFromLearning || Boolean(visit),
        },
      });
      return;
    }

    let plausibleTransition: boolean | null = null;
    let ambiguous = false;
    if (current) {
      const gap = evidence.occurredAt.getTime() - current.lastConfirmedAt.getTime();
      ambiguous = current.capability !== 'motion' && gap >= 0 && gap <= SIMULTANEOUS_WINDOW_MS;
      plausibleTransition = evidence.connectedRoomIds.has(connectionKey(current.roomId, roomId));
      await tx.roomPresenceSession.update({
        where: { id: current.id },
        data: {
          state: ambiguous ? 'AMBIGUOUS' : 'CLOSED',
          endedAt: evidence.occurredAt,
          durationSeconds: durationSeconds(current.startedAt, evidence.occurredAt),
          exitEventId: evidence.eventId,
          endReason: 'TRANSITION',
          excludedFromLearning: current.excludedFromLearning || ambiguous,
          ambiguousReason: ambiguous ? 'SIMULTANEOUS_ROOMS' : current.ambiguousReason,
        },
      });
    }

    await tx.roomPresenceSession.create({
      data: {
        homeId: evidence.homeId,
        residentId: evidence.residentId,
        roomId,
        sensorId: evidence.sensorId,
        capability: evidence.capability,
        startedAt: evidence.occurredAt,
        lastConfirmedAt: evidence.occurredAt,
        state: ambiguous ? 'AMBIGUOUS' : 'OPEN',
        confidence: !plausibleTransition && current ? 'LOW' : evidence.confidence,
        source: evidence.source,
        entryEventId: evidence.eventId,
        previousRoomId: current?.roomId ?? null,
        plausibleTransition,
        excludedFromLearning:
          Boolean(visit) || ambiguous || (!plausibleTransition && Boolean(current)),
        ambiguousReason: ambiguous
          ? 'SIMULTANEOUS_ROOMS'
          : !plausibleTransition && current
            ? 'IMPLAUSIBLE_TRANSITION'
            : visit
              ? 'SCHEDULED_VISIT'
              : null,
      },
    });
  }

  private async reconcile(tx: Transaction, homeId: string, occurredAt: Date): Promise<void> {
    const from = new Date(occurredAt.getTime() - RECONCILIATION_WINDOW_MS);
    await tx.roomPresenceSession.deleteMany({
      where: { homeId, lastConfirmedAt: { gte: from } },
    });
    const [home, events, plan] = await Promise.all([
      tx.home.findUnique({ where: { id: homeId }, select: { primaryResidentId: true } }),
      tx.observationEvent.findMany({
        where: {
          homeId,
          roomId: { not: null },
          capability: { in: [...PRESENCE_CAPABILITIES] },
          occurredAt: { gte: from },
          sensor: { analysisEnabled: true },
        },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      }),
      tx.homePlan.findUnique({ where: { homeId }, select: { data: true } }),
    ]);
    const connectedRoomIds = connectionsFromPlan(plan?.data);
    for (const event of events) {
      const payload = event.payload as Record<string, unknown>;
      await this.applyEvidence(tx, {
        eventId: event.id,
        homeId,
        residentId: home?.primaryResidentId ?? null,
        roomId: event.roomId,
        sensorId: event.sensorId,
        capability: event.capability,
        active: typeof payload.active === 'boolean' ? payload.active : null,
        occurredAt: event.occurredAt,
        confidence: event.roomConfidence ?? 'LOW',
        source: 'SENSOR',
        connectedRoomIds,
      });
    }
  }
}

export function connectionsFromPlan(value: Prisma.JsonValue | undefined): ReadonlySet<string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return new Set();
  const root = value as Record<string, unknown>;
  const pairs: string[] = [];
  const direct = Array.isArray(root.connections) ? root.connections : [];
  for (const item of direct) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const connection = item as Record<string, unknown>;
    if (typeof connection.fromRoomId === 'string' && typeof connection.toRoomId === 'string')
      pairs.push(connectionKey(connection.fromRoomId, connection.toRoomId));
  }
  const levels = Array.isArray(root.levels) ? root.levels : [];
  for (const level of levels) {
    if (!level || typeof level !== 'object' || Array.isArray(level)) continue;
    const record = level as Record<string, unknown>;
    const openings = Array.isArray(record.openings) ? record.openings : [];
    for (const opening of openings) {
      if (!opening || typeof opening !== 'object' || Array.isArray(opening)) continue;
      const roomIds = (opening as Record<string, unknown>).roomIds;
      if (
        Array.isArray(roomIds) &&
        roomIds.length === 2 &&
        roomIds.every((id) => typeof id === 'string')
      )
        pairs.push(connectionKey(roomIds[0] as string, roomIds[1] as string));
    }
    const stairs = Array.isArray(record.stairs) ? record.stairs : [];
    for (const stair of stairs) {
      if (!stair || typeof stair !== 'object' || Array.isArray(stair)) continue;
      const item = stair as Record<string, unknown>;
      if (typeof item.fromRoomId === 'string' && typeof item.toRoomId === 'string')
        pairs.push(connectionKey(item.fromRoomId, item.toRoomId));
    }
  }
  return new Set(pairs);
}
