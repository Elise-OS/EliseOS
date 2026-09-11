import type { HomePlan } from '@michel/contracts';
import type { PresenceConfidence, PresenceSource, Prisma } from '@prisma/client';

const CONFIRMATION_DELAY_MS = 20_000;
const INCONSISTENCY_WINDOW_MS = 15 * 60_000;
const RECOVERY_WINDOW_MS = 30 * 60_000;
const CONCURRENT_PRESENCE_MS = 90_000;
const STATEFUL_CAPABILITIES = new Set(['occupancy', 'person_presence']);

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

function asStrings(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
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
      const cancelled = current.status === 'IN_TRANSIT' && Boolean(current.candidateRoomId);
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
          ...(this.hasRecovered(current.inconsistencyWindowAt, evidence.occurredAt)
            ? { inconsistencyCount: 0, inconsistencyWindowAt: null, trackingDegraded: false }
            : {}),
        },
      });
      if (cancelled)
        await this.decision(
          tx,
          evidence,
          current.confirmedRoomId,
          current.candidateRoomId,
          asStrings(current.pathRoomIds),
          'CANCELLED',
          score,
          ['ORIGIN_RECONFIRMED'],
          [summary],
          `La présence a été reconfirmée dans ${roomName} ; le déplacement supposé est annulé.`,
        );
      return { acceptedForSession: true, confidence: evidence.confidence };
    }

    const graph = presenceGraph(evidence.plan);
    const path = shortestPresencePath(graph, current.confirmedRoomId, evidence.roomId);
    const adjacent = path?.length === 2;
    if (await this.concurrentPresence(tx, evidence)) {
      const reasons = ['SIMULTANEOUS_ROOMS', 'UNATTRIBUTED_PRESENCE'];
      await tx.presenceTrackingState.update({
        where: { id: current.id },
        data: {
          status: 'AMBIGUOUS',
          candidateRoomId: evidence.roomId,
          pathRoomIds: json(path ?? []),
          confidenceScore: Math.min(score, 0.55),
          reasonCodes: json(reasons),
          evidenceSummary: json([...asEvidence(current.evidenceSummary), summary].slice(-5)),
          lastEvidenceAt: evidence.occurredAt,
        },
      });
      await this.decision(
        tx,
        evidence,
        current.confirmedRoomId,
        evidence.roomId,
        path ?? [],
        'AMBIGUOUS',
        Math.min(score, 0.55),
        reasons,
        [summary],
        'Plusieurs pièces restent occupées : la présence ne peut pas être attribuée au résident principal.',
      );
      return { acceptedForSession: false, confidence: 'LOW' };
    }

    if (adjacent) {
      await this.confirmTransition(tx, current.id, evidence, score, summary);
      await this.decision(
        tx,
        evidence,
        current.confirmedRoomId,
        evidence.roomId,
        path,
        'CONFIRMED',
        score,
        ['ADJACENT_TRANSITION'],
        [summary],
        `Déplacement confirmé vers ${roomName}.`,
      );
      return { acceptedForSession: true, confidence: evidence.confidence };
    }

    if (!path) {
      const degradation = this.nextInconsistency(current, evidence.occurredAt);
      const reasons = ['PLAN_DISCONNECTED', 'IMPLAUSIBLE_TRANSITION'];
      await tx.presenceTrackingState.update({
        where: { id: current.id },
        data: {
          status: 'AMBIGUOUS',
          candidateRoomId: evidence.roomId,
          pathRoomIds: json([]),
          confidenceScore: Math.min(score, 0.4),
          reasonCodes: json(reasons),
          evidenceSummary: json([...asEvidence(current.evidenceSummary), summary].slice(-5)),
          lastEvidenceAt: evidence.occurredAt,
          ...degradation,
        },
      });
      await this.decision(
        tx,
        evidence,
        current.confirmedRoomId,
        evidence.roomId,
        [],
        'AMBIGUOUS',
        Math.min(score, 0.4),
        reasons,
        [summary],
        `Aucun passage déclaré ne relie la dernière position fiable à ${roomName}.`,
      );
      return { acceptedForSession: false, confidence: 'LOW' };
    }

    const sameCandidate =
      current.status === 'IN_TRANSIT' && current.candidateRoomId === evidence.roomId;
    const elapsed =
      sameCandidate && current.transitionStartedAt
        ? evidence.occurredAt.getTime() - current.transitionStartedAt.getTime()
        : 0;
    const previousEvidence = asEvidence(current.evidenceSummary);
    const independent = previousEvidence.some(
      (item) =>
        item.roomId === evidence.roomId && item.sensorId && item.sensorId !== evidence.sensorId,
    );
    if (
      sameCandidate &&
      (elapsed >= CONFIRMATION_DELAY_MS || independent || evidence.capability === 'person_presence')
    ) {
      await this.confirmTransition(tx, current.id, evidence, Math.min(score, 0.82), summary);
      await this.decision(
        tx,
        evidence,
        current.confirmedRoomId,
        evidence.roomId,
        path,
        'CONFIRMED',
        Math.min(score, 0.82),
        ['PERSISTENT_DESTINATION', 'INFERRED_PATH'],
        [...previousEvidence.filter((item) => item.roomId === evidence.roomId), summary].slice(-5),
        `Présence confirmée dans ${roomName} après un trajet probable.`,
      );
      return {
        acceptedForSession: true,
        confidence: evidence.confidence === 'LOW' ? 'LOW' : 'MEDIUM',
      };
    }

    const degradation = sameCandidate ? {} : this.nextInconsistency(current, evidence.occurredAt);
    const reasons = ['NON_ADJACENT_DETECTION', 'AWAITING_CONFIRMATION', 'INFERRED_PATH'];
    await tx.presenceTrackingState.update({
      where: { id: current.id },
      data: {
        status: 'IN_TRANSIT',
        candidateRoomId: evidence.roomId,
        pathRoomIds: json(path),
        confidenceScore: Math.min(score, 0.65),
        reasonCodes: json(reasons),
        evidenceSummary: json([...previousEvidence, summary].slice(-5)),
        lastEvidenceAt: evidence.occurredAt,
        transitionStartedAt: sameCandidate ? current.transitionStartedAt : evidence.occurredAt,
        ...degradation,
      },
    });
    if (!sameCandidate)
      await this.decision(
        tx,
        evidence,
        current.confirmedRoomId,
        evidence.roomId,
        path,
        'PENDING',
        Math.min(score, 0.65),
        reasons,
        [summary],
        `Déplacement probable vers ${roomName} par ${path
          .slice(1, -1)
          .map((id) => names.get(id) ?? 'une pièce intermédiaire')
          .join(', ')} ; confirmation en attente.`,
      );
    return { acceptedForSession: false, confidence: 'LOW' };
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
    if (!current || !STATEFUL_CAPABILITIES.has(evidence.capability))
      return { acceptedForSession: true, confidence: evidence.confidence };
    if (current.candidateRoomId === evidence.roomId && current.status === 'IN_TRANSIT') {
      await tx.presenceTrackingState.update({
        where: { id: current.id },
        data: {
          status: 'CONFIRMED',
          candidateRoomId: null,
          pathRoomIds: json([]),
          reasonCodes: json(['CANDIDATE_ABSENT']),
          transitionStartedAt: null,
          lastEvidenceAt: evidence.occurredAt,
        },
      });
    } else if (current.confirmedRoomId === evidence.roomId && current.status === 'CONFIRMED') {
      await tx.presenceTrackingState.update({
        where: { id: current.id },
        data: {
          status: 'STALE',
          reasonCodes: json(['EXPLICIT_ABSENCE']),
          lastEvidenceAt: evidence.occurredAt,
          confidenceScore: Math.min(current.confidenceScore, 0.45),
        },
      });
    }
    return { acceptedForSession: true, confidence: evidence.confidence };
  }

  private nextInconsistency(
    current: { inconsistencyCount: number; inconsistencyWindowAt: Date | null },
    now: Date,
  ) {
    const activeWindow =
      current.inconsistencyWindowAt &&
      now.getTime() - current.inconsistencyWindowAt.getTime() <= INCONSISTENCY_WINDOW_MS;
    const inconsistencyCount = activeWindow ? current.inconsistencyCount + 1 : 1;
    return {
      inconsistencyCount,
      inconsistencyWindowAt: activeWindow ? current.inconsistencyWindowAt : now,
      trackingDegraded: inconsistencyCount >= 3,
    };
  }

  private hasRecovered(windowAt: Date | null, now: Date): boolean {
    return Boolean(windowAt && now.getTime() - windowAt.getTime() >= RECOVERY_WINDOW_MS);
  }

  private async concurrentPresence(tx: Transaction, evidence: TrackingEvidence): Promise<boolean> {
    if (!STATEFUL_CAPABILITIES.has(evidence.capability)) return false;
    const events = await tx.observationEvent.findMany({
      where: {
        homeId: evidence.homeId,
        roomId: { not: evidence.roomId },
        sensorId: { not: null },
        capability: { in: [...STATEFUL_CAPABILITIES] },
        occurredAt: {
          gte: new Date(evidence.occurredAt.getTime() - 15 * 60_000),
          lte: evidence.occurredAt,
        },
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: { sensorId: true, payload: true, occurredAt: true },
    });
    const seen = new Set<string>();
    for (const event of events) {
      if (!event.sensorId || seen.has(event.sensorId)) continue;
      seen.add(event.sensorId);
      const payload = event.payload as Record<string, unknown>;
      if (
        payload.active === true &&
        evidence.occurredAt.getTime() - event.occurredAt.getTime() >= CONCURRENT_PRESENCE_MS
      )
        return true;
    }
    return false;
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
