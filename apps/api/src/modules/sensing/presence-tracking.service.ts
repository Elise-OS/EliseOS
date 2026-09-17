import { presenceCapabilityForDevice, type HomePlan } from '@michel/contracts';
import type { PresenceConfidence, PresenceSource, Prisma } from '@prisma/client';

const PRESENCE_CAPABILITIES = new Set(['motion', 'occupancy', 'person_presence']);

type Transaction = Prisma.TransactionClient;

export interface TrackingEvidence {
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
  plan: HomePlan | null;
}

export interface TrackingResult {
  acceptedForSession: boolean;
  confidence: PresenceConfidence;
  replacementEvidence?: TrackingEvidence;
}

interface EvidenceSummary {
  eventId: string;
  sensorId: string | null;
  roomId: string | null;
  capability: string;
  occurredAt: string;
  observed: true;
}

function json<T>(value: T): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function asEvidence(value: Prisma.JsonValue): EvidenceSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const entry = item as Record<string, Prisma.JsonValue>;
    if (
      typeof entry.eventId !== 'string' ||
      typeof entry.capability !== 'string' ||
      typeof entry.occurredAt !== 'string'
    )
      return [];
    return [
      {
        eventId: entry.eventId,
        sensorId: typeof entry.sensorId === 'string' ? entry.sensorId : null,
        roomId: typeof entry.roomId === 'string' ? entry.roomId : null,
        capability: entry.capability,
        occurredAt: entry.occurredAt,
        observed: true as const,
      },
    ];
  });
}

function evidenceSummary(evidence: TrackingEvidence): EvidenceSummary {
  return {
    eventId: evidence.eventId,
    sensorId: evidence.sensorId,
    roomId: evidence.roomId,
    capability: evidence.capability,
    occurredAt: evidence.occurredAt.toISOString(),
    observed: true,
  };
}

function scoreFor(evidence: TrackingEvidence): number {
  const capability =
    evidence.capability === 'person_presence'
      ? 0.96
      : evidence.capability === 'occupancy'
        ? 0.9
        : 0.72;
  const quality =
    evidence.confidence === 'HIGH' ? 0 : evidence.confidence === 'MEDIUM' ? -0.15 : -0.35;
  const camera = evidence.source === 'CAMERA' ? 0.03 : 0;
  return Math.max(0.2, Math.min(1, capability + quality + camera));
}

export function presenceGraph(plan: HomePlan | null): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  if (!plan) return graph;
  for (const level of plan.levels) for (const room of level.rooms) graph.set(room.id, new Set());
  const connect = (first: string, second: string) => {
    if (!graph.has(first) || !graph.has(second) || first === second) return;
    graph.get(first)!.add(second);
    graph.get(second)!.add(first);
  };
  for (const connection of plan.connections) connect(connection.fromRoomId, connection.toRoomId);
  for (const level of plan.levels) {
    for (const opening of level.openings) {
      if ((opening.kind === 'DOOR' || opening.kind === 'PASSAGE') && opening.roomIds.length === 2)
        connect(opening.roomIds[0]!, opening.roomIds[1]!);
    }
    for (const stair of level.stairs) connect(stair.fromRoomId, stair.toRoomId);
  }
  return graph;
}

export function shortestPresencePath(
  graph: ReadonlyMap<string, ReadonlySet<string>>,
  from: string,
  to: string,
): string[] | null {
  if (from === to) return [from];
  if (!graph.has(from) || !graph.has(to)) return null;
  const queue: string[][] = [[from]];
  const seen = new Set([from]);
  while (queue.length) {
    const path = queue.shift()!;
    for (const next of graph.get(path.at(-1)!) ?? []) {
      if (seen.has(next)) continue;
      const candidate = [...path, next];
      if (next === to) return candidate;
      seen.add(next);
      queue.push(candidate);
    }
  }
  return null;
}

function roomNames(plan: HomePlan | null): Map<string, string> {
  return new Map(
    plan?.levels.flatMap((level) => level.rooms.map((room) => [room.id, room.name] as const)) ?? [],
  );
}

