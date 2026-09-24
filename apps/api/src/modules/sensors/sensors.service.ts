import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  capabilitySchema,
  deviceSupportsCategory,
  homePlanSchema,
  roomSensorCategorySchema,
  sensorOnboardingCompletionSchema,
  sensorProtocolSchema,
  type HomePlan,
  type SensorOnboardingCompletion,
} from '@michel/contracts';
import {
  type ObservationEvent,
  Prisma,
  type SensorOnboardingSession,
  type SensorVerificationSession,
} from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../platform/prisma.service';
import { MqttIngestionService } from '../sensing/mqtt-ingestion.service';
import { rolesFor } from '../auth/access-policy';
import { capabilityLabel, placementGuide } from './sensor-guidance';
import { assignSensorToPlan } from './sensor-assignment';

const ADMIN_ROLES = rolesFor('configuration:manage');
const SECONDARY_CAPABILITIES = new Set(['battery', 'signal_strength', 'voltage']);
const CAPABILITY_DISPLAY_ORDER = new Map([
  ['temperature', 0],
  ['humidity', 1],
  ['motion', 2],
  ['occupancy', 3],
  ['person_presence', 4],
  ['contact', 5],
  ['water_leak', 6],
  ['battery', 99],
]);

function isBridgeControlLabel(value: string | null | undefined) {
  return (value ?? '').toLowerCase().replaceAll('_', ' ').includes('permit join');
}

