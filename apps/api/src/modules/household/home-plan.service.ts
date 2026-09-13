import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  homePlanSchema,
  retireFurniture,
  type HomePlan,
  type PlanRoom,
  type RoomAdjacency,
} from '@michel/contracts';
import { Prisma, type MembershipRole } from '@prisma/client';
import { parseRequest } from '../../platform/zod-validation';
import { PrismaService } from '../../platform/prisma.service';
import { equipmentCoverage } from './equipment-coverage';

const VIEW_ROLES: MembershipRole[] = ['OWNER', 'ADMINISTRATOR', 'CAREGIVER', 'VIEWER'];
const EDIT_ROLES: MembershipRole[] = ['OWNER', 'ADMINISTRATOR'];

type Point = { x: number; y: number };

@Injectable()
export class HomePlanService {
  public constructor(private readonly prisma: PrismaService) {}

  public async get(userId: string): Promise<HomePlan> {
    const home = await this.homeFor(userId, VIEW_ROLES);
    if (home.plan) return this.enrichPlan(retireFurniture(homePlanSchema.parse(home.plan.data)));
    return this.defaultPlan(home);
  }

  public async save(userId: string, body: unknown): Promise<HomePlan> {
    const input = retireFurniture(parseRequest(homePlanSchema, body));
    const home = await this.homeFor(userId, EDIT_ROLES);
    const existingRevision = home.plan?.revision ?? 0;
    // Older clients do not know about visibility preferences. Preserve them.
    const savedPlan = home.plan ? homePlanSchema.parse(home.plan.data) : null;
    for (const room of input.levels.flatMap(({ rooms }) => rooms)) {
      room.sensorPreferences ??= savedPlan?.levels
        .flatMap(({ rooms }) => rooms)
        .find(({ id }) => id === room.id)?.sensorPreferences;
    }
    if (input.revision !== existingRevision) {
      throw new ConflictException({
        message: 'Le plan a été modifié depuis un autre écran.',
        currentRevision: existingRevision,
      });
    }

    this.validateGeometry(input);
    if (input.configured && !input.levels.some(({ rooms }) => rooms.length > 0)) {
      throw new UnprocessableEntityException(
        'Le plan doit contenir au moins une pièce avant sa confirmation.',
      );
    }
    const roomEntries = input.levels.flatMap((level) =>
      level.rooms.map((room, sortOrder) => ({ room, floor: level.floor, sortOrder })),
    );
    const roomIds = new Set(roomEntries.map(({ room }) => room.id));
    const roomNames = roomEntries.map(({ room }) => room.name.toLocaleLowerCase('fr'));
    if (new Set(roomNames).size !== roomNames.length) {
      throw new UnprocessableEntityException('Chaque pièce doit avoir un nom unique.');
    }

    const next = this.enrichPlan({
      ...input,
      revision: existingRevision + 1,
    });

    const currentRooms = await this.prisma.room.findMany({
      where: { homeId: home.id },
      select: { id: true },
    });
    const currentIds = new Set(currentRooms.map((room) => room.id));
    const colliding = await this.prisma.room.findMany({
      where: { id: { in: [...roomIds] }, homeId: { not: home.id } },
      select: { id: true },
    });
    if (colliding.length) throw new ForbiddenException('Identifiant de pièce invalide.');

    const sensors = await this.prisma.sensor.findMany({
      where: { homeId: home.id },
      select: { id: true, deviceId: true, roomId: true, removedAt: true },
    });
    const devices = await this.prisma.device.findMany({
      where: { homeId: home.id },
      select: { id: true, roomId: true, installationStatus: true },
    });
    const cameras = await this.prisma.camera.findMany({
      where: { homeId: home.id },
      select: { id: true },
    });
    const sensorIds = new Set(sensors.map(({ id }) => id));
    const deviceIds = new Set(devices.map(({ id }) => id));
    const cameraIds = new Set(cameras.map(({ id }) => id));
    const sensorDeviceIds = new Map(sensors.map(({ id, deviceId }) => [id, deviceId]));
    const explicitDevicePlacements = next.placements.filter(
      ({ equipmentRefKind }) => equipmentRefKind === 'DEVICE',
    );
    if (
      new Set(explicitDevicePlacements.map(({ equipmentId }) => equipmentId)).size !==
      explicitDevicePlacements.length
    )
      throw new UnprocessableEntityException('Un appareil ne peut avoir qu’une cible principale.');
    for (const placement of next.placements) {
      placement.targetType ??= 'ROOM';
      placement.targetId ??= placement.roomId;
      if (placement.kind === 'CAMERA') placement.equipmentRefKind = 'CAMERA';
      if (placement.kind === 'SENSOR' && !placement.equipmentRefKind) {
        const deviceId = sensorDeviceIds.get(placement.equipmentId);
        if (deviceId) {
          placement.equipmentId = deviceId;
          placement.equipmentRefKind = 'DEVICE';
        } else placement.equipmentRefKind = 'SENSOR_ENTITY';
      }
    }
    next.placements = next.placements.filter(
      (placement, index, all) =>
        placement.equipmentRefKind !== 'DEVICE' ||
        all.findIndex(
          (candidate) =>
            candidate.equipmentRefKind === 'DEVICE' &&
            candidate.equipmentId === placement.equipmentId,
        ) === index,
    );
    const placedSensorDevices = new Set(
      next.placements
        .filter(
          (placement) => placement.kind === 'SENSOR' && placement.equipmentRefKind === 'DEVICE',
        )
        .map((placement) => placement.equipmentId),
    );
    const placedStandaloneSensors = new Set(
      next.placements
        .filter(
          (placement) =>
            placement.kind === 'SENSOR' && placement.equipmentRefKind === 'SENSOR_ENTITY',
        )
        .map((placement) => placement.equipmentId),
    );
    if (
      devices.some(({ id, roomId }) => roomId && !placedSensorDevices.has(id)) ||
      sensors.some(
        ({ id, deviceId, roomId, removedAt }) =>
          roomId && !deviceId && !removedAt && !placedStandaloneSensors.has(id),
      )
    )
      throw new UnprocessableEntityException(
        'Déplacez ou retirez les capteurs installés avant de supprimer leur emplacement.',
      );
    const placedDeviceIds = new Set<string>();
    for (const placement of next.placements) {
      if (!roomIds.has(placement.roomId))
        throw new UnprocessableEntityException('Un équipement cible une pièce inexistante.');
      if (placement.kind === 'SENSOR') {
        if (placement.equipmentRefKind === 'DEVICE') {
          if (!deviceIds.has(placement.equipmentId))
            throw new UnprocessableEntityException('Appareil inconnu dans le plan.');
          if (placedDeviceIds.has(placement.equipmentId))
            throw new UnprocessableEntityException(
              'Un appareil ne peut avoir qu’une cible principale.',
            );
          placedDeviceIds.add(placement.equipmentId);
        } else if (!sensorIds.has(placement.equipmentId))
          throw new UnprocessableEntityException('Capteur inconnu dans le plan.');
      }
      if (placement.kind === 'CAMERA' && !cameraIds.has(placement.equipmentId))
        throw new UnprocessableEntityException('Caméra inconnue dans le plan.');
      this.validatePlacementTarget(next, placement);
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.sensor.updateMany({ where: { homeId: home.id }, data: { roomId: null } });
        await tx.device.updateMany({ where: { homeId: home.id }, data: { roomId: null } });
        await tx.camera.updateMany({ where: { homeId: home.id }, data: { roomId: null } });

        for (const { room, floor, sortOrder } of roomEntries) {
          const data = {
            name: room.name,
            kind: room.kind,
            floor,
            sortOrder,
            geometry: room.geometry as unknown as Prisma.InputJsonValue,
          };
          if (currentIds.has(room.id)) await tx.room.update({ where: { id: room.id }, data });
          else await tx.room.create({ data: { id: room.id, homeId: home.id, ...data } });
        }

        const removed = currentRooms.filter(({ id }) => !roomIds.has(id)).map(({ id }) => id);
        if (removed.length)
          await tx.room.deleteMany({ where: { id: { in: removed }, homeId: home.id } });

        for (const placement of next.placements) {
          if (placement.kind === 'SENSOR') {
            if (placement.equipmentRefKind === 'DEVICE') {
              await tx.device.update({
                where: { id: placement.equipmentId },
                data: {
                  roomId: placement.roomId,
                  ...(devices.find(({ id }) => id === placement.equipmentId)?.roomId !==
                  placement.roomId
                    ? { installationStatus: 'NEEDS_TEST' }
                    : {}),
                },
              });
              await tx.sensor.updateMany({
                where: { deviceId: placement.equipmentId, homeId: home.id },
                data: { roomId: placement.roomId },
              });
            } else
              await tx.sensor.update({
                where: { id: placement.equipmentId },
                data: { roomId: placement.roomId },
              });
          } else {
            await tx.camera.update({
              where: { id: placement.equipmentId },
              data: { roomId: placement.roomId },
            });
          }
        }

        await tx.home.update({
          where: { id: home.id },
          data: {
            floorCount: next.levels.length,
            ...(next.configured && home.installationStatus === 'DRAFT'
              ? { installationStatus: 'LEARNING' as const, learningStartedAt: new Date() }
              : {}),
          },
        });
        if (home.plan) {
          const updated = await tx.homePlan.updateMany({
            where: { homeId: home.id, revision: input.revision },
            data: {
              revision: next.revision,
              schemaVersion: next.schemaVersion,
              data: next,
            },
          });
          if (updated.count !== 1) throw new ConflictException('Le plan a déjà été modifié.');
        } else {
          await tx.homePlan.create({
            data: {
              homeId: home.id,
              revision: next.revision,
              schemaVersion: next.schemaVersion,
              data: next,
            },
          });
        }
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Le plan a déjà été créé depuis un autre écran.');
      }
      throw error;
    }
    return next;
  }

  public async coverage(userId: string) {
    const plan = await this.get(userId);
    const home = await this.homeFor(userId, VIEW_ROLES);
    const [devices, standalone] = await Promise.all([
      this.prisma.device.findMany({
        where: { homeId: home.id, roomId: { not: null }, sensors: { some: { removedAt: null } } },
        include: { sensors: { where: { removedAt: null } } },
      }),
      this.prisma.sensor.findMany({
        where: { homeId: home.id, roomId: { not: null }, deviceId: null, removedAt: null },
      }),
    ]);
    return equipmentCoverage(plan, [
      ...devices.map((device) => ({
        id: device.id,
        name: device.displayName ?? device.name,
        manufacturer: device.manufacturer,
        model: device.model,
        capabilities: device.sensors.map((sensor) => ({
          sensorId: sensor.id,
          capability: sensor.capability,
        })),
      })),
      ...standalone.map((sensor) => ({
        id: `sensor:${sensor.id}`,
        name: sensor.sourceName ?? sensor.entityId,
        manufacturer: null,
        model: null,
        capabilities: [{ sensorId: sensor.id, capability: sensor.capability }],
      })),
    ]);
  }

  public async presence(userId: string) {
    const home = await this.homeFor(userId, VIEW_ROLES);
    const tracking = await this.prisma.presenceTrackingState.findUnique({
      where: { homeId: home.id },
      include: {
        confirmedRoom: { select: { name: true } },
        candidateRoom: { select: { name: true } },
      },
    });
    if (tracking) {
      const age = tracking.lastEvidenceAt
        ? Date.now() - tracking.lastEvidenceAt.getTime()
        : Infinity;
      const trackingState = age > 15 * 60_000 ? ('STALE' as const) : tracking.status;
      const pathRoomIds = this.jsonStrings(tracking.pathRoomIds);
      const evidenceSummary = this.jsonEvidence(tracking.evidenceSummary);
      const explanation = this.presenceExplanation(
        trackingState,
        tracking.confirmedRoom?.name ?? null,
        tracking.candidateRoom?.name ?? null,
        pathRoomIds.length,
      );
      const confidence =
        tracking.confidenceScore >= 0.8
          ? ('HIGH' as const)
          : tracking.confidenceScore >= 0.5
            ? ('MEDIUM' as const)
            : ('LOW' as const);
      return {
        sessionId: tracking.id,
        state:
          trackingState === 'CONFIRMED'
            ? ('OPEN' as const)
            : trackingState === 'IN_TRANSIT' || trackingState === 'AMBIGUOUS'
              ? ('AMBIGUOUS' as const)
              : ('CLOSED' as const),
        since: (tracking.transitionStartedAt ?? tracking.lastEvidenceAt)?.toISOString() ?? null,
        lastConfirmedAt: tracking.lastEvidenceAt?.toISOString() ?? null,
        durationSeconds: tracking.lastEvidenceAt
          ? Math.max(0, Math.round((Date.now() - tracking.lastEvidenceAt.getTime()) / 1_000))
          : null,
        roomId: trackingState === 'STALE' ? null : tracking.confirmedRoomId,
        detectedAt: tracking.lastEvidenceAt?.toISOString() ?? null,
        confidence,
        identifiedResidentId: tracking.residentId,
        source: evidenceSummary.some((item) => item.capability === 'person_presence')
          ? ('CAMERA' as const)
          : ('SENSOR' as const),
        plausibleTransition:
          trackingState === 'IN_TRANSIT'
            ? null
            : !this.jsonStrings(tracking.reasonCodes).includes('IMPLAUSIBLE_TRANSITION'),
        ambiguousReason: this.jsonStrings(tracking.reasonCodes)[0] ?? null,
        trackingState,
        confirmedRoomId: tracking.confirmedRoomId,
        candidateRoomId: tracking.candidateRoomId,
        pathRoomIds,
        confidenceScore: tracking.confidenceScore,
        reasonCodes: this.jsonStrings(tracking.reasonCodes),
        explanation,
        lastEvidenceAt: tracking.lastEvidenceAt?.toISOString() ?? null,
        evidenceSummary,
        trackingDegraded: tracking.trackingDegraded,
      };
    }
    const session = await this.prisma.roomPresenceSession.findFirst({
      where: { homeId: home.id },
      orderBy: { lastConfirmedAt: 'desc' },
    });
    if (!session) {
      return {
        sessionId: null,
        state: 'UNKNOWN' as const,
        since: null,
        lastConfirmedAt: null,
        durationSeconds: null,
        roomId: null,
        detectedAt: null,
        confidence: 'UNKNOWN' as const,
        identifiedResidentId: null,
        source: 'NONE' as const,
        plausibleTransition: null,
        ambiguousReason: null,
        trackingState: 'UNKNOWN' as const,
        confirmedRoomId: null,
        candidateRoomId: null,
        pathRoomIds: [],
        confidenceScore: 0,
        reasonCodes: [],
        explanation: 'Aucune présence fiable pour le moment.',
        lastEvidenceAt: null,
        evidenceSummary: [],
        trackingDegraded: false,
      };
    }
    const active =
      session.endedAt === null && (session.state === 'OPEN' || session.state === 'AMBIGUOUS');
    const end = session.endedAt ?? new Date();
    return {
      sessionId: session.id,
      state: session.state,
      since: session.startedAt.toISOString(),
      lastConfirmedAt: session.lastConfirmedAt.toISOString(),
      durationSeconds: Math.max(
        0,
        Math.round((end.getTime() - session.startedAt.getTime()) / 1_000),
      ),
      roomId: active ? session.roomId : null,
      detectedAt: session.lastConfirmedAt.toISOString(),
      confidence: session.confidence,
      identifiedResidentId: null,
      source: session.source === 'COMBINED' ? ('SENSOR' as const) : session.source,
      plausibleTransition: session.plausibleTransition,
      ambiguousReason: session.ambiguousReason,
      trackingState: active
        ? session.state === 'AMBIGUOUS'
          ? ('AMBIGUOUS' as const)
          : ('CONFIRMED' as const)
        : ('STALE' as const),
      confirmedRoomId: session.roomId,
      candidateRoomId: null,
      pathRoomIds: [],
      confidenceScore:
        session.confidence === 'HIGH' ? 0.9 : session.confidence === 'MEDIUM' ? 0.65 : 0.35,
      reasonCodes: session.ambiguousReason ? [session.ambiguousReason] : [],
      explanation: active ? 'Présence issue du suivi historique.' : 'Dernière présence connue.',
      lastEvidenceAt: session.lastConfirmedAt.toISOString(),
      evidenceSummary: [],
      trackingDegraded: false,
    };
  }

  public async presenceHistory(userId: string, limit = 20, cursor?: string) {
    const home = await this.homeFor(userId, VIEW_ROLES);
    const items = await this.prisma.presenceTransitionDecision.findMany({
      where: { homeId: home.id },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > limit;
    return {
      items: items.slice(0, limit).map((item) => ({
        id: item.id,
        fromRoomId: item.fromRoomId,
        toRoomId: item.toRoomId,
        pathRoomIds: this.jsonStrings(item.pathRoomIds),
        outcome: item.outcome,
        confidenceScore: item.confidenceScore,
        reasonCodes: this.jsonStrings(item.reasonCodes),
        evidenceSummary: this.jsonEvidence(item.evidenceSummary),
        explanation: item.explanation,
        occurredAt: item.occurredAt.toISOString(),
        confirmedAt: item.confirmedAt?.toISOString() ?? null,
      })),
      nextCursor: hasMore ? (items[limit - 1]?.id ?? null) : null,
    };
  }

  private jsonStrings(value: Prisma.JsonValue): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private jsonEvidence(value: Prisma.JsonValue) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const entry = item as Record<string, unknown>;
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
          observed: entry.observed !== false,
        },
      ];
    });
  }

  private presenceExplanation(
    status: 'CONFIRMED' | 'IN_TRANSIT' | 'AMBIGUOUS' | 'STALE' | 'UNKNOWN',
    confirmed: string | null,
    candidate: string | null,
    pathLength: number,
  ): string {
    if (status === 'CONFIRMED')
      return `Présence confirmée dans ${confirmed ?? 'une pièce du logement'}.`;
    if (status === 'IN_TRANSIT')
      return `Déplacement probable de ${confirmed ?? 'la dernière pièce fiable'} vers ${candidate ?? 'une autre pièce'}${pathLength > 2 ? ', avec un passage intermédiaire non observé' : ''}.`;
    if (status === 'AMBIGUOUS')
      return 'Plusieurs présences ou des preuves contradictoires empêchent une attribution fiable.';
    if (status === 'STALE')
      return `Dernière présence fiable dans ${confirmed ?? 'le logement'}, sans confirmation récente.`;
    return 'Aucune présence fiable pour le moment.';
  }

  private connectionsFor(plan: HomePlan) {
    const connections = plan.levels.flatMap((level) => [
      ...level.openings
        .filter(
          (opening) =>
            (opening.kind === 'DOOR' || opening.kind === 'PASSAGE') && opening.roomIds.length === 2,
        )
        .map((opening) => ({
          id: `${opening.kind.toLowerCase()}:${opening.id}`,
          kind: opening.kind === 'PASSAGE' ? ('PASSAGE' as const) : ('DOOR' as const),
          fromRoomId: opening.roomIds[0]!,
          toRoomId: opening.roomIds[1]!,
        })),
      ...level.stairs.map((stair) => ({
        id: `stair:${stair.id}`,
        kind: 'STAIR' as const,
        fromRoomId: stair.fromRoomId,
        toRoomId: stair.toRoomId,
      })),
    ]);
    return [...new Map(connections.map((item) => [item.id, item])).values()];
  }

  private adjacenciesFor(plan: HomePlan): RoomAdjacency[] {
    const adjacencies: RoomAdjacency[] = [];
    for (const level of plan.levels) {
      for (let left = 0; left < level.rooms.length; left += 1) {
        for (let right = left + 1; right < level.rooms.length; right += 1) {
          const first = level.rooms[left]!;
          const second = level.rooms[right]!;
          const boundary = this.sharedBoundary(first, second);
          if (!boundary) continue;
          const roomIds = [first.id, second.id].sort() as [string, string];
          adjacencies.push({
            id: `adjacency:${level.id}:${roomIds[0]}:${roomIds[1]}`,
            floorId: level.id,
            roomIds,
            sharedWallCm: Math.round(boundary.length * 10) / 10,
            gapCm: Math.round(boundary.gap * 10) / 10,
            quality: boundary.gap <= 2 ? 'EXACT' : 'NEAR',
          });
        }
      }
    }
    return adjacencies;
  }

  private sharedBoundary(first: PlanRoom, second: PlanRoom) {
    let best: { length: number; gap: number } | null = null;
    for (let firstIndex = 0; firstIndex < first.geometry.points.length; firstIndex += 1) {
      const start = first.geometry.points[firstIndex]!;
      const end = first.geometry.points[(firstIndex + 1) % first.geometry.points.length]!;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);
      if (length < 40) continue;
      const ux = dx / length;
      const uy = dy / length;
      for (let secondIndex = 0; secondIndex < second.geometry.points.length; secondIndex += 1) {
        const otherStart = second.geometry.points[secondIndex]!;
        const otherEnd = second.geometry.points[(secondIndex + 1) % second.geometry.points.length]!;
        const otherDx = otherEnd.x - otherStart.x;
        const otherDy = otherEnd.y - otherStart.y;
        const otherLength = Math.hypot(otherDx, otherDy);
        if (otherLength < 40) continue;
        const parallel = Math.abs(ux * (otherDy / otherLength) - uy * (otherDx / otherLength));
        if (parallel > 0.02) continue;
        const gap = Math.abs((otherStart.x - start.x) * uy - (otherStart.y - start.y) * ux);
        if (gap > 30) continue;
        const firstProjection = (otherStart.x - start.x) * ux + (otherStart.y - start.y) * uy;
        const secondProjection = (otherEnd.x - start.x) * ux + (otherEnd.y - start.y) * uy;
        const overlapStart = Math.max(0, Math.min(firstProjection, secondProjection));
        const overlapEnd = Math.min(length, Math.max(firstProjection, secondProjection));
        const overlap = overlapEnd - overlapStart;
        if (overlap < 40) continue;
        if (!best || overlap > best.length || (overlap === best.length && gap < best.gap)) {
          best = { length: overlap, gap };
        }
      }
    }
    return best;
  }

  private enrichPlan(plan: HomePlan): HomePlan {
    const levels = plan.levels.map((level) => ({
      ...level,
      rooms: level.rooms.map((room) => ({
        ...room,
        areaM2: room.areaM2 ?? this.polygonArea(room.geometry.points) / 10_000,
      })),
    }));
    const connections = this.connectionsFor(plan);
    const adjacencies = this.adjacenciesFor(plan);
    const connectedPairs = new Set(
      connections.map(({ fromRoomId, toRoomId }) => [fromRoomId, toRoomId].sort().join(':')),
    );
    const connectedRoomIds = new Set(
      connections.flatMap(({ fromRoomId, toRoomId }) => [fromRoomId, toRoomId]),
    );
    const allRooms = plan.levels.flatMap(({ rooms }) => rooms);
    const stairs = plan.levels.flatMap(({ stairs }) => stairs);
    const roomIds = new Set(allRooms.map(({ id }) => id));
    const floorIds = new Set(plan.levels.map(({ id }) => id));
    return {
      ...plan,
      schemaVersion: 4,
      setupDraft: plan.setupDraft ?? null,
      levels,
      connections,
      adjacencies,
      understanding: {
        levels: plan.levels.map((level) => ({
          floorId: level.id,
          roomCount: level.rooms.length,
          areaM2:
            Math.round(
              level.rooms.reduce(
                (total, room) =>
                  total + (room.areaM2 ?? this.polygonArea(room.geometry.points) / 10_000),
                0,
              ) * 10,
            ) / 10,
          approximate: level.scaleCmPerUnit === null,
        })),
        isolatedRoomIds:
          allRooms.length > 1
            ? allRooms.filter(({ id }) => !connectedRoomIds.has(id)).map(({ id }) => id)
            : [],
        adjacentWithoutPassage: adjacencies
          .filter(
            ({ roomIds: [first, second] }) => !connectedPairs.has([first, second].sort().join(':')),
          )
          .map(({ roomIds }) => roomIds),
        nearAdjacencyIds: adjacencies
          .filter(({ quality }) => quality === 'NEAR')
          .map(({ id }) => id),
        floorsWithoutStairs:
          plan.levels.length > 1
            ? plan.levels
                .filter(
                  ({ id }) =>
                    !stairs.some(
                      ({ fromFloorId, toFloorId }) => fromFloorId === id || toFloorId === id,
                    ),
                )
                .map(({ id }) => id)
            : [],
        incompleteStairIds: stairs
          .filter(
            ({ fromFloorId, toFloorId, fromRoomId, toRoomId }) =>
              !floorIds.has(fromFloorId) ||
              !floorIds.has(toFloorId) ||
              !roomIds.has(fromRoomId) ||
              !roomIds.has(toRoomId),
          )
          .map(({ id }) => id),
        mainEntranceOpeningId:
          plan.levels
            .flatMap(({ openings }) => openings)
            .find(({ isMainEntrance }) => isMainEntrance)?.id ?? null,
      },
    };
  }

  private validateGeometry(plan: HomePlan) {
    const levelIds = new Set(plan.levels.map((level) => level.id));
    if (levelIds.size !== plan.levels.length)
      throw new UnprocessableEntityException('Deux niveaux ont le même identifiant.');
    const allRooms = new Map<string, PlanRoom>();
    const mainEntrances = plan.levels
      .flatMap(({ openings }) => openings)
      .filter(({ isMainEntrance }) => isMainEntrance);
    if (mainEntrances.length > 1)
      throw new UnprocessableEntityException('Le logement ne peut avoir qu’une entrée principale.');
    if (mainEntrances.some(({ kind, roomIds }) => kind !== 'DOOR' || roomIds.length !== 1))
      throw new UnprocessableEntityException(
        'L’entrée principale doit être une porte donnant vers l’extérieur.',
      );
    for (const level of plan.levels) {
      for (const room of level.rooms) {
        if (allRooms.has(room.id))
          throw new UnprocessableEntityException('Deux pièces ont le même identifiant.');
        if (
          this.polygonArea(room.geometry.points) < 2_500 ||
          this.selfIntersects(room.geometry.points)
        )
          throw new UnprocessableEntityException(`La forme de « ${room.name} » est invalide.`);
        allRooms.set(room.id, room);
      }
      for (let left = 0; left < level.rooms.length; left += 1) {
        for (let right = left + 1; right < level.rooms.length; right += 1) {
          if (
            this.polygonsOverlap(
              level.rooms[left]!.geometry.points,
              level.rooms[right]!.geometry.points,
            )
          )
            throw new UnprocessableEntityException('Deux pièces se chevauchent.');
        }
      }
      for (const opening of level.openings) {
        if (opening.hostRoomId && !opening.roomIds.includes(opening.hostRoomId))
          throw new UnprocessableEntityException(
            'Le côté choisi pour une ouverture ne correspond pas à ses pièces.',
          );
        if (opening.logical) {
          if (
            (opening.kind !== 'DOOR' && opening.kind !== 'PASSAGE') ||
            opening.roomIds.length !== 2 ||
            opening.roomIds.some((roomId) => !level.rooms.some(({ id }) => id === roomId))
          )
            throw new UnprocessableEntityException('Une liaison logique est invalide.');
          continue;
        }
        for (const roomId of opening.roomIds) {
          const room = allRooms.get(roomId) ?? level.rooms.find((item) => item.id === roomId);
          if (!room || !this.onBoundary({ x: opening.x, y: opening.y }, room.geometry.points, 30))
            throw new UnprocessableEntityException('Une ouverture ne se trouve pas sur un mur.');
        }
      }
    }
    for (const level of plan.levels) {
      for (const stair of level.stairs) {
        if (
          !levelIds.has(stair.fromFloorId) ||
          !levelIds.has(stair.toFloorId) ||
          !allRooms.has(stair.fromRoomId) ||
          !allRooms.has(stair.toRoomId)
        )
          throw new UnprocessableEntityException('Un escalier possède une connexion invalide.');
      }
    }
  }

  private validatePlacementTarget(plan: HomePlan, placement: HomePlan['placements'][number]) {
    const level = plan.levels.find(({ id }) => id === placement.floorId);
    const targetId = placement.targetId ?? placement.roomId;
    if (!level) throw new UnprocessableEntityException('Le niveau de l’équipement est invalide.');
    const valid =
      placement.targetType === 'ROOM'
        ? level.rooms.some(({ id }) => id === targetId && id === placement.roomId)
        : placement.targetType === 'ITEM'
          ? level.items.some(({ id, roomId }) => id === targetId && roomId === placement.roomId)
          : placement.targetType === 'OPENING'
            ? level.openings.some(
                ({ id, roomIds }) => id === targetId && roomIds.includes(placement.roomId),
              )
            : level.stairs.some(
                ({ id, fromRoomId, toRoomId }) =>
                  id === targetId && [fromRoomId, toRoomId].includes(placement.roomId),
              );
    if (!valid) throw new UnprocessableEntityException('La cible de l’équipement est invalide.');
  }

  private polygonArea(points: Point[]) {
    return Math.abs(
      points.reduce((sum, point, index) => {
        const next = points[(index + 1) % points.length]!;
        return sum + point.x * next.y - next.x * point.y;
      }, 0) / 2,
    );
  }

  private selfIntersects(points: Point[]) {
    for (let a = 0; a < points.length; a += 1) {
      for (let b = a + 1; b < points.length; b += 1) {
        if (Math.abs(a - b) <= 1 || (a === 0 && b === points.length - 1)) continue;
        if (
          this.segmentsCross(
            points[a]!,
            points[(a + 1) % points.length]!,
            points[b]!,
            points[(b + 1) % points.length]!,
          )
        )
          return true;
      }
    }
    return false;
  }

  private polygonsOverlap(left: Point[], right: Point[]) {
    if (this.inside(left[0]!, right) || this.inside(right[0]!, left)) return true;
    for (let a = 0; a < left.length; a += 1) {
      for (let b = 0; b < right.length; b += 1) {
        if (
          this.segmentsCross(
            left[a]!,
            left[(a + 1) % left.length]!,
            right[b]!,
            right[(b + 1) % right.length]!,
          )
        )
          return true;
      }
    }
    return false;
  }

  private inside(point: Point, polygon: Point[]) {
    let result = false;
    for (
      let current = 0, previous = polygon.length - 1;
      current < polygon.length;
      previous = current++
    ) {
      const a = polygon[current]!;
      const b = polygon[previous]!;
      if (this.onSegment(point, a, b, 0.001)) return false;
      if (
        a.y > point.y !== b.y > point.y &&
        point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
      )
        result = !result;
    }
    return result;
  }

  private segmentsCross(a: Point, b: Point, c: Point, d: Point) {
    const cross = (p: Point, q: Point, r: Point) =>
      (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const values = [cross(a, b, c), cross(a, b, d), cross(c, d, a), cross(c, d, b)];
    return values[0]! * values[1]! < -0.001 && values[2]! * values[3]! < -0.001;
  }

  private onBoundary(point: Point, polygon: Point[], tolerance: number) {
    return polygon.some((start, index) =>
      this.onSegment(point, start, polygon[(index + 1) % polygon.length]!, tolerance),
    );
  }

  private onSegment(point: Point, start: Point, end: Point, tolerance: number) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared
      ? Math.max(
          0,
          Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
        )
      : 0;
    const x = start.x + ratio * dx;
    const y = start.y + ratio * dy;
    return Math.hypot(point.x - x, point.y - y) <= tolerance;
  }

  private defaultPlan(home: Awaited<ReturnType<HomePlanService['homeFor']>>): HomePlan {
    const needsSetup = home.installationStatus === 'DRAFT';
    const levelCount = Math.max(1, home.floorCount);
    const levels = Array.from({ length: levelCount }, (_, floor) => {
      const rooms = home.rooms.filter((room) => room.floor === floor);
      return {
        id: `floor-${floor}`,
        name: floor === 0 ? 'Rez-de-chaussée' : floor === 1 ? '1er étage' : `${floor}e étage`,
        floor,
        order: floor,
        width: 1_200,
        height: 800,
        scaleCmPerUnit: null,
        rooms: rooms.map((room, index) => {
          const column = index % 3;
          const row = Math.floor(index / 3);
          const x = 60 + column * 360;
          const y = 60 + row * 270;
          return {
            id: room.id,
            name: room.name,
            kind: room.kind,
            geometry: {
              points: [
                { x, y },
                { x: x + 320, y },
                { x: x + 320, y: y + 230 },
                { x, y: y + 230 },
              ],
              color: '#E8F0F3',
            },
          };
        }),
        openings: [],
        stairs: [],
        items: [],
      };
    });
    const placements = [
      ...home.sensors
        .filter((sensor) => sensor.roomId)
        .map((sensor, index) =>
          this.defaultPlacement('SENSOR', sensor.id, sensor.roomId!, levels, index),
        ),
      ...home.cameras
        .filter((camera) => camera.roomId)
        .map((camera, index) =>
          this.defaultPlacement('CAMERA', camera.id, camera.roomId!, levels, index),
        ),
    ].filter((placement): placement is NonNullable<typeof placement> => Boolean(placement));
    return this.enrichPlan({
      schemaVersion: 4,
      revision: 0,
      configured: !needsSetup,
      setupDraft: needsSetup
        ? {
            stage: 'DETAILS',
            requestedRooms: [],
            tutorialCompleted: false,
          }
        : null,
      levels,
      placements,
      connections: [],
      adjacencies: [],
      understanding: {
        levels: [],
        isolatedRoomIds: [],
        adjacentWithoutPassage: [],
        nearAdjacencyIds: [],
        floorsWithoutStairs: [],
        incompleteStairIds: [],
      },
    });
  }

  private defaultPlacement(
    kind: 'SENSOR' | 'CAMERA',
    equipmentId: string,
    roomId: string,
    levels: HomePlan['levels'],
    index: number,
  ) {
    const level = levels.find((item) => item.rooms.some((room) => room.id === roomId));
    const room = level?.rooms.find((item) => item.id === roomId);
    if (!level || !room) return null;
    const xs = room.geometry.points.map(({ x }) => x);
    const ys = room.geometry.points.map(({ y }) => y);
    return {
      id: `placement-${kind.toLowerCase()}-${equipmentId}`,
      kind,
      equipmentId,
      equipmentRefKind: kind === 'CAMERA' ? ('CAMERA' as const) : ('SENSOR_ENTITY' as const),
      roomId,
      floorId: level.id,
      openingId: null,
      targetType: 'ROOM' as const,
      targetId: roomId,
      capabilityBindings: [],
      x: Math.min(...xs) + 45 + (index % 4) * 35,
      y: Math.min(...ys) + 45,
      rotation: 0,
    };
  }

  private async homeFor(userId: string, roles: MembershipRole[]) {
    const home = await this.prisma.home.findFirst({
      where: {
        organization: {
          memberships: { some: { userId, disabledAt: null, systemRole: { in: roles } } },
        },
      },
      include: {
        plan: true,
        rooms: { orderBy: [{ floor: 'asc' }, { sortOrder: 'asc' }] },
        sensors: { select: { id: true, roomId: true } },
        cameras: { select: { id: true, roomId: true } },
      },
    });
    if (!home) throw new ForbiddenException('Accès au logement refusé.');
    return home;
  }
}