export class PresenceTrackingService {
  public async process(tx: Transaction, evidence: TrackingEvidence): Promise<TrackingResult> {
    if (process.env.TOPOLOGY_TRACKING_ENABLED === 'false' || !evidence.roomId)
      return { acceptedForSession: true, confidence: evidence.confidence };
    if (evidence.active === null)
      return { acceptedForSession: false, confidence: evidence.confidence };

    const current = await tx.presenceTrackingState.findUnique({
      where: { homeId: evidence.homeId },
    });
    if (!evidence.active) return this.applyAbsence(tx, evidence, current);

    const summary = evidenceSummary(evidence);
    const score = scoreFor(evidence);
    const names = roomNames(evidence.plan);
    const roomName = names.get(evidence.roomId) ?? 'la pièce détectée';
    if (!current?.confirmedRoomId) {
      await tx.presenceTrackingState.upsert({
        where: { homeId: evidence.homeId },
        update: this.confirmedData(evidence, score, summary),
        create: {
          homeId: evidence.homeId,
          residentId: evidence.residentId,
          ...this.confirmedData(evidence, score, summary),
        },
      });
      await this.decision(
        tx,
        evidence,
        null,
        evidence.roomId,
        [evidence.roomId],
        'CONFIRMED',
        score,
        [],
        [summary],
        `Première présence fiable dans ${roomName}.`,
      );
      return { acceptedForSession: true, confidence: evidence.confidence };
    }

    if (current.confirmedRoomId === evidence.roomId) {
      const previousEvidence = asEvidence(current.evidenceSummary);
      await tx.presenceTrackingState.update({
        where: { id: current.id },
        data: {
          status: 'CONFIRMED',
          candidateRoomId: null,
          pathRoomIds: json([]),
          confidenceScore: Math.max(current.confidenceScore, score),
          reasonCodes: json([]),
          evidenceSummary: json([...previousEvidence, summary].slice(-5)),
          lastEvidenceAt: evidence.occurredAt,
          transitionStartedAt: null,
          trackingDegraded: false,
          inconsistencyCount: 0,
          inconsistencyWindowAt: null,
        },
      });
      return { acceptedForSession: true, confidence: evidence.confidence };
    }

    const graph = presenceGraph(evidence.plan);
    const path = shortestPresencePath(graph, current.confirmedRoomId, evidence.roomId);
    const reasons = [
      'DIRECT_DETECTION',
      ...(!path ? ['PLAN_DISCONNECTED'] : path.length > 2 ? ['INFERRED_PATH'] : []),
    ];
    await this.confirmTransition(tx, current.id, evidence, score, summary);
    await this.decision(
      tx,
      evidence,
      current.confirmedRoomId,
      evidence.roomId,
      path ?? [],
      'CONFIRMED',
      score,
      reasons,
      [summary],
      `Présence détectée directement dans ${roomName}.`,
    );
    return { acceptedForSession: true, confidence: evidence.confidence };
  }

  private confirmedData(evidence: TrackingEvidence, score: number, summary: EvidenceSummary) {
    return {
      status: 'CONFIRMED' as const,
      confirmedRoomId: evidence.roomId,
      candidateRoomId: null,
      pathRoomIds: json([]),
      confidenceScore: score,
      reasonCodes: json([]),
      evidenceSummary: json([summary]),
      lastEvidenceAt: evidence.occurredAt,
      transitionStartedAt: null,
    };
  }

  private async confirmTransition(
    tx: Transaction,
    stateId: string,
    evidence: TrackingEvidence,
    score: number,
    summary: EvidenceSummary,
  ) {
    await tx.presenceTrackingState.update({
      where: { id: stateId },
      data: this.confirmedData(evidence, score, summary),
    });
  }