function isPirMotionModel(model: string | null | undefined) {
  const normalized = (model ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (
    ['SNZB03P', 'SNZB03', '3RMS16BZ', '3RMS16BZNEW', '3RSM0147Z'].includes(normalized) ||
    normalized.includes('WIRELESSMOTIONSENSOR')
  );
}

function isSecondarySensor(
  sensor: Pick<SensorWithEvents, 'capability' | 'entityId' | 'sourceName'>,
) {
  if (SECONDARY_CAPABILITIES.has(sensor.capability)) return true;
  const label = `${sensor.entityId} ${sensor.sourceName ?? ''}`.toLowerCase().replaceAll('_', ' ');
  return sensor.capability === 'switch' && /\balert\s+enable\b/.test(label);
}

type SensorWithEvents = Prisma.SensorGetPayload<object> & { events: ObservationEvent[] };
type SensorWithRoomAndEvents = Prisma.SensorGetPayload<{ include: { room: true } }> & {
  events: ObservationEvent[];
};
type DeviceWithSensors = Omit<
  Prisma.DeviceGetPayload<{ include: { room: true; sensors: true } }>,
  'sensors'
> & { sensors: SensorWithEvents[] };

const updateSchema = z.object({
  target: sensorOnboardingCompletionSchema.shape.target,
  buttonRole: sensorOnboardingCompletionSchema.shape.buttonRole,
  contactRole: sensorOnboardingCompletionSchema.shape.contactRole,
  bedOccupiedWhen: sensorOnboardingCompletionSchema.shape.bedOccupiedWhen,
  name: z.string().trim().min(1).max(120).optional(),
  roomId: z.string().min(1).nullable().optional(),
  enabled: z.boolean().optional(),
  placementConfirmed: z.boolean().optional(),
  placementNote: z.string().trim().max(500).nullable().optional(),
});

const confirmationSchema = z.object({
  sensorId: z.string().min(1),
  capability: capabilitySchema,
});

const commandSchema = z.object({
  state: z.enum(['ON', 'OFF']),
  confirmed: z.literal(true),
});

@Injectable()
export class SensorsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SensorsService.name);
  private cleanupTimer: NodeJS.Timeout | undefined;
  private cleanupTask: Promise<void> | null = null;

  public constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttIngestionService,
  ) {}

  public onModuleInit(): void {
    void this.cleanupAbandonedOnboardings().catch((error: unknown) =>
      this.logger.error('Unable to clean abandoned sensor installations', error),
    );
    this.cleanupTimer = setInterval(() => {
      void this.cleanupAbandonedOnboardings().catch((error: unknown) =>
        this.logger.error('Unable to clean abandoned sensor installations', error),
      );
    }, 30_000);
  }

  public onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  public async list(userId: string) {
    const home = await this.homeFor(userId, false);
    const [devices, standalone] = await Promise.all([
      this.prisma.device.findMany({
        where: { homeId: home.id, roomId: { not: null }, sensors: { some: { removedAt: null } } },
        include: {
          room: true,
          sensors: {
            where: { removedAt: null },
            orderBy: { sourceName: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.sensor.findMany({
        where: { homeId: home.id, roomId: { not: null }, deviceId: null, removedAt: null },
        include: { room: true },
        orderBy: [{ sourceName: 'asc' }, { entityId: 'asc' }],
      }),
    ]);
    const latest = await this.latestEvents([
      ...devices.flatMap((device) => device.sensors.map((sensor) => sensor.id)),
      ...standalone.map((sensor) => sensor.id),
    ]);
    return [
      ...devices
        .filter(
          (device) =>
            !isBridgeControlLabel(device.name) &&
            !device.sensors.some(
              (sensor) =>
                isBridgeControlLabel(sensor.sourceName) || isBridgeControlLabel(sensor.entityId),
            ),
        )
        .map((device) =>
          this.deviceView({
            ...device,
            sensors: device.sensors.map((sensor) => this.withLatestEvent(sensor, latest)),
          }),
        ),
      ...standalone
        .filter(
          (sensor) =>
            !isBridgeControlLabel(sensor.sourceName) && !isBridgeControlLabel(sensor.entityId),
        )
        .map((sensor) => this.standaloneView(this.withLatestEvent(sensor, latest))),
    ];
  }

  public async protocols(userId: string) {
    await this.homeFor(userId, false);
    const zigbee = this.mqtt.zigbeeStatus();
    return [
      {
        id: 'zigbee',
        available: zigbee.online,
        native: true,
        status: zigbee.online ? 'READY' : 'CHECK',
        detail: zigbee.online
          ? 'Coordinateur Zigbee connecté.'
          : 'La clé Zigbee ou Zigbee2MQTT ne répond pas.',
      },
      { id: 'matter', available: process.env.MATTER_SERVER_ENABLED === 'true', native: true },
      { id: 'zwave', available: process.env.ZWAVE_SERVER_ENABLED === 'true', native: true },
      { id: 'bluetooth', available: process.env.BLUETOOTH_ENABLED === 'true', native: true },
      { id: 'esphome', available: process.env.ESPHOME_ONBOARDING_ENABLED === 'true', native: true },
      { id: 'wifi', available: process.env.HA_CONFIG_FLOW_ENABLED === 'true', native: true },
    ];
  }

  public async command(userId: string, id: string, body: unknown) {
    const input = commandSchema.parse(body);
    const home = await this.homeFor(userId);
    const device = await this.prisma.device.findFirst({
      where: { id, homeId: home.id },
      include: { sensors: { where: { capability: 'switch', removedAt: null } } },
    });
    const entity = device?.sensors[0];
    if (!device || !entity) throw new NotFoundException('Commande indisponible pour cet appareil.');
    this.mqtt.executeHomeAssistantCommand({
      domain: 'switch',
      service: input.state === 'ON' ? 'turn_on' : 'turn_off',
      target: { entity_id: entity.entityId },
    });
    return { accepted: true, deviceId: device.id, requestedState: input.state };
  }

  public async createOnboarding(userId: string, body: unknown) {
    const input = z.object({ protocol: sensorProtocolSchema.optional() }).parse(body);
    const home = await this.homeFor(userId);
    const available = await this.protocols(userId);
    const protocol =
      input.protocol ??
      ['zigbee', 'matter', 'zwave', 'bluetooth', 'esphome', 'wifi'].find((id) =>
        available.some((item) => item.id === id && item.available),
      );
    if (!protocol || !available.find((item) => item.id === protocol)?.available) {
      throw new ForbiddenException(
        'La box ne détecte actuellement aucun module permettant de rechercher un capteur.',
      );
    }
    const expiresAt = new Date(Date.now() + 4 * 60_000);
    await this.prisma.sensorOnboardingSession.updateMany({
      where: {
        homeId: home.id,
        status: { in: ['PENDING', 'WAITING_FOR_DEVICE', 'DEVICE_FOUND'] },
      },
      data: { status: 'CANCELLED', errorCode: 'REPLACED_BY_NEW_SESSION' },
    });
    await this.cleanupAbandonedOnboardings();
    const session = await this.prisma.sensorOnboardingSession.create({
      data: {
        homeId: home.id,
        requestedById: userId,
        protocol,
        status: 'WAITING_FOR_DEVICE',
        step: protocol === 'matter' ? 'SCAN_QR_ON_MOBILE' : 'PAIRING',
        expiresAt,
      },
    });
    if (protocol === 'zigbee') {
      await this.prisma.equipmentSyncState.upsert({
        where: { homeId: home.id },
        update: { pairingActive: true, pairingExpiresAt: expiresAt },
        create: { homeId: home.id, pairingActive: true, pairingExpiresAt: expiresAt },
      });
      this.mqtt.setZigbeePairing(true, 240);
    } else {
      this.mqtt.requestInventory(home.id);
    }
    return this.sessionView(session);
  }

  public async currentOnboarding(userId: string) {
    const home = await this.homeFor(userId);
    const session = await this.prisma.sensorOnboardingSession.findFirst({
      where: {
        homeId: home.id,
        status: { in: ['PENDING', 'WAITING_FOR_DEVICE', 'DEVICE_FOUND'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    return session ? this.onboarding(userId, session.id) : null;
  }

  public async onboarding(userId: string, id: string) {
    const home = await this.homeFor(userId);
    const session = await this.prisma.sensorOnboardingSession.findFirst({
      where: { id, homeId: home.id },
    });
    if (!session) throw new NotFoundException('Session d’installation introuvable.');
    if (
      session.expiresAt <= new Date() &&
      ['PENDING', 'WAITING_FOR_DEVICE', 'DEVICE_FOUND'].includes(session.status)
    ) {
      if (session.protocol === 'zigbee') await this.closeZigbeePairing(home.id);
      const expired = await this.prisma.sensorOnboardingSession.update({
        where: { id },
        data: { status: 'EXPIRED', errorCode: 'SESSION_EXPIRED' },
      });
      await this.cleanupAbandonedOnboardings();
      return this.sessionView({ ...expired, deviceId: null });
    }
    const zigbee = this.mqtt.zigbeeStatus();
    if (
      session.protocol === 'zigbee' &&
      zigbee.pairingError &&
      zigbee.pairingResponseAt &&
      zigbee.pairingResponseAt >= session.createdAt
    ) {
      await this.closeZigbeePairing(home.id);
      const failed = await this.prisma.sensorOnboardingSession.update({
        where: { id },
        data: {
          status: 'FAILED',
          errorCode: 'PAIRING_REJECTED',
          errorMessage: zigbee.pairingError,
        },
      });
      return this.sessionView(failed);
    }
    if (session.status === 'WAITING_FOR_DEVICE') {
      const pairedIdentifiers =
        session.protocol === 'zigbee' ? this.mqtt.zigbeeDevicesJoinedSince(session.createdAt) : [];
      const device = await this.prisma.device.findFirst({
        where: {
          homeId: home.id,
          AND: [
            { OR: [{ protocol: session.protocol }, { protocol: null }] },
            {
              OR: [
                { createdAt: { gte: session.createdAt } },
                ...(pairedIdentifiers.length > 0
                  ? [{ networkIdentifier: { in: pairedIdentifiers } }]
                  : []),
              ],
            },
          ],
          sensors: {
            some: {
              removedAt: null,
              lastSeenAt: { gte: session.createdAt },
            },
          },
          NOT: {
            sensors: {
              some: { entityId: { contains: 'zigbee2mqtt_bridge' } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (device) {
        if (session.protocol === 'zigbee') await this.closeZigbeePairing(home.id);
        const found = await this.prisma.sensorOnboardingSession.update({
          where: { id },
          data: {
            status: 'DEVICE_FOUND',
            step: 'CLASSIFICATION',
            deviceId: device.id,
            expiresAt: new Date(Date.now() + 15 * 60_000),
          },
        });
        return this.sessionView(found);
      }
    }
    return this.sessionView(session);
  }

  public async cancelOnboarding(userId: string, id: string) {
    const home = await this.homeFor(userId);
    const session = await this.prisma.sensorOnboardingSession.findFirst({
      where: { id, homeId: home.id },
    });
    if (!session) throw new NotFoundException('Session d’installation introuvable.');
    if (!['PENDING', 'WAITING_FOR_DEVICE', 'DEVICE_FOUND'].includes(session.status))
      return this.sessionView(session);
    const claimed = await this.prisma.sensorOnboardingSession.updateMany({
      where: { id, homeId: home.id, status: session.status },
      data: { status: 'CANCELLED' },
    });
    if (claimed.count !== 1) {
      const current = await this.prisma.sensorOnboardingSession.findFirst({
        where: { id, homeId: home.id },
      });
      return this.sessionView(current ?? session);
    }
    const pairingWasActive = ['PENDING', 'WAITING_FOR_DEVICE'].includes(session.status);
    if (session.protocol === 'zigbee' && pairingWasActive) {
      await this.closeZigbeePairing(home.id);
    }
    await this.cleanupAbandonedOnboardings();
    return this.sessionView({ ...session, status: 'CANCELLED', deviceId: null });
  }

  private async cleanupAbandonedOnboardings(): Promise<void> {
    if (this.cleanupTask) {
      await this.cleanupTask;
      return this.cleanupAbandonedOnboardings();
    }
    const task = this.removeAbandonedOnboardings();
    this.cleanupTask = task;
    try {
      await task;
    } finally {
      if (this.cleanupTask === task) this.cleanupTask = null;
    }
  }

  private async removeAbandonedOnboardings(): Promise<void> {
    const now = new Date();
    const sessions = await this.prisma.sensorOnboardingSession.findMany({
      where: {
        OR: [
          { status: { in: ['CANCELLED', 'EXPIRED', 'FAILED'] }, deviceId: { not: null } },
          {
            status: { in: ['PENDING', 'WAITING_FOR_DEVICE', 'DEVICE_FOUND'] },
            expiresAt: { lte: now },
          },
        ],
      },
      include: { device: true },
      orderBy: { createdAt: 'asc' },
    });
    const removed = new Set<string>();
    for (const session of sessions) {
      if (['PENDING', 'WAITING_FOR_DEVICE', 'DEVICE_FOUND'].includes(session.status)) {
        const expired = await this.prisma.sensorOnboardingSession.updateMany({
          where: { id: session.id, status: session.status, expiresAt: { lte: now } },
          data: { status: 'EXPIRED', errorCode: 'SESSION_EXPIRED' },
        });
        if (expired.count !== 1) continue;
        const anotherActive = await this.prisma.sensorOnboardingSession.count({
          where: {
            homeId: session.homeId,
            id: { not: session.id },
            status: { in: ['PENDING', 'WAITING_FOR_DEVICE'] },
          },
        });
        if (session.protocol === 'zigbee' && !anotherActive)
          await this.closeZigbeePairing(session.homeId);
      }
      const device = session.device;
      if (!device || removed.has(device.id)) continue;
      // A rejoin of an already installed device must never be unpaired on cancellation.
      if (device.roomId) continue;
      const completed = await this.prisma.sensorOnboardingSession.count({
        where: { deviceId: device.id, status: 'COMPLETED' },
      });
      if (completed) continue;
      if (session.protocol === 'zigbee') {
        if (!this.mqtt.zigbeeStatus().online || !device.networkIdentifier) continue;
        try {
          await this.mqtt.removeZigbeeDeviceConfirmed(device.networkIdentifier);
        } catch (error) {
          this.logger.warn(
            `Unable to unpair abandoned Zigbee device ${device.id}; will retry: ${String(error)}`,
          );
          continue;
        }
      }
      const removedAt = new Date();
      await this.prisma.$transaction([
        this.prisma.sensor.updateMany({
          where: { deviceId: device.id },
          data: { removedAt, available: false, analysisEnabled: false, status: 'OFFLINE' },
        }),
        this.prisma.deviceEntity.updateMany({
          where: { deviceId: device.id },
          data: { removedAt, available: false },
        }),
        this.prisma.device.delete({ where: { id: device.id } }),
      ]);
      removed.add(device.id);
    }
  }

  private async applyAssignment(
    tx: Prisma.TransactionClient,
    homeId: string,
    equipmentId: string,
    standalone: boolean,
    sensors: Array<{ id: string; capability: string }>,
    input: SensorOnboardingCompletion,
  ) {
    const room = input.roomId
      ? await tx.room.findFirst({ where: { id: input.roomId, homeId } })
      : null;
    if (input.roomId && !room) throw new ForbiddenException('Pièce inconnue.');
    if (
      input.contactRole === 'BED' &&
      (room?.kind !== 'BEDROOM' ||
        !sensors.some(({ capability }) => ['contact', 'dry_contact'].includes(capability)))
    )
      throw new UnprocessableEntityException('Le lit nécessite un contact sec dans une chambre.');
    if (!input.roomId && input.target)
      throw new UnprocessableEntityException('Une cible précise nécessite une pièce.');
    await assignSensorToPlan(tx, {
      homeId,
      equipmentId,
      standalone,
      sensors,
      input,
      resolve: (plan, roomId, target, capabilities) => {
        const floor = plan.levels.find(({ rooms }) => rooms.some(({ id }) => id === roomId))!;
        return this.resolveTarget(
          floor,
          floor.rooms.find(({ id }) => id === roomId)!,
          target,
          capabilities,
        );
      },
    });
  }

  public async completeOnboarding(userId: string, id: string, body: unknown) {
    const input = sensorOnboardingCompletionSchema
      .extend({ category: roomSensorCategorySchema.optional() })
      .parse(body);
    if (!input.roomId)
      throw new UnprocessableEntityException('Choisissez une pièce avant de valider le capteur.');
    const home = await this.homeFor(userId);
    const session = await this.prisma.sensorOnboardingSession.findFirst({
      where: { id, homeId: home.id },
      include: { device: { include: { sensors: { where: { removedAt: null } } } } },
    });
    if (!session?.device || session.status !== 'DEVICE_FOUND' || session.expiresAt <= new Date())
      throw new UnprocessableEntityException('Aucun nouveau capteur ne peut être installé.');
    if (
      input.category &&
      !deviceSupportsCategory(
        {
          model: session.device.model,
          capabilities: session.device.sensors.map(({ capability }) => ({ capability })),
        },
        input.category,
      )
    )
      throw new UnprocessableEntityException('Ce capteur ne fournit pas la fonction choisie.');
    await this.prisma.$transaction(async (tx) => {
      // Claim the session before modifying the device; concurrent completion rolls back.
      const claimed = await tx.sensorOnboardingSession.updateMany({
        where: { id, homeId: home.id, status: 'DEVICE_FOUND', expiresAt: { gt: new Date() } },
        data: { status: 'COMPLETED', step: 'COMPLETE', errorCode: null, errorMessage: null },
      });
      if (claimed.count !== 1)
        throw new ConflictException('Cette installation a déjà été terminée.');
      await this.applyAssignment(
        tx,
        home.id,
        session.device!.id,
        false,
        session.device!.sensors,
        input,
      );
      await tx.device.update({
        where: { id: session.device!.id },
        data: {
          displayName: input.name ?? session.device!.displayName,
          roomId: input.roomId,
          ...(input.placementNote !== undefined ? { placementNote: input.placementNote } : {}),
          installationStatus: input.roomId ? 'OPERATIONAL' : 'NEEDS_PLACEMENT',
          placementConfirmedAt: input.roomId ? new Date() : null,
        },
      });
      await tx.sensor.updateMany({
        where: { deviceId: session.device!.id, homeId: home.id },
        data: { roomId: input.roomId },
      });
      await tx.sensor.updateMany({
        where: { deviceId: session.device!.id, homeId: home.id, capability: { not: 'unknown' } },
        data: {
          analysisEnabled: true,
          classificationConfidence: 1,
          classificationReason: 'Reconnu automatiquement lors de l’appairage',
        },
      });
      await tx.equipmentSyncState.updateMany({
        where: { homeId: home.id },
        data: { pairingActive: false, pairingExpiresAt: null },
      });
    });
    if (session.protocol === 'zigbee') this.mqtt.setZigbeePairing(false, 0);
    const device = await this.deviceById(home.id, session.device.id);
    return { sessionId: session.id, device: this.deviceView(device) };
  }

  public async update(userId: string, id: string, body: unknown) {
    const input = updateSchema.parse(body);
    if (input.roomId === null)
      throw new UnprocessableEntityException('Un capteur installé doit appartenir à une pièce.');
    const home = await this.homeFor(userId);
    const standalone = id.startsWith('sensor:');
    const equipmentId = standalone ? id.slice(7) : id;
    await this.prisma.$transaction(async (tx) => {
      const device = standalone
        ? null
        : await tx.device.findFirst({
            where: { id: equipmentId, homeId: home.id },
            include: { sensors: { where: { removedAt: null } } },
          });
      const sensor = standalone
        ? await tx.sensor.findFirst({
            where: { id: equipmentId, homeId: home.id, removedAt: null },
          })
        : null;
      if (!device && !sensor) throw new NotFoundException('Capteur introuvable.');
      const currentRoomId = device?.roomId ?? sensor?.roomId ?? null;
      const roomId = input.roomId === undefined ? currentRoomId : input.roomId;
      if (
        input.roomId !== undefined ||
        input.target !== undefined ||
        input.placementNote !== undefined ||
        input.contactRole !== undefined ||
        input.bedOccupiedWhen !== undefined
      ) {
        await this.applyAssignment(
          tx,
          home.id,
          equipmentId,
          standalone,
          device?.sensors ?? [sensor!],
          {
            ...input,
            roomId,
          },
        );
      }
      if (sensor) {
        await tx.sensor.update({
          where: { id: sensor.id },
          data: {
            ...(input.roomId !== undefined ? { roomId } : {}),
            ...(input.name !== undefined ? { sourceName: input.name } : {}),
            ...(input.enabled !== undefined ? { analysisEnabled: input.enabled } : {}),
            ...(input.placementConfirmed ? { classificationConfirmedAt: new Date() } : {}),
          },
        });
      } else {
        const moved = input.roomId !== undefined && input.roomId !== currentRoomId;
        const installationStatus =
          input.enabled === false
            ? 'DISABLED'
            : moved
              ? roomId
                ? 'NEEDS_TEST'
                : 'NEEDS_PLACEMENT'
              : input.enabled === true
                ? roomId
                  ? 'NEEDS_TEST'
                  : 'NEEDS_PLACEMENT'
                : undefined;
        await tx.device.update({
          where: { id: equipmentId },
          data: {
            ...(input.name !== undefined ? { displayName: input.name } : {}),
            ...(input.roomId !== undefined ? { roomId } : {}),
            ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
            ...(input.placementNote !== undefined ? { placementNote: input.placementNote } : {}),
            ...(input.placementConfirmed ? { placementConfirmedAt: new Date() } : {}),
            ...(installationStatus ? { installationStatus } : {}),
          },
        });
        await tx.sensor.updateMany({
          where: { deviceId: equipmentId, homeId: home.id },
          data: {
            ...(input.roomId !== undefined ? { roomId } : {}),
            ...(input.enabled === undefined ? {} : { analysisEnabled: input.enabled }),
          },
        });
      }
    });
    return { id };
  }

  public async remove(userId: string, id: string) {
    const home = await this.homeFor(userId);
    const removedAt = new Date();
    if (id.startsWith('sensor:')) {
      const sensorId = id.slice(7);
      const sensor = await this.prisma.sensor.findFirst({
        where: { id: sensorId, homeId: home.id, removedAt: null },
      });
      if (!sensor) throw new NotFoundException('Capteur introuvable.');
      await this.prisma.sensor.update({
        where: { id: sensor.id },
        data: { removedAt, available: false, analysisEnabled: false, status: 'OFFLINE' },
      });
      return { removed: true, unpaired: false };
    }

    const device = await this.prisma.device.findFirst({
      where: { id, homeId: home.id, sensors: { some: { removedAt: null } } },
      include: { sensors: { where: { removedAt: null } } },
    });
    if (!device) throw new NotFoundException('Capteur introuvable.');

    const isZigbee = device.protocol === 'zigbee';
    if (isZigbee) {
      if (!this.mqtt.zigbeeStatus().online) {
        throw new UnprocessableEntityException(
          'La clé Zigbee doit être connectée pour désappairer complètement ce capteur.',
        );
      }
      const identifier = device.networkIdentifier?.trim();
      if (!identifier)
        throw new UnprocessableEntityException('Identifiant Zigbee introuvable pour ce capteur.');
      await this.mqtt.removeZigbeeDeviceConfirmed(identifier);
    }

    await this.prisma.$transaction(async (tx) => {
      await this.applyAssignment(tx, home.id, device.id, false, device.sensors, { roomId: null });
      await tx.sensor.updateMany({
        where: { deviceId: device.id, homeId: home.id },
        data: { removedAt, available: false, analysisEnabled: false, status: 'OFFLINE' },
      });
      await tx.deviceEntity.updateMany({
        where: { deviceId: device.id, homeId: home.id },
        data: { removedAt, available: false },
      });
      await tx.device.delete({ where: { id: device.id } });
    });
    return { removed: true, unpaired: isZigbee };
  }

  public async confirm(userId: string, id: string, body: unknown) {
    const input = confirmationSchema.parse(body);
    const home = await this.homeFor(userId);
    const sensor = await this.prisma.sensor.findFirst({
      where: {
        id: input.sensorId,
        homeId: home.id,
        ...(id.startsWith('sensor:') ? {} : { deviceId: id }),
      },
    });
    if (!sensor || (id.startsWith('sensor:') && id !== `sensor:${sensor.id}`)) {
      throw new NotFoundException('Mesure introuvable.');
    }
    await this.prisma.$transaction([
      this.prisma.sensor.update({
        where: { id: sensor.id },
        data: {
          capability: input.capability,
          compatibility: 'PARTIAL',
          analysisEnabled: true,
          classificationSource: 'USER',
          classificationConfidence: 1,
          classificationReason: 'Type confirmé par un administrateur',
          classificationConfirmedAt: new Date(),
        },
      }),
      this.prisma.sensorMapping.upsert({
        where: { sensorId: sensor.id },
        create: {
          sensorId: sensor.id,
          capability: input.capability,
          transform: this.transformFor(input.capability),
          enabled: true,
        },
        update: {
          capability: input.capability,
          transform: this.transformFor(input.capability),
          enabled: true,
        },
      }),
      ...(id.startsWith('sensor:')
        ? []
        : [
            this.prisma.device.update({
              where: { id },
              data: { installationStatus: 'NEEDS_PLACEMENT' },
            }),
          ]),
    ]);
    return { id, sensorId: sensor.id, capability: input.capability };
  }

  public async guide(userId: string, id: string) {
    const home = await this.homeFor(userId);
    const storedPlan = await this.prisma.homePlan.findUnique({ where: { homeId: home.id } });
    const parsedPlan = homePlanSchema.safeParse(storedPlan?.data);
    const isBedContact = (sensorIds: string[], deviceId?: string) =>
      parsedPlan.success &&
      parsedPlan.data.placements.some(
        (placement) =>
          placement.kind === 'SENSOR' &&
          (placement.equipmentId === deviceId || sensorIds.includes(placement.equipmentId)) &&
          placement.capabilityBindings.some(
            ({ sensorId, role }) => role === 'BED' && sensorIds.includes(sensorId),
          ),
      );
    if (id.startsWith('sensor:')) {
      const sensor = await this.prisma.sensor.findFirst({
        where: { id: id.slice(7), homeId: home.id },
        include: { room: true },
      });
      if (!sensor) throw new NotFoundException('Capteur introuvable.');
      return placementGuide(
        [sensor.capability],
        sensor.room?.kind,
        isBedContact([sensor.id]) ? 'BED' : undefined,
      );
    }
    const device = await this.prisma.device.findFirst({
      where: { id, homeId: home.id },
      include: { room: true, sensors: true },
    });
    if (!device) throw new NotFoundException('Capteur introuvable.');
    return placementGuide(
      device.sensors.map((sensor) => sensor.capability),
      device.room?.kind,
      isBedContact(
        device.sensors.map((sensor) => sensor.id),
        device.id,
      )
        ? 'BED'
        : undefined,
    );
  }

  public async startVerification(userId: string, id: string) {
    const home = await this.homeFor(userId);
    const target = id.startsWith('sensor:')
      ? await this.prisma.sensor.findFirst({ where: { id: id.slice(7), homeId: home.id } })
      : await this.prisma.device.findFirst({ where: { id, homeId: home.id } });
    if (!target) throw new NotFoundException('Capteur introuvable.');
    const session = await this.prisma.sensorVerificationSession.create({
      data: {
        homeId: home.id,
        requestedById: userId,
        deviceId: id.startsWith('sensor:') ? null : id,
        sensorId: id.startsWith('sensor:') ? id.slice(7) : null,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 20_000),
      },
    });
    this.mqtt.requestInventory(home.id);
    return this.verificationView(session);
  }

  public async verification(userId: string, sessionId: string) {
    const home = await this.homeFor(userId);
    const session = await this.prisma.sensorVerificationSession.findFirst({
      where: { id: sessionId, homeId: home.id },
    });
    if (!session) throw new NotFoundException('Test introuvable.');
    if (['PENDING', 'WAITING_FOR_DEVICE'].includes(session.status)) {
      const event = await this.prisma.observationEvent.findFirst({
        where: {
          homeId: home.id,
          occurredAt: { gt: session.startedAt },
          sensor: session.sensorId
            ? { id: session.sensorId, removedAt: null }
            : { deviceId: session.deviceId!, removedAt: null },
        },
        orderBy: { occurredAt: 'desc' },
      });
      if (event) {
        return this.verificationView(
          await this.prisma.sensorVerificationSession.update({
            where: { id: session.id },
            data: {
              status: 'COMPLETED',
              observedAt: event.occurredAt,
              errorCode: null,
            },
          }),
        );
      }
      const expired = session.expiresAt <= new Date();
      if (!expired && (await this.verificationTargetOnline(home.id, session))) {
        return this.verificationView(
          await this.prisma.sensorVerificationSession.update({
            where: { id: session.id },
            data: {
              status: 'COMPLETED',
              observedAt: new Date(),
              errorCode: null,
            },
          }),
        );
      }
      return this.verificationView(
        await this.prisma.sensorVerificationSession.update({
          where: { id: session.id },
          data: {
            status: expired ? 'EXPIRED' : 'WAITING_FOR_DEVICE',
            errorCode: expired ? 'NO_NEW_SIGNAL' : null,
          },
        }),
      );
    }
    return this.verificationView(session);
  }

  private async verificationTargetOnline(homeId: string, session: SensorVerificationSession) {
    if (session.sensorId) {
      const sensor = await this.prisma.sensor.findFirst({
        where: { id: session.sensorId, homeId, removedAt: null },
        include: { device: true },
      });
      if (!sensor || !sensor.available || sensor.status === 'OFFLINE') return false;
      if (sensor.device?.protocol !== 'zigbee')
        return this.inventoryConfirmedAfter(homeId, session.startedAt);
      const bridge = this.mqtt.zigbeeStatus();
      const joined = sensor.device.networkIdentifier
        ? this.mqtt.isZigbeeDeviceJoined(sensor.device.networkIdentifier)
        : null;
      return (
        bridge.online && joined === true && this.inventoryConfirmedAfter(homeId, session.startedAt)
      );
    }
    if (!session.deviceId) return false;
    const device = await this.prisma.device.findFirst({
      where: { id: session.deviceId, homeId },
      include: { sensors: { where: { removedAt: null } } },
    });
    if (
      !device?.enabled ||
      !device.sensors.some(({ available, status }) => available && status !== 'OFFLINE')
    )
      return false;
    if (device.protocol !== 'zigbee')
      return this.inventoryConfirmedAfter(homeId, session.startedAt);
    const bridge = this.mqtt.zigbeeStatus();
    const joined = device.networkIdentifier
      ? this.mqtt.isZigbeeDeviceJoined(device.networkIdentifier)
      : null;
    return (
      bridge.online && joined === true && this.inventoryConfirmedAfter(homeId, session.startedAt)
    );
  }

  private async inventoryConfirmedAfter(homeId: string, startedAt: Date) {
    const sync = await this.prisma.equipmentSyncState.findUnique({
      where: { homeId },
      select: { inventorySeenAt: true },
    });
    return Boolean(sync?.inventorySeenAt && sync.inventorySeenAt >= startedAt);
  }

  private async homeFor(userId: string, administrator = true) {
    const home = await this.prisma.home.findFirst({
      where: {
        organization: {
          memberships: {
            some: {
              userId,
              disabledAt: null,
              ...(administrator ? { systemRole: { in: [...ADMIN_ROLES] } } : {}),
            },
          },
        },
      },
      select: { id: true },
    });
    if (!home)
      throw new ForbiddenException(
        administrator ? 'Accès administrateur requis.' : 'Accès refusé.',
      );
    return home;
  }

  private async deviceById(homeId: string, deviceId: string): Promise<DeviceWithSensors> {
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, homeId },
      include: {
        room: true,
        sensors: {
          where: { removedAt: null },
          orderBy: { sourceName: 'asc' },
        },
      },
    });
    if (!device) throw new NotFoundException('Capteur introuvable.');
    const latest = await this.latestEvents(device.sensors.map((sensor) => sensor.id));
    return {
      ...device,
      sensors: device.sensors.map((sensor) => this.withLatestEvent(sensor, latest)),
    };
  }

  private async latestEvents(sensorIds: string[]): Promise<Map<string, ObservationEvent>> {
    if (sensorIds.length === 0) return new Map();
    const events = await this.prisma.$queryRaw<ObservationEvent[]>`
      SELECT latest.*
      FROM unnest(ARRAY[${Prisma.join(sensorIds)}]::text[]) AS target(id)
      JOIN LATERAL (
        SELECT * FROM "ObservationEvent" AS event
        WHERE event."sensorId" = target.id
        ORDER BY event."occurredAt" DESC
        LIMIT 1
      ) AS latest ON true
    `;
    return new Map(events.flatMap((event) => (event.sensorId ? [[event.sensorId, event]] : [])));
  }

  private withLatestEvent<T extends { id: string }>(
    sensor: T,
    latest: Map<string, ObservationEvent>,
  ): T & { events: ObservationEvent[] } {
    const event = latest.get(sensor.id);
    return { ...sensor, events: event ? [event] : [] };
  }

  private async closeZigbeePairing(homeId: string) {
    this.mqtt.setZigbeePairing(false, 0);
    await this.prisma.equipmentSyncState.updateMany({
      where: { homeId },
      data: { pairingActive: false, pairingExpiresAt: null },
    });
  }

  private detectedType(capabilities: string[], model?: string | null) {
    const values = new Set(capabilities);
    if (values.has('temperature') && values.has('humidity')) return 'TEMPERATURE_HUMIDITY';
    if (values.has('temperature')) return 'TEMPERATURE';
    if (values.has('water_leak')) return 'WATER_LEAK';
    if (values.has('smoke') || values.has('carbon_monoxide')) return 'SAFETY';
    if (values.has('contact')) return 'CONTACT';
    if (values.has('occupancy') && isPirMotionModel(model)) return 'MOTION';
    if (values.has('person_presence') || values.has('occupancy')) return 'PRESENCE';
    if (values.has('motion') || values.has('vibration')) return 'MOTION';
    if (values.has('power') || values.has('energy') || values.has('switch')) return 'SMART_PLUG';
    if (values.has('button')) return 'BUTTON';
    return 'UNKNOWN';
  }

  private resolveTarget(
    level: HomePlan['levels'][number],
    room: HomePlan['levels'][number]['rooms'][number],
    target: { type: 'ROOM' | 'ITEM' | 'OPENING' | 'STAIR'; id: string },
    capabilities: string[],
  ) {
    const values = new Set(capabilities);
    if (target.type === 'ROOM') {
      if (target.id !== room.id) throw new UnprocessableEntityException('Pièce cible invalide.');
      const xs = room.geometry.points.map(({ x }) => x);
      const ys = room.geometry.points.map(({ y }) => y);
      return {
        ...target,
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
      };
    }
    if (target.type === 'OPENING') {
      const opening = level.openings.find(
        ({ id, roomIds }) => id === target.id && roomIds.includes(room.id),
      );
      const compatible =
        values.has('contact') ||
        (opening?.kind === 'PASSAGE' &&
          (values.has('motion') || values.has('occupancy') || values.has('person_presence')));
      if (!opening || !compatible) {
        throw new UnprocessableEntityException('Cette ouverture n’est pas compatible.');
      }
      return { ...target, x: opening.x, y: opening.y };
    }
    if (target.type === 'STAIR') {
      const stair = level.stairs.find(
        ({ id, fromRoomId, toRoomId }) =>
          id === target.id && [fromRoomId, toRoomId].includes(room.id),
      );
      if (
        !stair ||
        ![...values].some((value) => ['motion', 'occupancy', 'person_presence'].includes(value))
      ) {
        throw new UnprocessableEntityException('Cet escalier n’est pas compatible.');
      }
      const anchor = stair.fromRoomId === room.id ? stair.fromAnchor : stair.toAnchor;
      return { ...target, x: anchor?.x ?? stair.x, y: anchor?.y ?? stair.y };
    }
    const item = level.items.find(({ id, roomId }) => id === target.id && roomId === room.id);
    if (!item) throw new UnprocessableEntityException('Objet cible introuvable.');
    const leakItems = ['SINK', 'WASHING_MACHINE', 'SHOWER', 'BATHTUB', 'TOILET', 'DISHWASHER'];
    const electricalItems = [
      'LAMP',
      'COFFEE_MACHINE',
      'KETTLE',
      'MICROWAVE',
      'DISHWASHER',
      'MEDICAL_DEVICE',
      'OVEN',
    ];
    const openingItems = ['CABINET', 'WARDROBE', 'DRESSER', 'FRIDGE'];
    const compatible =
      (values.has('water_leak') && leakItems.includes(item.kind)) ||
      ([...values].some((value) => ['power', 'energy', 'switch'].includes(value)) &&
        electricalItems.includes(item.kind)) ||
      (values.has('contact') && openingItems.includes(item.kind));
    if (!compatible) throw new UnprocessableEntityException('Cet objet n’est pas compatible.');
    return { ...target, x: item.x + item.width / 2, y: item.y + item.height / 2 };
  }

  private deviceView(device: DeviceWithSensors) {
    const zigbeeJoined =
      device.protocol === 'zigbee' && device.networkIdentifier
        ? this.mqtt.isZigbeeDeviceJoined?.(device.networkIdentifier)
        : null;
    const networkDisconnected = zigbeeJoined === false;
    const recognizedSensors = device.sensors
      .filter((sensor) => sensor.capability !== 'unknown')
      .sort(
        (left, right) =>
          (CAPABILITY_DISPLAY_ORDER.get(left.capability) ?? 50) -
          (CAPABILITY_DISPLAY_ORDER.get(right.capability) ?? 50),
      );
    const userSensors = recognizedSensors.length > 0 ? recognizedSensors : device.sensors;
    const capabilities = userSensors.map((sensor) => {
      const displayCapability =
        sensor.capability === 'occupancy' && isPirMotionModel(device.model)
          ? 'motion'
          : sensor.capability;
      return this.capabilityView(sensor, networkDisconnected, displayCapability);
    });
    const batteryPayload = userSensors.find((sensor) => sensor.capability === 'battery')?.events[0]
      ?.payload;
    const battery = this.recordValue(batteryPayload);
    const lastSeen = device.sensors.reduce(
      (latest: Date | null, sensor) =>
        !latest || (sensor.lastSeenAt && sensor.lastSeenAt > latest) ? sensor.lastSeenAt : latest,
      null,
    );
    const primarySensors = userSensors.filter((sensor) => !isSecondarySensor(sensor));
    const sensorsDeterminingState = primarySensors.length > 0 ? primarySensors : userSensors;
    const uncertain = sensorsDeterminingState.some(
      (sensor) => !sensor.analysisEnabled || sensor.classificationConfidence < 0.8,
    );
    const capabilityNames = new Set(userSensors.map((sensor) => sensor.capability));
    const inferredName =
      capabilityNames.has('temperature') && capabilityNames.has('humidity')
        ? 'Capteur température et humidité'
        : capabilityNames.has('occupancy') && isPirMotionModel(device.model)
          ? 'Détecteur de mouvement'
          : capabilityNames.has('person_presence') || capabilityNames.has('occupancy')
            ? 'Capteur de présence'
            : capabilityNames.has('motion')
              ? 'Détecteur de mouvement'
              : capabilityNames.has('contact') || capabilityNames.has('dry_contact')
                ? 'Détecteur d’ouverture'
                : capabilityNames.has('water_leak')
                  ? 'Détecteur de fuite d’eau'
                  : device.name;
    const status = !device.enabled
      ? 'DISABLED'
      : networkDisconnected
        ? 'ATTENTION'
        : uncertain
          ? 'NEEDS_CONFIRMATION'
          : device.installationStatus;
    return {
      id: device.id,
      physicalDeviceId: device.id,
      name: device.displayName ?? inferredName,
      manufacturer: device.manufacturer,
      model: device.model,
      protocol: device.protocol,
      integration: device.integration,
      room: device.room
        ? { id: device.room.id, name: device.room.name, kind: device.room.kind }
        : null,
      installationStatus: status,
      enabled: device.enabled,
      placementConfirmedAt: device.placementConfirmedAt?.toISOString() ?? null,
      placementNote: device.placementNote ?? null,
      lastSeenAt: lastSeen?.toISOString() ?? null,
      batteryPercent:
        !networkDisconnected && typeof battery?.value === 'number' ? battery.value : null,
      capabilities,
      action: this.actionFor(status, Boolean(device.room)),
    };
  }

  private standaloneView(sensor: SensorWithRoomAndEvents) {
    const batteryValue = this.recordValue(sensor.events[0]?.payload)?.value;
    const status = !sensor.analysisEnabled
      ? 'NEEDS_CONFIRMATION'
      : !sensor.room
        ? 'NEEDS_PLACEMENT'
        : sensor.status === 'OFFLINE'
          ? 'ATTENTION'
          : 'NEEDS_TEST';
    return {
      id: `sensor:${sensor.id}`,
      physicalDeviceId: null,
      name: sensor.sourceName ?? sensor.entityId,
      manufacturer: null,
      model: null,
      protocol: null,
      integration: null,
      room: sensor.room
        ? { id: sensor.room.id, name: sensor.room.name, kind: sensor.room.kind }
        : null,
      installationStatus: status,
      enabled: sensor.analysisEnabled,
      placementConfirmedAt: sensor.classificationConfirmedAt?.toISOString() ?? null,
      lastSeenAt: sensor.lastSeenAt?.toISOString() ?? null,
      batteryPercent:
        sensor.capability === 'battery' && typeof batteryValue === 'number' ? batteryValue : null,
      capabilities: [this.capabilityView(sensor)],
      action: this.actionFor(status, Boolean(sensor.room)),
    };
  }

  private capabilityView(
    sensor: SensorWithEvents,
    networkDisconnected = false,
    displayCapability = sensor.capability,
  ) {
    return {
      sensorId: sensor.id,
      entityId: sensor.entityId,
      capability: displayCapability,
      label: capabilityLabel(displayCapability),
      primary: !isSecondarySensor(sensor),
      lastSeenAt:
        sensor.events[0]?.occurredAt?.toISOString() ?? sensor.lastSeenAt?.toISOString() ?? null,
      status: networkDisconnected ? 'OFFLINE' : sensor.status,
      value: networkDisconnected ? null : this.recordValue(sensor.events[0]?.payload),
      unit: sensor.unit,
      classification: {
        source: sensor.classificationSource,
        confidence: sensor.classificationConfidence,
        reason: sensor.classificationReason,
        confirmedAt: sensor.classificationConfirmedAt?.toISOString() ?? null,
      },
    };
  }

  private actionFor(status: string, room: boolean) {
    if (status === 'NEEDS_CONFIRMATION') return 'CONFIRM';
    if (!room) return 'ASSIGN_ROOM';
    if (status === 'NEEDS_PLACEMENT') return 'PLACE';
    if (status === 'NEEDS_TEST') return 'TEST';
    if (status === 'ATTENTION') return 'CHECK';
    return 'NONE';
  }

  private transformFor(capability: string) {
    if (
      [
        'temperature',
        'humidity',
        'power',
        'energy',
        'battery',
        'co2',
        'voc',
        'pm25',
        'air_quality',
        'illuminance',
        'signal_strength',
      ].includes(capability)
    )
      return 'NUMERIC' as const;
    if (capability === 'contact') return 'OPEN_CLOSED' as const;
    if (capability === 'button') return 'EVENT_ACTION' as const;
    return 'ON_OFF' as const;
  }

  private async sessionView(session: SensorOnboardingSession) {
    const device = session.deviceId
      ? await this.deviceById(session.homeId, session.deviceId)
      : null;
    const zigbee = session.protocol === 'zigbee' ? this.mqtt.zigbeeStatus() : null;
    const deviceDetected =
      session.protocol === 'zigbee' &&
      ['PENDING', 'WAITING_FOR_DEVICE'].includes(session.status) &&
      this.mqtt.zigbeeDevicesJoinedSince(session.createdAt).length > 0;
    const detectedDevice = device
      ? {
          ...this.deviceView(device),
          detectedType: this.detectedType(
            device.sensors.map(({ capability }) => capability),
            device.model,
          ),
        }
      : null;
    return {
      id: session.id,
      protocol: session.protocol,
      status: session.status,
      step: session.step,
      deviceId: session.deviceId,
      errorCode: session.errorCode,
      errorMessage: session.errorMessage,
      expiresAt: session.expiresAt.toISOString(),
      connection: zigbee
        ? {
            online: zigbee.online,
            pairingOpen: zigbee.pairingOpen,
            deviceDetected,
            updatedAt: zigbee.updatedAt?.toISOString() ?? null,
          }
        : null,
      detectedDevice,
    };
  }

  private verificationView(session: SensorVerificationSession) {
    return {
      id: session.id,
      deviceId: session.deviceId,
      sensorId: session.sensorId,
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      observedAt: session.observedAt?.toISOString() ?? null,
    };
  }

  private recordValue(value: Prisma.JsonValue | undefined): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }
}
