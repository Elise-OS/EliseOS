import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  deviceSupportsCategory,
  homePlanSchema,
  isBedOccupancySensorModel,
  lightFeaturesSchema,
  localMinuteOfDay,
  minuteInNightWindow,
  NIGHT_PATH_TEST_SECONDS,
  nightPathInputSchema,
  nightPathTestSchema,
  nightPathTurnOffData,
  nightPathTurnOnData,
  nightPathUpdateSchema,
  type LightFeatures,
  type NightPath,
  type NightPathOverview,
  type NightPathRoom,
} from '@elise/contracts';
import type { NightLightPath, Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { parseRequest } from '../../platform/zod-validation';
import { rolesFor } from '../auth/access-policy';
import { IngestionService, type IngestedObservation } from '../sensing/ingestion.service';
import { MqttIngestionService } from '../sensing/mqtt-ingestion.service';

const MANAGERS = rolesFor('configuration:manage');
const MOVEMENT_CAPABILITIES = new Set(['motion', 'occupancy', 'person_presence']);
/** An observation older than this is a replay (reconnection, backlog): it never lights a path. */
const MAX_TRIGGER_AGE_MS = 2 * 60_000;
/** A presence sensor still reporting someone keeps the path lit, but not forever. */
const STILL_PRESENT_WINDOW_MS = 30 * 60_000;
/** After a restart, give MQTT a moment to reconnect before turning overdue lights off. */
const STARTUP_GRACE_MS = 5_000;
const MAX_TIMER_MS = 2_147_000_000;

type LightTarget = {
  entityId: string;
  state: string | null;
  available: boolean;
  features: LightFeatures | null;
};

type Trigger = 'MOVEMENT' | 'BED_EXIT' | 'PRESENCE_ENDED';

/** How an observation can start or keep a night path. Exported for tests. */
export function nightPathTrigger(observation: IngestedObservation): Trigger | null {
  if (!observation.enabled || observation.quality !== 'good') return null;
  const bed =
    observation.role === 'BED' ||
    (observation.capability === 'occupancy' && isBedOccupancySensorModel(observation.model));
  if (bed) {
    const raw =
      typeof observation.payload.open === 'boolean'
        ? observation.payload.open
        : typeof observation.payload.active === 'boolean'
          ? observation.payload.active
          : null;
    if (raw === null) return null;
    const occupiedWhen =
      observation.bedOccupiedWhen ?? (observation.capability === 'occupancy' ? 'OPEN' : 'CLOSED');
    const occupied = occupiedWhen === 'OPEN' ? raw : !raw;
    return occupied ? null : 'BED_EXIT';
  }
  if (!MOVEMENT_CAPABILITIES.has(observation.capability)) return null;
  if (observation.payload.active === true) return 'MOVEMENT';
  if (observation.payload.active === false) return 'PRESENCE_ENDED';
  return null;
}

function parseFeatures(value: Prisma.JsonValue | null): LightFeatures | null {
  const parsed = lightFeaturesSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

@Injectable()
export class NightPathService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NightPathService.name);
  private timer: NodeJS.Timeout | undefined;
  private queue: Promise<void> = Promise.resolve();
  private unsubscribe: (() => void) | undefined;

  public constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: IngestionService,
    private readonly mqtt: MqttIngestionService,
  ) {}

  public onModuleInit(): void {
    this.unsubscribe = this.ingestion.onIngested((observation) => {
      void this.enqueue(() => this.handleObservation(observation));
    });
    // Lights turned on before a restart must still be turned off.
    void this.enqueue(() => this.reschedule(STARTUP_GRACE_MS));
  }

  public onModuleDestroy(): void {
    this.unsubscribe?.();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Serialises every change of light ownership: events, timers and API calls. */
  public enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.then(
      () => undefined,
      (error: unknown) => this.logger.error('Night path task failed', error),
    );
    return run;
  }

  // ---------------------------------------------------------------- REST

  public async overview(userId: string): Promise<NightPathOverview> {
    const home = await this.homeFor(userId, false);
    const [paths, activations, rooms] = await Promise.all([
      this.prisma.nightLightPath.findMany({
        where: { homeId: home.id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.nightLightActivation.findMany({ where: { homeId: home.id } }),
      this.rooms(home.id),
    ]);
    return {
      timezone: home.timezone,
      paths: paths.map((path) =>
        this.view(
          path,
          activations.filter(({ pathId }) => pathId === path.id),
        ),
      ),
      rooms,
    };
  }

  public async create(userId: string, body: unknown): Promise<NightPath> {
    const input = parseRequest(nightPathInputSchema, body);
    const home = await this.homeFor(userId, true);
    await this.assertRooms(home.id, [...input.triggerRoomIds, ...input.lightRoomIds]);
    const path = await this.prisma.$transaction(async (tx) => {
      const created = await tx.nightLightPath.create({
        data: {
          homeId: home.id,
          ...input,
          triggerRoomIds: [...new Set(input.triggerRoomIds)],
          lightRoomIds: [...new Set(input.lightRoomIds)],
        },
      });
      await tx.auditLog.create({
        data: {
          homeId: home.id,
          actorId: userId,
          action: 'NIGHT_PATH_CREATED',
          target: created.id,
          metadata: { name: created.name, enabled: created.enabled },
        },
      });
      return created;
    });
    return this.view(path, []);
  }

  public async update(userId: string, id: string, body: unknown): Promise<NightPath> {
    const input = parseRequest(nightPathUpdateSchema, body);
    const home = await this.homeFor(userId, true);
    const current = await this.prisma.nightLightPath.findFirst({ where: { id, homeId: home.id } });
    if (!current) throw new NotFoundException('Chemin lumineux introuvable.');
    const startMinute = input.startMinute ?? current.startMinute;
    const endMinute = input.endMinute ?? current.endMinute;
    if (startMinute === endMinute)
      throw new UnprocessableEntityException('Le début et la fin de la nuit doivent différer.');
    await this.assertRooms(home.id, [
      ...(input.triggerRoomIds ?? []),
      ...(input.lightRoomIds ?? []),
    ]);
    const path = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.nightLightPath.update({
        where: { id },
        data: {
          ...(Object.fromEntries(
            Object.entries(input).filter(([, value]) => value !== undefined),
          ) as Prisma.NightLightPathUpdateInput),
          ...(input.triggerRoomIds ? { triggerRoomIds: [...new Set(input.triggerRoomIds)] } : {}),
          ...(input.lightRoomIds ? { lightRoomIds: [...new Set(input.lightRoomIds)] } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          homeId: home.id,
          actorId: userId,
          action: 'NIGHT_PATH_UPDATED',
          target: id,
          metadata: { name: updated.name, enabled: updated.enabled, fields: Object.keys(input) },
        },
      });
      return updated;
    });
    // A path switched off, or whose rooms changed, releases the lights it turned on.
    if (!path.enabled || input.lightRoomIds) await this.release(home.id, id);
    const activations = await this.prisma.nightLightActivation.findMany({
      where: { homeId: home.id, pathId: id },
    });
    return this.view(path, activations);
  }

  public async remove(userId: string, id: string) {
    const home = await this.homeFor(userId, true);
    const current = await this.prisma.nightLightPath.findFirst({ where: { id, homeId: home.id } });
    if (!current) throw new NotFoundException('Chemin lumineux introuvable.');
    await this.prisma.$transaction(async (tx) => {
      await tx.nightLightPath.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          homeId: home.id,
          actorId: userId,
          action: 'NIGHT_PATH_DELETED',
          target: id,
          metadata: { name: current.name },
        },
      });
    });
    await this.release(home.id, id);
    return { deleted: true, id };
  }

  /** « Tester » : lights the chosen rooms for a few seconds, whatever the time. */
  public async test(userId: string, body: unknown) {
    const input = parseRequest(nightPathTestSchema, body);
    const home = await this.homeFor(userId, true);
    await this.assertRooms(home.id, input.lightRoomIds);
    const lit = await this.enqueue(() =>
      this.light(home.id, null, input.lightRoomIds, input, NIGHT_PATH_TEST_SECONDS * 1_000, false),
    );
    await this.prisma.auditLog.create({
      data: {
        homeId: home.id,
        actorId: userId,
        action: 'NIGHT_PATH_TESTED',
        target: home.id,
        metadata: { rooms: input.lightRoomIds.length, lights: lit },
      },
    });
    return { lights: lit, seconds: NIGHT_PATH_TEST_SECONDS };
  }

  // ---------------------------------------------------------------- Runtime

  public async handleObservation(observation: IngestedObservation): Promise<void> {
    const trigger = nightPathTrigger(observation);
    if (!trigger || !observation.roomId) return;
    const now = this.now();
    if (now.getTime() - observation.occurredAt.getTime() > MAX_TRIGGER_AGE_MS) return;
    const paths = await this.prisma.nightLightPath.findMany({
      where: { homeId: observation.homeId, enabled: true },
    });
    if (paths.length === 0) return;
    const home = await this.prisma.home.findUnique({
      where: { id: observation.homeId },
      select: { timezone: true },
    });
    const minute = localMinuteOfDay(observation.occurredAt, home?.timezone ?? 'Europe/Paris');
    let changed = false;
    for (const path of paths) {
      const delay = path.offDelayMinutes * 60_000;
      const starts =
        path.triggerRoomIds.includes(observation.roomId) &&
        (trigger === 'MOVEMENT' || (trigger === 'BED_EXIT' && path.includeBedExit)) &&
        minuteInNightWindow(minute, path.startMinute, path.endMinute);
      if (starts) {
        await this.light(observation.homeId, path.id, path.lightRoomIds, path, delay, false);
        changed = true;
        continue;
      }
      // Movement anywhere along a lit path keeps it on; a presence that just ended
      // gives the resident the full delay from now.
      const alongPath =
        trigger !== 'BED_EXIT' &&
        (path.triggerRoomIds.includes(observation.roomId) ||
          path.lightRoomIds.includes(observation.roomId));
      if (alongPath) {
        const extended = await this.light(
          observation.homeId,
          path.id,
          path.lightRoomIds,
          path,
          delay,
          true,
        );
        changed ||= extended > 0;
      }
    }
    if (changed) await this.reschedule();
  }

  /** Turns off the lights whose delay is over. Exported for tests through the queue. */
  public async turnOffDue(): Promise<void> {
    const now = this.now();
    const due = await this.prisma.nightLightActivation.findMany({
      where: { offAt: { lte: now } },
    });
    const pathIds = [...new Set(due.flatMap(({ pathId }) => (pathId ? [pathId] : [])))];
    const paths = pathIds.length
      ? await this.prisma.nightLightPath.findMany({ where: { id: { in: pathIds } } })
      : [];
    const postponed = new Map<string, Date>();
    for (const path of paths) {
      if (!path.enabled) continue;
      if (await this.stillPresent(path, now))
        postponed.set(path.id, new Date(now.getTime() + path.offDelayMinutes * 60_000));
    }
    for (const activation of due) {
      const until = activation.pathId ? postponed.get(activation.pathId) : undefined;
      if (until) {
        await this.prisma.nightLightActivation.update({
          where: { id: activation.id },
          data: { offAt: until },
        });
        continue;
      }
      await this.turnOff(activation.homeId, activation.entityId);
      await this.prisma.nightLightActivation.deleteMany({
        where: { id: activation.id, offAt: activation.offAt },
      });
    }
  }

  protected now(): Date {
    return new Date();
  }

  /**
   * Turns on (or keeps on) every light of `roomIds`. Returns the number of lights lit or kept.
   * A light already on that Élise did not turn on is left alone, and never turned off later.
   */
  private async light(
    homeId: string,
    pathId: string | null,
    roomIds: string[],
    settings: { brightnessPercent: number; colorTemperatureKelvin: number },
    durationMs: number,
    extendOnly: boolean,
  ): Promise<number> {
    const targets = await this.lights(homeId, roomIds);
    if (targets.length === 0) return 0;
    const now = this.now();
    const offAt = new Date(now.getTime() + durationMs);
    const owned = new Map(
      (
        await this.prisma.nightLightActivation.findMany({
          where: { homeId, entityId: { in: targets.map(({ entityId }) => entityId) } },
        })
      ).map((activation) => [activation.entityId, activation]),
    );
    let count = 0;
    for (const target of targets) {
      const activation = owned.get(target.entityId);
      if (activation) {
        if (activation.offAt < offAt)
          await this.prisma.nightLightActivation.update({
            where: { id: activation.id },
            data: { offAt, ...(pathId && !extendOnly ? { pathId } : {}) },
          });
        // Turned off by hand in the meantime, or the first command was lost.
        if (!extendOnly && target.state !== 'on' && target.available) this.turnOn(target, settings);
        count += 1;
        continue;
      }
      if (extendOnly || !target.available || target.state === 'on') continue;
      await this.prisma.nightLightActivation.upsert({
        where: { homeId_entityId: { homeId, entityId: target.entityId } },
        update: { offAt, pathId },
        create: { homeId, entityId: target.entityId, offAt, pathId },
      });
      this.turnOn(target, settings);
      count += 1;
    }
    if (count > 0 && !extendOnly) await this.reschedule();
    return count;
  }

  private turnOn(
    target: LightTarget,
    settings: { brightnessPercent: number; colorTemperatureKelvin: number },
  ) {
    const data = nightPathTurnOnData(settings, target.features);
    this.mqtt.executeHomeAssistantCommand({
      domain: 'light',
      service: 'turn_on',
      target: { entity_id: target.entityId },
      ...(Object.keys(data).length > 0 ? { data } : {}),
    });
  }

  private async turnOff(homeId: string, entityId: string) {
    const entity = await this.prisma.deviceEntity.findFirst({
      where: { homeId, entityId },
      select: { lightFeatures: true },
    });
    const data = nightPathTurnOffData(parseFeatures(entity?.lightFeatures ?? null));
    this.mqtt.executeHomeAssistantCommand({
      domain: 'light',
      service: 'turn_off',
      target: { entity_id: entityId },
      ...(Object.keys(data).length > 0 ? { data } : {}),
    });
  }

  /** Releases the lights a path owns right away (path deleted, switched off or changed). */
  private async release(homeId: string, pathId: string) {
    await this.enqueue(async () => {
      await this.prisma.nightLightActivation.updateMany({
        where: { homeId, pathId },
        data: { offAt: this.now(), pathId: null },
      });
      await this.turnOffDue();
      await this.reschedule();
    });
  }

  private async stillPresent(path: NightLightPath, now: Date) {
    const rooms = [...new Set([...path.triggerRoomIds, ...path.lightRoomIds])];
    const events = await this.prisma.observationEvent.findMany({
      where: {
        homeId: path.homeId,
        roomId: { in: rooms },
        capability: { in: [...MOVEMENT_CAPABILITIES] },
        quality: 'good',
        occurredAt: { gte: new Date(now.getTime() - STILL_PRESENT_WINDOW_MS) },
      },
      orderBy: { occurredAt: 'desc' },
      take: 200,
      select: { sensorId: true, payload: true },
    });
    const seen = new Set<string>();
    for (const event of events) {
      const key = event.sensorId ?? '';
      if (seen.has(key)) continue;
      seen.add(key);
      const payload = (event.payload ?? {}) as { active?: unknown; context?: { role?: unknown } };
      // A bed sensor says "in bed", not "on the way": it never keeps the path lit.
      if (payload.context?.role === 'BED') continue;
      if (payload.active === true) return true;
    }
    return false;
  }

  private async reschedule(minimumDelayMs = 0): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const next = await this.prisma.nightLightActivation.findFirst({
      orderBy: { offAt: 'asc' },
      select: { offAt: true },
    });
    if (!next) return;
    const delay = Math.min(
      Math.max(next.offAt.getTime() - this.now().getTime(), minimumDelayMs, 0),
      MAX_TIMER_MS,
    );
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.enqueue(async () => {
        await this.turnOffDue();
        await this.reschedule();
      });
    }, delay);
    this.timer.unref?.();
  }

  private async lights(homeId: string, roomIds: string[]): Promise<LightTarget[]> {
    if (roomIds.length === 0) return [];
    const sensors = await this.prisma.sensor.findMany({
      where: {
        homeId,
        capability: 'light',
        removedAt: null,
        OR: [{ roomId: { in: roomIds } }, { device: { roomId: { in: roomIds } } }],
      },
      select: { entityId: true, available: true, device: { select: { enabled: true } } },
    });
    const usable = sensors.filter(({ device }) => device?.enabled !== false);
    if (usable.length === 0) return [];
    const entities = await this.prisma.deviceEntity.findMany({
      where: { homeId, entityId: { in: usable.map(({ entityId }) => entityId) } },
      select: { entityId: true, state: true, available: true, lightFeatures: true },
    });
    const byId = new Map(entities.map((entity) => [entity.entityId, entity]));
    return [...new Map(usable.map((sensor) => [sensor.entityId, sensor])).values()].map(
      (sensor) => {
        const entity = byId.get(sensor.entityId);
        const state = typeof entity?.state === 'string' ? entity.state.toLowerCase() : null;
        return {
          entityId: sensor.entityId,
          state,
          available:
            sensor.available &&
            (entity?.available ?? true) &&
            state !== 'unavailable' &&
            state !== 'unknown',
          features: parseFeatures(entity?.lightFeatures ?? null),
        };
      },
    );
  }

  private async rooms(homeId: string): Promise<NightPathRoom[]> {
    const [rooms, plan, devices, standalone] = await Promise.all([
      this.prisma.room.findMany({
        where: { homeId },
        orderBy: [{ floor: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, kind: true },
      }),
      this.prisma.homePlan.findUnique({ where: { homeId }, select: { data: true } }),
      this.prisma.device.findMany({
        where: { homeId, enabled: true, roomId: { not: null } },
        select: {
          roomId: true,
          model: true,
          sensors: { where: { removedAt: null }, select: { capability: true } },
        },
      }),
      this.prisma.sensor.findMany({
        where: { homeId, deviceId: null, removedAt: null, roomId: { not: null } },
        select: { roomId: true, capability: true },
      }),
    ]);
    const parsedPlan = plan ? homePlanSchema.safeParse(plan.data) : null;
    const levels = parsedPlan?.success ? parsedPlan.data.levels : [];
    return rooms.map((room) => {
      const inRoom = [
        ...devices.filter(({ roomId }) => roomId === room.id),
        ...standalone
          .filter(({ roomId }) => roomId === room.id)
          .map(({ capability }) => ({ model: null, sensors: [{ capability }] })),
      ].map((device) => ({ model: device.model, capabilities: device.sensors }));
      const bed = (device: (typeof inRoom)[number]) =>
        room.kind === 'BEDROOM' && deviceSupportsCategory(device, 'bed');
      return {
        id: room.id,
        name: room.name,
        kind: room.kind,
        floorName:
          levels.find(({ rooms: items }) => items.some(({ id }) => id === room.id))?.name ?? null,
        presenceSensors: inRoom.filter(
          (device) =>
            !bed(device) &&
            !isBedOccupancySensorModel(device.model) &&
            (deviceSupportsCategory(device, 'motion') ||
              deviceSupportsCategory(device, 'presence') ||
              device.capabilities.some(({ capability }) => MOVEMENT_CAPABILITIES.has(capability))),
        ).length,
        bedSensors: inRoom.filter(bed).length,
        lights: inRoom.filter((device) => deviceSupportsCategory(device, 'light')).length,
      };
    });
  }

  private view(path: NightLightPath, activations: Array<{ offAt: Date }>): NightPath {
    const activeUntil = activations.reduce<Date | null>(
      (latest, { offAt }) => (!latest || offAt > latest ? offAt : latest),
      null,
    );
    return {
      id: path.id,
      name: path.name,
      enabled: path.enabled,
      triggerRoomIds: path.triggerRoomIds,
      includeBedExit: path.includeBedExit,
      lightRoomIds: path.lightRoomIds,
      startMinute: path.startMinute,
      endMinute: path.endMinute,
      brightnessPercent: path.brightnessPercent,
      colorTemperatureKelvin: path.colorTemperatureKelvin,
      offDelayMinutes: path.offDelayMinutes as NightPath['offDelayMinutes'],
      createdAt: path.createdAt.toISOString(),
      updatedAt: path.updatedAt.toISOString(),
      activeUntil: activeUntil && activeUntil > this.now() ? activeUntil.toISOString() : null,
    };
  }

  private async assertRooms(homeId: string, roomIds: string[]) {
    const unique = [...new Set(roomIds)];
    if (unique.length === 0) return;
    const count = await this.prisma.room.count({ where: { homeId, id: { in: unique } } });
    if (count !== unique.length) throw new UnprocessableEntityException('Pièce inconnue.');
  }

  private async homeFor(userId: string, manage: boolean) {
    const home = await this.prisma.home.findFirst({
      where: {
        organization: {
          memberships: {
            some: {
              userId,
              disabledAt: null,
              ...(manage ? { systemRole: { in: MANAGERS } } : {}),
            },
          },
        },
      },
      select: { id: true, timezone: true },
    });
    if (!home)
      throw new ForbiddenException(
        manage ? 'Administrator access required' : 'Accès au domicile refusé.',
      );
    return home;
  }
}