  private async applyAbsence(
    tx: Transaction,
    evidence: TrackingEvidence,
    current: Awaited<ReturnType<Transaction['presenceTrackingState']['findUnique']>>,
  ): Promise<TrackingResult> {
    if (!current || current.confirmedRoomId !== evidence.roomId)
      return { acceptedForSession: true, confidence: evidence.confidence };
    const replacement = await this.latestActiveEvidence(tx, evidence);
    if (replacement) {
      const summary = evidenceSummary(replacement);
      const score = scoreFor(replacement);
      const path = shortestPresencePath(
        presenceGraph(evidence.plan),
        current.confirmedRoomId!,
        replacement.roomId!,
      );
      await this.confirmTransition(tx, current.id, replacement, score, summary);
      await this.decision(
        tx,
        replacement,
        current.confirmedRoomId,
        replacement.roomId,
        path ?? [],
        'CONFIRMED',
        score,
        ['ACTIVE_SENSOR_REMAINS'],
        [summary],
        'La pièce précédente est inactive ; une autre présence encore active devient la position courante.',
      );
      return {
        acceptedForSession: true,
        confidence: evidence.confidence,
        replacementEvidence: replacement,
      };
    }
    await tx.presenceTrackingState.update({
      where: { id: current.id },
      data: {
        status: 'STALE',
        candidateRoomId: null,
        pathRoomIds: json([]),
        reasonCodes: json(['EXPLICIT_ABSENCE']),
        transitionStartedAt: null,
        lastEvidenceAt: evidence.occurredAt,
        confidenceScore: Math.min(current.confidenceScore, 0.45),
        trackingDegraded: false,
      },
    });
    return { acceptedForSession: true, confidence: evidence.confidence };
  }

  private async latestActiveEvidence(
    tx: Transaction,
    evidence: TrackingEvidence,
  ): Promise<TrackingEvidence | null> {
    const sensors = await tx.sensor.findMany({
      where: {
        homeId: evidence.homeId,
        analysisEnabled: true,
        removedAt: null,
        available: true,
        status: 'ONLINE',
        capability: { in: [...PRESENCE_CAPABILITIES] },
      },
      include: {
        device: {
          select: { model: true, enabled: true, installationStatus: true },
        },
        events: {
          where: {
            quality: 'good',
            roomId: { not: null },
            occurredAt: { lte: evidence.occurredAt },
          },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take: 1,
        },
      },
    });
    const active = sensors.flatMap((sensor) => {
      if (
        sensor.device &&
        (!sensor.device.enabled || sensor.device.installationStatus !== 'OPERATIONAL')
      )
        return [];
      const latest = sensor.events[0];
      if (!latest?.roomId) return [];
      const payload = latest.payload as Record<string, unknown>;
      if (payload.active !== true) return [];
      return [
        {
          detectedAt: latest.occurredAt,
          evidence: {
            eventId: latest.id,
            homeId: evidence.homeId,
            residentId: evidence.residentId,
            roomId: latest.roomId,
            sensorId: sensor.id,
            capability: presenceCapabilityForDevice(latest.capability, sensor.device?.model),
            active: true,
            occurredAt: evidence.occurredAt,
            confidence: latest.roomConfidence ?? 'LOW',
            source: 'SENSOR' as const,
            plan: evidence.plan,
          },
        },
      ];
    });
    return (
      active.sort((left, right) => left.detectedAt.getTime() - right.detectedAt.getTime()).at(-1)
        ?.evidence ?? null
    );
  }

  private async decision(
    tx: Transaction,
    evidence: TrackingEvidence,
    fromRoomId: string | null,
    toRoomId: string | null,
    pathRoomIds: string[],
    outcome: 'CONFIRMED' | 'PENDING' | 'AMBIGUOUS' | 'CANCELLED',
    confidenceScore: number,
    reasonCodes: string[],
    summaries: EvidenceSummary[],
    explanation: string,
  ) {
    await tx.presenceTransitionDecision.create({
      data: {
        homeId: evidence.homeId,
        residentId: evidence.residentId,
        fromRoomId,
        toRoomId,
        pathRoomIds: json(pathRoomIds),
        outcome,
        confidenceScore,
        reasonCodes: json(reasonCodes),
        evidenceSummary: json(summaries),
        explanation,
        occurredAt: evidence.occurredAt,
        confirmedAt: outcome === 'CONFIRMED' ? evidence.occurredAt : null,
      },
    });
  }
}
